# Full-project review remediation — 2026-09-27

This document records the follow-up to the full-project Claude Code review of
`master` at `6202b18`. It explains what changed and why, including the tests
added so future maintainers can see how each failure is detected. Claude's
generated report remains in the local, git-ignored
`claude-code-review-result/` directory; this tracked document records the
actionable findings and remediation for future checkouts.

## Solana account-data encoding

Solana's `getAccountInfo` RPC returns account data using an encoding chosen by
the client. In the pinned Solana Kit version, omitting `encoding` selects
legacy base58. The RPC intentionally limits base58 account data to 128 bytes.
That is too small for an SPL token account (165 bytes) or a native stake
account (200 bytes). A missing account may appear to work because there is no
data to encode; the same lookup fails once the account exists. This is why a
first transfer to a new token account can succeed while a later transfer to
that same account fails.

The destination lookup in `token send` now explicitly requests `base64`, as do
the stake-registry and stake-close existence checks. The resumable Devnet stake
runner uses the same encoding when it verifies whether a persisted stake
account still exists. The Jupiter Lend destination lookup already had this
fix.

Regression coverage has two layers:

- The unit suite verifies the explicit encoding in transaction/account lookup
  helpers.
- The Docker mock RPC rejects a missing or base58 encoding for a 165-byte
  account. Its one-shot test runs token send with both a missing and an
  existing destination ATA, verifies the rent difference and simulation, and
  proves dry-run did not broadcast.

The real Devnet smoke runner already sends to the same fixture recipient twice
for each token mint, covering the existing-ATA branch against the real RPC
when the scheduled/manual Devnet run reaches those commands. The latest local
faucet limitation is recorded in [the Devnet test plan](devnet-e2e-plan.md);
Docker and mock-RPC CI remains deterministic and runs on every push/PR.

## Container configuration boundary

Docker does not automatically copy the host process environment into a
container. The launcher now forwards only the supported network settings when
they are set: `SOL_WALLET_CLUSTER`, `SOL_WALLET_RPC_URL`, and
`SOL_WALLET_COMMITMENT`. `SOL_WALLET_CONFIG_DIR` continues to select the host
directory mounted for wallet files; it is not a CLI setting inside the
container.

The wrapper mounts only the wallet directory, not the caller's current
directory, so it does not read a host `.env`. README and the beginner guide
show how to export the supported settings before running the wrapper. Running
from source can still load `.env` from the process working directory. Wrapper
tests verify that network variable names are passed, values are not copied to
test logs, the config mount stays correct, and Docker pull output remains on
stderr so JSON stdout is clean.

## Stake-create recovery and stake account lookups

The stake-create transaction signature and derived stake-account address are
known locally after signing, before the first RPC broadcast. The CLI now saves
that public recovery hint before broadcast. If the RPC accepts a transaction
but its response is lost, or confirmation times out, the error reports both
the transaction signature and the stake-account address. The error details
also say whether the local hint was saved. The CLI does not retry an uncertain
write; users should inspect the signature and run `stake list` before deciding
what to do next.

This behavior preserves the distinction between **unknown outcome** and
**failed transaction**. A transport error is not proof the network rejected
the transaction. A pre-broadcast recovery hint can briefly refer to an account
that was never created, but `stake list` reconciles hints against an
authoritative on-chain lookup and retires one only after a successful response
confirms the account is absent.

Tests cover the recovery error details, authoritative hint retirement,
conservative retention when the RPC lookup fails, and explicit base64 account
lookup options. The Devnet lifecycle runner still refuses to operate on stake
accounts that do not match its saved test identity.

## Human, JSON, and shell-history behavior

- Tab completion now offers cached vote-account addresses after
  `stake create ... --validator ` while still offering flags when the user is
  completing a flag.
- `wallet import --json` displays the derived public address on stderr before
  asking for address confirmation. The final JSON result remains the only
  document on stdout.
- Command history retains public addresses, mints, and transaction signatures
  in recognized command-argument positions. It continues to exclude
  secret-bearing command words, valid 64-byte Ed25519 keypairs, raw hex, and
  JSON byte arrays. A 32-byte base58 value is inherently ambiguous: it can be a
  public address or a raw seed. The CLI cannot reliably distinguish those
  meanings, so users must not paste a raw seed into a command argument. The
  hidden wallet-import prompt and keypair-file import remain the supported
  secret-input paths.
- `tx inspect` validates the input as a 64-byte base58 Solana signature before
  contacting the configured RPC, so a typo is a local input error rather than
  a provider error.

These behaviors have focused parser/history and wallet-import tests. Public
addresses and signatures are not private keys, but still identify wallets and
transactions; history remains a local mode-0600 file.

## Confirmation polling and code cleanup

`finalized` confirmation now allows up to about 60 seconds (120 half-second
polls), while `processed` and `confirmed` retain the 30-second window. Recent
signature-status queries omit historical search to reduce per-poll RPC work;
the expiry-boundary recheck and final poll request history so an older included
transaction is not mistaken for a missing one. A fake-timer unit test exercises
the full finalized timeout and checks that historical search is deferred.

The review's small cleanup notes were also handled: unused imports were
removed, lending builds one RPC client per command, stake deactivate/withdraw
do not repeat the cluster assertion already performed by their controlled
account lookup, and the `tx inspect` signature path is now validated before
RPC use.

RPC URL disclosure remains the previously accepted behavior: `set rpc-url`
echoes the supplied value and an interactive command may be retained in
history, while `status` and `show config` sanitize their displayed endpoint.
No broad redaction change was made; this known difference is now documented in
the CLI/security guide and next to the command implementation.

## Validation record

Final local validation completed before commit:

- `npm test`: 87 tests passed across 20 files.
- `npm run lint` and `npm run build`: passed.
- `npm run format:check`, Black check (11 Python files), Python compilation,
  Bash syntax, ShellCheck, and `git diff --check`: passed.
- Linux/amd64 Docker image build: passed. The build emitted npm peer,
  audit, and install-script policy warnings; it did not fail.
- `SOL_WALLET_E2E_IMAGE=sol-wallet:e2e python3 test/e2e/run_tests.py`: 21
  Docker/Python E2E tests passed, including the existing-ATA path and mock RPC
  encoding test.

The final run includes the stake-create regression proving the local recovery
hint is present before the fake broadcast fails and that the error preserves
signature/address context. GitHub Actions status is pending push; its URL and
result will be recorded after the workflow completes. No Mainnet transaction
or real-chain write was part of this remediation. The dedicated chain-writing
tests remain isolated to Devnet, verify the expected genesis hash, and use
disposable test wallets. No system packages were installed.
