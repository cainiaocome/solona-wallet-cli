# Implementation and operations guide

This document records how the repository implements the supplied v0.1 specification. It is intentionally operational: it explains the boundaries a future contributor must preserve, the validation that has actually run, and the environment-specific issues encountered while bootstrapping dependencies.

## Status

The application is implemented as a strict ESM TypeScript CLI. The current v0.1 implementation includes:

- one-wallet encrypted local keystore with address-only public reads
- hidden import/passphrase prompts and Solana CLI JSON keypair input
- Argon2id key derivation with 64 MiB memory, three iterations, one lane
- AES-256-GCM with random salt and nonce, authenticated public metadata, atomic `0600` writes
- shared command parser for REPL and `-c` mode, quotes, `--flag=value`, flags, aliases, help, history, and contextual completion
- cluster/RPC/commitment configuration precedence and session changes
- SOL and SPL/Token-2022 read commands
- SOL and basic token transfer builders with exact amounts, simulation, confirmation, broadcast, and confirmation polling
- native Stake Program create/delegate, list, deactivate, and withdraw command paths
- explicit positional Stake Program sysvar accounts, epoch-aware stake state, and atomic stake-registry updates
- typed application errors and documented exit-code categories

Jupiter Lend is not implemented. No v0.2 dependency or command should be added until the v0.1 Definition of Done in `docs/spec.md` is met.

## Dependency bootstrap record

The initial `npm install` exposed two environment details:

1. The registry available to this workspace applied an effective package-time cutoff around 2026-09-12 20:57 UTC. The registry could show newer versions through `npm view`, but installation rejected packages published after the cutoff with `ETARGET`, including `@solana-program/token-2022@0.18.0`, `@types/node@26.6.2`, `dotenv@18.0.1`, and `vitest@5.0.1`.
2. Two first-attempt `npm install` processes became orphaned and consumed CPU without creating `node_modules`. They were stopped by PID after verifying they were both this repository's install commands.

The retry used exact stable versions published before the cutoff and `--legacy-peer-deps`; it completed successfully. Vitest then reported that its Vite peer was absent, so the exact stable `vite@8.3.0` package was added explicitly. The committed lockfile is the source of truth; normal builds use `npm ci` and do not need the troubleshooting command again. This incident does not affect wallet runtime behavior.

The installed core stack is `@solana/kit@8.3.0`, `@solana/sysvars@8.3.0`, `@solana-program/system@0.14.1`, `@solana-program/stake@0.9.1`, `@solana-program/token@0.16.1`, and `@solana-program/token-2022@0.17.0`. Core code does not import legacy `@solana/web3.js`.

## Source layout

`src/cli.ts` parses only startup flags and chooses one-shot or REPL execution. `src/shell/` owns tokenization, command completion, history filtering, help, hidden prompts, and readline. `src/commands/` contains user-facing handlers. `src/config/` handles precedence and permissions. `src/wallet/` is the only layer that reads or decrypts key material. `src/solana/` contains Kit RPC access, exact amounts, token decoding, validators, and transaction/stake helpers. `src/output/` separates JSON and human output.

The command flow is:

```text
readline or -c text
  -> shell parser
  -> command handler
  -> validated Kit RPC/application data
  -> preflight summary
  -> simulation
  -> confirmation
  -> encrypted signer unlock
  -> broadcast and blockhash-aware status polling
```

Read-only address, balance, token, validator, and stake-list commands use the public keystore metadata and never invoke the signer. The `EncryptedKeystoreSigner` decrypts only from its `signTransactions` boundary; transaction handlers cannot call a `getPrivateKey()` method.

## Keystore format and recovery behavior

`keystore.json` contains only version, kind, public address, Argon2id parameters/salt, AES-GCM nonce/tag, and ciphertext. The passphrase is never stored. AAD is a deterministic JSON representation of public metadata; changing the public address or KDF/cipher metadata makes GCM authentication fail.

Writes create a unique sibling temporary file with `wx`, write and `fsync` it, close it, set `0600`, then rename it into place. Existing keystores are refused rather than overwritten. Import validates the key before writing, validates a decrypt-and-derive round trip after writing, and removes only the newly created target if post-write validation fails.

The accepted key inputs are base58 32-byte seeds or 64-byte Solana expanded keypairs, plus JSON byte arrays from a Solana CLI keypair file. Mutable decoded key buffers are filled after use. JavaScript GC/CryptoKey lifetime limitations remain documented in the README.

## RPC and amount rules

All RPC clients are created from the session config and use the configured commitment. RPC data is treated as untrusted and application-specific token/stake shapes are checked before use. Monetary values stay in `bigint`: SOL uses nine decimals and token amounts use the mint's on-chain decimals. Scientific notation, negative values, leading-zero forms, excess precision, and silent rounding are rejected.

