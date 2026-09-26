# Implementation plan

## Goal

Implement multiple named wallets from `specs/multiple-wallets-design.md` and
`specs/multiple-wallets-implementation.md`, while preserving existing command
and signing safety.

## Current state

- [complete] Product and implementation specifications reviewed.
- [complete] UUID keystores, strict alias registry, atomic writes, writer lock,
  duplicate checks, interrupted-import recovery and mode/symlink checks.
- [complete] Explicit legacy migration and recovery by UUID, keeping the legacy
  encrypted file as a recovery copy.
- [complete] Startup default/`--wallet`, session-local `wallet use`, saved
  `wallet default`, aliases, info/list/rename, status, prompt, help, and completion.
- [complete] Captured wallet identity is passed to SOL, token, staking, and
  Jupiter signers; outputs and previews identify the selected wallet.
- [complete] Stake hints are isolated by wallet/network; caches clear on wallet,
  cluster, RPC, and commitment changes.
- [complete] Beginner, backup, migration, recovery, security, source, and command
  documentation updated.
- [complete] Local implementation, documentation, source comments, and unit
  acceptance coverage.
- [complete] Docker image build and all 13 image-based E2E acceptance tests
  passed locally on 2026-09-26.
- [in progress] Final review, commit, push, and verification of the resulting
  GitHub Actions run.

## Constraints

- One encrypted keystore per wallet: `wallets/<uuid>.json`; aliases/default live
  in `wallets.json` and never form paths.
- The saved default affects new processes only; `wallet use` is session-local.
- Existing root `keystore.json` is read only by explicit migration.
- No wallet deletion, generation, watch-only support, secret cache, or deferred
  protocol scope.
- Keep the existing feature scope limited to the two wallet specifications;
  do not add deferred wallet-management or protocol features.

## Validation log

- Initial repository was clean at `48f6064` before implementation.
- `npm run format`, `npm run format:check`, `python3 -m black test/e2e`, and
  `python3 -m black --check test/e2e`: pass after the final code and
  documentation formatting pass.
- `npm test`: 31 tests pass, including UUID registry behavior, separate current
  and default choices, wallet rename, writer contention, symlink rejection, and
  Ed25519 verification of the selected wallet's transaction signature.
- `npm run lint`, `npm run build`, and `git diff --check`: pass after final code
  changes.
- Direct local PTY smoke test: passed import with hidden TTY passphrase, list,
  status JSON, clean exit, UUID file creation, and no passphrase echo.
- `docker build --platform linux/amd64 -t sol-wallet:e2e .`: pass. The build
  includes all 31 unit tests and the TypeScript production build.
- `SOL_WALLET_E2E_IMAGE=sol-wallet:e2e python3 test/e2e/run_tests.py`: all 13
  image-based E2E tests pass locally, including wallet import/selection,
  transaction signing through mock RPC, migration, TTY safeguards, and shell
  completion.
- GitHub Actions for the requested push: pending until pushed and checked.
