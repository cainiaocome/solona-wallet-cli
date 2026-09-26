# Implementation and operations guide

This document records the original v0.1/v0.2 implementation and dependency bootstrap. The current v0.3 multi-wallet design and recovery contract are described in [multiple-wallets.md](multiple-wallets.md) and the specifications under `specs/`. For a first introduction, use the [documentation map](README.md) and [getting-started guide](getting-started.md) first.

## Status

The published v0.2 baseline was implemented as a strict ESM TypeScript CLI. It included:

- a single encrypted local keystore with address-only public reads
- hidden import/passphrase prompts and Solana CLI JSON keypair input
- Argon2id key derivation with 64 MiB memory, three iterations, one lane
- AES-256-GCM with random salt and nonce, authenticated public metadata, atomic `0600` writes
- shared command parser for REPL and `-c` mode, quotes, `--flag=value`, flags, aliases, help, history, and contextual completion
- cluster/RPC/commitment configuration precedence and session changes
- current Solana `mainnet` naming and default RPC
- SOL and SPL/Token-2022 read commands
- SOL and basic token transfer builders with exact amounts, simulation, confirmation, broadcast, and confirmation polling
- native Stake Program create/delegate, list, deactivate, and withdraw command paths
- explicit positional Stake Program sysvar accounts, epoch-aware stake state, and atomic stake-registry updates
- isolated Jupiter Lend Earn USDC status, deposit, withdraw, and withdraw-all commands
- canonical mainnet USDC verification, official SDK instruction adaptation, protocol-reported withdrawability, and common transaction safety
- typed application errors and documented exit-code categories

The current checkout extends that baseline with multiple UUID-named encrypted
keystores, an alias/default registry, session selection, wallet-aware signing
and transaction output, migration/recovery, and wallet/network-scoped stake
metadata. This v0.3 work is not part of the published v0.2 image.

Jupiter Borrow, collateral positions, arbitrary lending assets, leverage, liquidations, and arbitrary Jupiter transaction signing remain out of scope.

## Dependency bootstrap record

The initial `npm install` exposed two environment details:

1. The registry available to this workspace applied an effective package-time cutoff around 2026-09-12 20:57 UTC. The registry could show newer versions through `npm view`, but installation rejected packages published after the cutoff with `ETARGET`, including `@solana-program/token-2022@0.18.0`, `@types/node@26.6.2`, `dotenv@18.0.1`, and `vitest@5.0.1`.
2. Two first-attempt `npm install` processes became orphaned and consumed CPU without creating `node_modules`. They were stopped by PID after verifying they were both this repository's install commands.

The retry used exact stable versions published before the cutoff and `--legacy-peer-deps`; it completed successfully. Vitest then reported that its Vite peer was absent, so the exact stable `vite@8.3.0` package was added explicitly. The committed lockfile is the source of truth; normal builds use `npm ci` and do not need the troubleshooting command again. The repository commits `.npmrc` with a seven-day npm release-age setting. The workflow and Docker build check the configured value, while `npm ci` reproduces the locked package versions; neither check audits each locked release's age. See [supply-chain.md](supply-chain.md) for the corrected scope. This incident does not affect wallet runtime behavior.

The installed core stack is `@solana/kit@8.3.0`, `@solana/sysvars@8.3.0`, `@solana-program/system@0.14.1`, `@solana-program/stake@0.9.1`, `@solana-program/token@0.16.1`, and `@solana-program/token-2022@0.17.0`. The v0.2 adapter uses `@jup-ag/lend@0.0.108`, `@jup-ag/lend-read@0.0.14`, and `bn.js`; Jupiter-specific legacy types remain under `src/integrations/jupiter-lend/`. `@solana/web3.js` is also used by `src/integrations/stake-activation.ts` to call the stake activation RPC that is not exposed by the Kit RPC client. The core wallet and transaction pipeline remain on Kit.

## Source layout

`src/cli.ts` parses only startup flags and chooses one-shot or REPL execution. `src/shell/` owns tokenization, command completion, history filtering, help, hidden prompts, and readline. `src/commands/` contains user-facing handlers. `src/config/` handles precedence and permissions. `src/wallet/` is the only layer that reads or decrypts key material. `src/solana/` contains Kit RPC access, exact amounts, token decoding, validators, and transaction helpers. `src/integrations/jupiter-lend/` isolates Jupiter's legacy SDK types. `src/integrations/stake-activation.ts` isolates the legacy web3 connection used for the RPC activation-state query. `src/output/` separates JSON and human output.

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