Token reads query both the legacy Token Program and Token-2022. Basic Token-2022 transfers use the checked instruction, but mints with extensions are refused because the transfer semantics need explicit support. No third-party token-list metadata is used.

Native staking uses the official generated System and Stake clients. The stake create path is `CreateAccountWithSeed`, `Initialize`, and `DelegateStake`, with the wallet as both authorities and a blockhash-derived seed bounded to System Program seed length. Required Rent, Clock, StakeHistory, and StakeConfig accounts are inserted explicitly because the pinned generated Stake package does not model all builtin positional sysvars. Rent and minimum delegation are queried dynamically. Stake discovery makes two server-side `getProgramAccounts` queries, one for staker and one for withdrawer, rather than downloading and filtering all stake accounts locally. The `u64::MAX` deactivation sentinel is treated as active, and a deactivation epoch is complete only after the current epoch.

## History and completion safety

History is capped at 1,000 persisted entries, stored mode `0600`, and rejects lines containing private-key, secret-key, seed-phrase, mnemonic, password, or passphrase terms. Completion is memory-only public metadata: cached mints, known stake accounts, and recently inspected validator vote accounts. It never performs a network request synchronously, unlocks the keystore, signs, or broadcasts. Unknown command flags are rejected instead of being silently ignored.

## Validation record

Run from the repository root:

```bash
npm test
npm run build
npm run format:check
```

The current offline suite covers exact decimal parsing, large bigint amounts, parser quoting and flags, command completion, history filtering, keystore round trips, wrong passwords, authenticated metadata tampering, atomic replacement refusal, file mode, absence of plaintext key fields, Stake Program sysvar account order, and cluster/RPC session safety. Docker E2E is kept separate because it requires Docker and a PTY; it must be run against `SOL_WALLET_E2E_IMAGE`, never against `tsx` or the source tree. The workflow fails before publication if the image reference, Docker, pexpect, or any E2E test is missing, and uploads a method log plus image metadata on E2E failure.

Before committing, TypeScript/JSON/Markdown/YAML changes are formatted with Prettier `3.6.2`, and the Python E2E harness is formatted with Black `25.1.0`; the repository rule for this is recorded in `AGENTS.md`.

In this workspace the image build completed, but the available Docker runtime exposed bind-mounted host directories as root-owned inside the container. That caused the secure non-root runtime to receive `EPERM` while enforcing the `0700` config directory. The PTY/mock-RPC tests are therefore intentionally left for the GitHub Actions runner, where the workflow builds and tests the exact image in its supported Docker environment.

Do not claim a devnet/mainnet write was tested unless an opt-in integration or manual smoke run is recorded separately. Automated tests must use the disposable public fixture under `test/fixtures/` or a local/mock environment.

## Docker release contract

`Dockerfile` is multi-stage. The build stage runs `npm ci`, tests, and `npm run build`, then prunes development dependencies. The runtime stage contains `package.json`, production `node_modules`, and `dist` only, runs as `solwallet` (UID/GID `10001` by default), and starts directly at `dist/cli.js`. The documented mount is `/home/solwallet/.config/sol-wallet`; direct callers should pass their host UID/GID, while `scripts/sol-wallet` does that automatically.

The intended CI order is formatting, source tests, `linux/amd64` image build, PTY/mock-RPC E2E against that exact tag, then GHCR authentication and push. Pushes to the repository's `main` or `master` branch and version tags trigger the workflow; pull requests never push. Version tags also publish the minor-series tag (for example `v0.1.0` publishes `0.1`). CI must not upload mounted wallet directories, passwords, private keys, or arbitrary logs.

The post-review GitHub Actions run `35480368693` passed formatting, 18 unit tests, the TypeScript build, the exact-image Docker build, all 8 Docker E2E tests, GHCR authentication, and the exact tested-image push. The local container runtime cannot reproduce the runner's bind-mount ownership behavior, so this GitHub result is the authoritative Docker validation for this workspace.

## Known operational limits

- The mainnet and devnet public RPC defaults are configurable and are not guaranteed available.
- Read-only commands still need a network when they query chain state; `address` and `wallet info` do not.
- A submitted transaction whose confirmation times out is not retried automatically; the signature is shown so it can be inspected.
- The current token sender supports basic checked transfers and refuses Token-2022 extension mints.
- Stake account JSON parsing follows the current generated/RPC shapes and deliberately reports `unknown` for locally registered accounts that cannot be discovered or decoded.
- There is no mnemonic import, key replacement, cloud backup, hardware wallet, dApp integration, or arbitrary serialized transaction signing.
