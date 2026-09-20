# Security, testing, and release safety

This project is intentionally a personal wallet, not a custody service. Read
this document before putting any value on an address controlled by it.

## What the wallet protects

- The private key is not accepted as a CLI argument or environment variable.
- The keystore passphrase is requested interactively and is not stored.
- The keystore uses Argon2id to derive a 32-byte encryption key and AES-256-GCM
  to encrypt the normalized Solana secret key.
- Public keystore metadata is authenticated as AES-GCM additional authenticated
  data, so changing the public address or crypto parameters invalidates the
  ciphertext.
- New keystores are written through a unique temporary file, synced, chmod'ed
  to `0600`, and atomically renamed. Existing keystores are not overwritten.
- A signer is created only after validation, simulation, and confirmation.
- Secrets are filtered from shell history and redacted from verbose error
  details where practical.
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
- Protocol risk, smart-contract bugs, validator behavior, token authorities,
  and market risk are outside the wallet's control.

## Safe handling rules

1. Keep the original private key in an independent secure backup.
2. Use a separate disposable wallet for tests and manual smoke checks.
3. Prefer devnet for learning and `--dry-run` for every unfamiliar write.
4. Verify the cluster, destination, asset mint, amount, and fee before
   approving a transaction.
5. Treat a transaction signature as sensitive operational data: record it with
   its cluster, but never confuse it with a private key.
6. After a timeout, inspect the signature before retrying.
7. Never add secrets to `.env`, `config.json`, fixtures, issue text, logs, or
   commit history.
8. Do not run `npm audit fix` blindly against the pinned Jupiter SDK graph;
   review SDK compatibility and the resulting lockfile together.

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
instruction layout, lending gates, signer binding, and other deterministic
boundaries.

The source test command does not prove that a Docker image works. The image
has a separate build and E2E path.

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
transaction path. Publication happens only after all gates pass. Pull requests
run the gates but do not publish; pushes to the main branch and version tags
publish according to `.github/workflows/docker.yml`.

Branch pushes publish `latest`, the branch name, and the bare seven-character
commit hash. For example, a master push publishes `master` and `abc1234`
alongside `latest`. Version-tag pushes publish the version-specific tags. The
host wrapper defaults to the repository's `master` image and accepts
`SOL_WALLET_IMAGE` for overrides.

This workspace may not have a usable Docker daemon or the same bind-mount
ownership behavior as the GitHub runner. When local Docker cannot run the PTY
tests, record that honestly and use the GitHub Actions run as the authoritative
image validation. Do not weaken the E2E test or claim it passed locally.

## Dependency notes

The main wallet core uses `@solana/kit` and generated Solana program clients.
The Jupiter v0.2 adapter is the only place that imports the legacy Jupiter SDK
types and its direct compatibility dependencies. The runtime image removes
unused upstream build/test tools after production pruning.

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
Docker harness. Unit tests inject fake clients or test pure conversion logic.
No automated test should unlock a developer wallet or broadcast a real
mainnet lending transaction.

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