`jupiter-lend status` follows the same read-only rule. It uses `@jup-ag/lend-read` with the public wallet address and reports the SDK's supplied, withdrawable, receipt-share, and raw rate fields. Jupiter Lend writes use `@jup-ag/lend` only to construct explicit Earn instructions, then convert them into the common Kit message and signer pipeline. Before network reads or writes, the configured RPC endpoint's genesis hash must match the selected mainnet or devnet cluster.

## Keystore format and recovery behavior

Each `wallets/<uuid>.json` contains only version, kind, public address, Argon2id parameters/salt, AES-GCM nonce/tag, and ciphertext. The passphrase is never stored. AAD is a deterministic JSON representation of public metadata; changing the public address or KDF/cipher metadata makes GCM authentication fail. `wallets.json` contains UUIDs, aliases, public addresses, timestamps, and the saved default, but no encrypted or plaintext key material. The root `keystore.json` is consulted only by explicit `wallet migrate <alias>`.

Keystore writes create a unique file with create-only permissions and publish it under a UUID using a hard link, so a preexisting key is never overwritten. Registry updates use a store lock and atomic replacement. Import verifies a decrypt-and-derive round trip before publication. If publication leaves a UUID keystore without registry metadata, recover it with `wallet recover <uuid> <alias>`; never delete it automatically. The full storage and selection contract is documented in [the implementation specification](../specs/multiple-wallets-implementation.md).

The accepted key inputs are base58 32-byte seeds or 64-byte Solana expanded keypairs, plus JSON byte arrays from a Solana CLI keypair file. Mutable decoded key buffers are filled after use. JavaScript GC/CryptoKey lifetime limitations remain documented in the README.

## RPC and amount rules

All RPC clients are created from the session config and use the configured commitment. RPC data is treated as untrusted and application-specific token/stake shapes are checked before use. Monetary values stay in `bigint`: SOL uses nine decimals and token amounts use the mint's on-chain decimals. Scientific notation, negative values, leading-zero forms, excess precision, and silent rounding are rejected.

Token reads query both the legacy Token Program and Token-2022. Basic Token-2022 transfers use the checked instruction, but mints with extensions are refused because the transfer semantics need explicit support. No third-party token-list metadata is used.

Native staking uses the official generated System and Stake clients. The stake create path is `CreateAccountWithSeed`, `Initialize`, and `DelegateStake`, with the wallet as both authorities and a blockhash-derived seed bounded to System Program seed length. Required Rent, Clock, StakeHistory, and StakeConfig accounts are inserted explicitly because the pinned generated Stake package does not model all builtin positional sysvars. Rent and minimum delegation are queried dynamically. Stake discovery makes two server-side `getProgramAccounts` queries, one for staker and one for withdrawer, rather than downloading and filtering all stake accounts locally. Stake activation is read from the configured RPC before listing or withdrawing; the CLI does not equate a passed deactivation epoch with complete cooldown. A future lockup is checked against chain time and epoch, with the custodian authority honored.

## History and completion safety

History is capped at 1,000 persisted entries, stored mode `0600`, and rejects lines containing private-key, secret-key, seed-phrase, mnemonic, password, or passphrase terms. Completion is memory-only public metadata: cached mints, known stake accounts, and recently inspected validator vote accounts. It never performs a network request synchronously, unlocks the keystore, signs, or broadcasts. Unknown command flags are rejected instead of being silently ignored.

## Validation record

Run from the repository root:

```bash
npm test
npm run build
npm run format:check
```

The current offline suite covers exact decimal parsing, large bigint amounts, parser quoting and flags, command completion, history filtering, keystore round trips, wrong passwords, authenticated metadata tampering, atomic replacement refusal, file mode, absence of plaintext key fields, Stake Program sysvar account order, cluster/RPC session safety, exact USDC conversion, mainnet-only lending gating, and Jupiter instruction conversion. Docker E2E is kept separate because it requires Docker and a PTY; it must be run against `SOL_WALLET_E2E_IMAGE`, never against `tsx` or the source tree. The workflow fails before publication if the image reference, Docker, pexpect, or any E2E test is missing, and uploads a method log plus image metadata on E2E failure.

The Solana `mainnet` naming update passed Prettier, Black, all 24 offline unit tests (including strict cluster-name validation), TypeScript lint/build, and `git diff --check`. At that time, Docker E2E was not run locally; GitHub Actions was the configured Docker test environment.

Before committing, TypeScript/JSON/Markdown/YAML changes are formatted with Prettier `3.6.2`, and the Python E2E harness is formatted with Black `25.1.0`; the repository rule for this is recorded in `AGENTS.md`.

