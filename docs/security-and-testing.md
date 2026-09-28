# Security, testing, and release safety

This project is intentionally a personal wallet, not a custody service. Read
this document before putting any value on an address controlled by it.

## What the wallet protects

- The private key is not accepted as a CLI argument or environment variable.
- The keystore passphrase is requested interactively and is not stored.
- Each named wallet has an independently encrypted UUID-named keystore. The
  alias registry stores only public identifiers and the saved default.
- Each command captures one wallet identity before reading or building a
  transaction. The signer checks the encrypted file and derived key against
  that exact address before signing.
- The keystore uses Argon2id to derive a 32-byte encryption key and AES-256-GCM
  to encrypt the normalized Solana secret key.
- Public keystore metadata is authenticated as AES-GCM additional authenticated
  data, so changing the public address or crypto parameters invalidates the
  ciphertext.
- The keystore reader rejects unknown fields, so plaintext key data cannot be
  silently carried alongside the encrypted payload.
- New keystores are written to a unique temporary file, synced, and published
  under a UUID with create-only hard-link semantics and mode `0600`. Existing
  keystores are not overwritten; registry changes are locked and atomic.
- A signer is created only after validation, simulation, and confirmation.
- Secret-bearing command words, validated 64-byte keypairs, raw hex, and
  JSON-byte-array key material are filtered from shell history. Public
  addresses, mints, and transaction signatures in recognized command positions
  can be recalled. A 32-byte base58 value is ambiguous by format alone, so do
  not paste a raw seed into a command argument. Verbose error details are
  redacted where practical.
- Before creating a transaction, writes compare the RPC endpoint's genesis
  hash to the selected mainnet or devnet cluster.
- Stake withdrawal checks the calculated on-chain activation state and any configured
  time/epoch lockup before building the instruction.
- Solana token accounts (165 bytes) and stake accounts (200 bytes) are read
  using an explicit base64 encoding. Kit's omitted-encoding account overload
  requests base58, which Solana RPC rejects for account data over 128 bytes.
- The runtime image runs as a non-root `solwallet` user.

## What the wallet cannot protect

- A compromised operating system can read input, files, or process memory.
- JavaScript garbage collection does not guarantee perfect memory zeroization.
- A weak or reused passphrase weakens local protection.
- A person with the original private key can control the wallet even without
  this keystore.
- RPC providers see queried addresses and request metadata.
- A malicious or incorrect destination address can still receive a valid
  transaction. Address syntax validation is not identity verification.
- Simulation cannot guarantee future success because chain state can change.
- A confirmation timeout does not prove that a transaction failed.
- An RPC URL can contain provider credentials. As previously accepted for this
  project, `set rpc-url` displays the supplied URL and the typed command may be
  retained in local interactive history, while `status` and `show config`
  sanitize the displayed endpoint. Avoid credential-bearing URLs in commands
  that may enter history, or clear history after use.
- Stake activation is calculated client-side from the stake account, current
  epoch, and StakeHistory sysvar using Anza's maintained implementation. It
  uses standard account/epoch RPC methods instead of the removed
  `getStakeActivation` endpoint. If those inputs cannot be fetched or decoded,
  stake listing and withdrawal checks fail closed rather than guessing that
  funds are free. A regression test makes the mock endpoint reject the removed
  method while confirming activation still works through supported RPC calls.
- Protocol risk, smart-contract bugs, validator behavior, token authorities,
  and market risk are outside the wallet's control.

## Safe handling rules

1. Keep the original private key in an independent secure backup.
2. Use a separate disposable wallet for tests and manual smoke checks.
3. Prefer devnet for learning and `--dry-run` for every unfamiliar write.
4. Verify the cluster, destination, asset mint, amount, and fee before
   approving a transaction.
5. Enter wallet passphrases only through the hidden interactive terminal
   prompt; piped input is rejected.
6. Treat a transaction signature as sensitive operational data: record it with
   its cluster, but never confuse it with a private key.
7. After a timeout, inspect the signature before retrying.
8. Never add secrets to `.env`, `config.json`, fixtures, issue text, logs, or
   commit history.
9. Do not run `npm audit fix` blindly against the pinned Jupiter SDK graph;
   review SDK compatibility and the resulting lockfile together.

For wallet backups, migration from the old `keystore.json`, orphan recovery, and
stale store locks, follow [the multiple-wallet guide](multiple-wallets.md).

## Local validation

The normal source checks are:

```bash
npm run format:check
python3 -m black --check test/e2e
npm test
npm run lint
npm run build
git diff --check
```

`npm test` is offline. The unit suite covers exact decimal conversion, parser
behavior, history filtering, keystore encryption and tamper detection, stake
instruction layout and wallet/network registry isolation, signer binding, JSON
line framing and errors, wallet recovery and writer contention, and other
deterministic boundaries. Jupiter command tests use deterministic adapter
instructions and verify that the selected wallet signs deposit and withdrawal
transactions. Token-send Docker E2E covers both missing and existing
associated token accounts. Its mock RPC rejects a data query without base64
when the fixture is 165 bytes, reproducing the real JSON-RPC account-size
constraint deterministically.

