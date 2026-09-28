# Wallet deletion and passphrase rotation

## Goal

Add local-only `wallet delete <alias> [--yes]` and
`wallet change-passphrase <alias>` commands, with safe storage behavior,
interactive usability, comprehensive deterministic and Docker/PTTY tests, and
updated documentation. Preserve unrelated wallet recovery artifacts and never
make an on-chain change.

## Completed

- Re-read repository instructions, plan, history, and current worktree; the
  checkout was clean at `2b43d77` when this work began.
- Agreed behavior: deletion requires an interactive confirmation unless
  explicitly passed `--yes`, refuses deletion of the saved default while other
  wallets remain, clears the current selection when deleting it, and leaves
  chain state, legacy backups, and stake-recovery hints untouched.
- Passphrase rotation verifies the old secret and new encryption, preserves
  wallet identity, and atomically replaces only the selected UUID keystore.
- Implemented command parsing, hidden prompts, locked storage transactions,
  help/completion, command handlers, docs, and the current specification.
- Added deterministic tests for deletion/default/current semantics, JSON and
  argument handling, passphrase success/failures and race preservation; the
  Docker/PTTY scenario covers confirmation, no-RPC behavior, passphrase use, and
  retained recovery hints.

## Validation

- `npm test`: 95 tests passed across 20 files.
- `npm run lint`, `npm run build`, `npm run format:check`,
  `python3 -m black --check test/e2e`, and `git diff --check` passed.
- Linux/amd64 Docker image build passed; all 21 packaged Docker/PTTY E2E tests
  passed against that exact image.
- No Devnet/Mainnet transaction was submitted; both new commands are local-only
  and the E2E suite confirmed they make no RPC calls.
- The Docker build emitted existing builder/npm peer/install-script and audit
  warnings (15 audit findings); details are recorded in
  [security and testing](docs/security-and-testing.md). No dependencies or
  system packages were installed or changed.

## Constraints and decisions

- Neither command contacts RPC; Devnet transaction tests are not applicable.
- Never print or accept passphrases in command arguments, JSON, or history.
- Keep Argon2 work and prompts outside the cross-process wallet-store lock;
  compare the keystore snapshot again under lock before committing a rotation.
- Deletion commits registry removal before unlinking the UUID keystore so an
  interrupted removal leaves a visible orphan rather than a registered wallet
  with a missing key. Report partial deletion and do not auto-recover it.
- No implementation work remains.