An earlier local Docker setup exposed bind-mounted host directories as root-owned inside the container, causing the secure non-root runtime to receive `EPERM` while enforcing the `0700` config directory. The host now has a working Docker daemon, and the full image E2E suite passed against the exact image built locally on 2026-09-26. The earlier runtime limitation is retained here as historical context, not as a current blocker.

Do not claim a devnet/mainnet write was tested unless an opt-in integration or manual smoke run is recorded separately. Automated tests must use the disposable public fixture under `test/fixtures/`, generate ephemeral test keys inside temporary directories, or use a local/mock environment. Never use a developer or production wallet in tests.

## Docker release contract

`Dockerfile` is multi-stage. The build stage runs `npm ci`, tests, and `npm run build`, then prunes development dependencies. The runtime stage contains `package.json`, production `node_modules`, and `dist` only, runs as `solwallet` (UID/GID `10001` by default), and starts directly at `dist/cli.js`. The documented mount is `/home/solwallet/.config/sol-wallet`; direct callers should pass their host UID/GID, while `scripts/sol-wallet` does that automatically.

The intended CI order is formatting, source tests, `linux/amd64` image build, PTY/mock-RPC E2E against that exact tag, then GHCR authentication and push. Pushes to the repository's `main` or `master` branch and version tags trigger the workflow; pull requests never push. Branch pushes publish `latest`, the branch name, and the bare seven-character commit hash (for example `master` and `36f2cc6`). Version tags also publish the version, version without `v`, and minor-series tag (for example `v0.2.0` publishes `v0.2.0`, `0.2.0`, and `0.2`). CI must not upload mounted wallet directories, passwords, private keys, or arbitrary logs.

The post-review GitHub Actions run `35480368693` passed formatting, 18 unit tests, the TypeScript build, the exact-image Docker build, all 8 Docker E2E tests, GHCR authentication, and the exact tested-image push. The local container runtime cannot reproduce the runner's bind-mount ownership behavior, so this GitHub result is the authoritative Docker validation for this workspace.

The post-review v0.2 GitHub Actions run `35482612396` passed dependency installation, formatting, 23 unit tests, the TypeScript build, the exact-image Docker build, all 9 Docker E2E tests, GHCR authentication, and the exact tested-image push. No live mainnet lending write was performed; the v0.2 unit and CI tests intentionally stop at deterministic instruction conversion, safety gates, and the existing mock-RPC transaction coverage.

### v0.3 multiple-wallet implementation

Local validation on 2026-09-26 passed Prettier formatting and checks, Black
formatting and checks for the Python E2E tests, TypeScript lint/build, all 31
unit tests, documentation link checks, and `git diff --check`. A direct local
PTY smoke test imported the disposable fixture with a hidden passphrase, listed
the wallet, emitted status JSON, and exited cleanly; its temporary configuration
was removed afterward. The unit suite verifies current/default separation,
rename stability, writer contention, UUID symlink rejection, refusal of piped
passphrases, and an Ed25519 signature produced by the selected wallet's key.

The `linux/amd64` Docker image built successfully, including its 31 unit tests
and production TypeScript build. The exact-image Docker E2E suite then passed all
13 tests locally. Coverage includes two-wallet import and selection, alias
changes, a signed mock-RPC transaction, legacy migration, startup overrides,
invalid wallet selection, piped-passphrase rejection, and shell completion.
GitHub Actions will repeat these gates on the pushed commit before publishing.

## Known operational limits

- The mainnet and devnet public RPC defaults are configurable and are not guaranteed available.
- Read-only commands still need a network when they query chain state; `address` and `wallet info` do not.
- A submitted transaction whose confirmation times out is not retried automatically; the signature is shown so it can be inspected.
- The current token sender supports basic checked transfers and refuses Token-2022 extension mints.
- Jupiter Lend requires mainnet and canonical USDC; no live mainnet lending write has been executed by automated validation.
- `npm audit --omit=dev` currently reports upstream transitive advisories through the legacy Jupiter SDK dependency graph; see [jupiter-lend.md](jupiter-lend.md) before any release dependency refresh.
- The runtime image strips the unused Jupiter read-SDK build/test toolchain after production pruning; the source install still retains those upstream dependency declarations for reproducible SDK use.
- Stake account JSON parsing follows the current generated/RPC shapes and deliberately reports `unknown` for locally registered accounts that cannot be discovered or decoded.
- There is no mnemonic import, key replacement, cloud backup, hardware wallet, dApp integration, or arbitrary serialized transaction signing.