The source test command does not prove that a Docker image works. The image
has a separate build and E2E path.

Network-facing CLI behavior also has a separate real-chain suite in
[the Devnet E2E guide](devnet-e2e-plan.md). It runs on a schedule or manually,
not on every pull request: it uses a faucet and submits disposable SOL and
token transactions. It verifies cluster genesis before funding and signing,
uses fresh temporary wallets, and checks resulting chain state. Dry-runs,
cancellations, unsupported integrations, and rejected stake states assert that
no transaction was broadcast. A separate optional runner advances a real
native stake account across epoch windows and requires a dedicated Devnet-only
GitHub Actions secret. Never configure a Mainnet key for these tests.

## Docker E2E and GitHub Actions

The repository's Docker workflow performs these gates in order:

```text
npm ci
  -> format check
  -> unit tests
  -> TypeScript build
  -> linux/amd64 Docker build
  -> PTY + mock-RPC E2E against that exact image
  -> GHCR login and push
```

The E2E harness checks the behavior a source test cannot see: non-root file
permissions, interactive prompts, wallet import, hidden input, completion,
JSON output, the runtime image's production dependencies, and the mock RPC
transaction path, including the existing-token-account transfer branch. It
decodes the submitted SOL, token, and stake transactions,
checks wallet B is the fee payer, and verifies each Ed25519 signature against
B's public key. Publication happens only after all gates pass. Pull requests
run the gates but do not publish; pushes to the main branch and version tags
publish according to `.github/workflows/docker.yml`.

The separate `.github/workflows/devnet-e2e.yml` workflow runs twice weekly and
supports manual dispatch from the default branch. It uses public Devnet unless
the optional `SOL_WALLET_DEVNET_RPC_URL` Actions secret selects a dedicated
provider; that secret is passed only to live test steps. A persistent lifecycle
key is exposed only to the optional lifecycle step on the default branch;
scheduled runs skip that step when the key secret is not configured. Read
[the Devnet E2E guide](devnet-e2e-plan.md) before enabling it, since it can
submit a real Devnet stake transaction and leave an account while it warms up
or cools down.

Branch pushes publish `latest`, the branch name, and the bare seven-character
commit hash. For example, a master push publishes `master` and `abc1234`
alongside `latest`. Version-tag pushes publish the version-specific tags. The
host wrapper defaults to the repository's `master` image and accepts
`SOL_WALLET_IMAGE` for overrides. It pulls the selected tag before each run
and stops if the pull fails, so it will not silently launch a stale cached tag.

This workspace may not have a usable Docker daemon or the same bind-mount
ownership behavior as the GitHub runner. When local Docker cannot run the PTY
tests, record that honestly and use the GitHub Actions run as the authoritative
image validation. Do not weaken the E2E test or claim it passed locally.

## Dependency notes

The main wallet core uses `@solana/kit` and generated Solana program clients.
The Jupiter v0.2 adapter contains the legacy Jupiter SDK types and direct
compatibility dependencies. `src/integrations/stake-activation.ts` contains
the narrow legacy web3 connection used to read stake activation status. The
runtime image removes unused upstream build/test tools after production
pruning.

The repository's `.npmrc` sets `min-release-age=7` for dependency resolution
and update operations. `npm ci` reproduces versions already in
`package-lock.json`; checking npm's configured value in CI and Docker does not
check each locked version's publish date. The lockfile provides repeatability,
while the release-age setting helps avoid selecting brand-new versions when
resolving updates. Neither control proves that a dependency is safe: older
compromised releases, malicious maintainers, and registry compromise remain
possible. See [supply-chain.md](supply-chain.md) for details.

`npm audit --omit=dev` currently reports upstream transitive advisories in the
pinned Jupiter SDK graph. This is documented rather than hidden. A future
upgrade should be treated as a protocol integration change: inspect the SDK
API, lockfile, audit report, instruction conversion, and full CI result
together.

## Testing without real funds

Use the deterministic public fixture only for tests:

```text
test/fixtures/disposable-keypair.json
```

The mock RPC in `test/e2e/mock_rpc.py` provides predictable responses for the
Docker harness. Multi-wallet E2E coverage generates its second random keypair
in a temporary directory at runtime; do not add another checked-in keypair.
Unit tests inject fake clients or test pure conversion logic. No automated test
should unlock a developer wallet or broadcast a real mainnet lending transaction.

## Review checklist for changes

Before merging a change, ask:

- Does a read-only command remain read-only?
- Are all monetary values exact integers until display time?
- Is the cluster and asset identity checked at the command boundary?
- Does a write simulate before signing and broadcasting?
- Is the signer still the only key-unlock boundary?
- Are errors typed and safe in both human and JSON modes?
- Are tests added for the failure path, not only the happy path?
- Is the source and `docs/` explanation updated?
- Was code formatted before commit?
