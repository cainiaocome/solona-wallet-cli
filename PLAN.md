# Implementation plan

## Goal

Improve the interactive and human-readable CLI experience from the UX review
while preserving signing safeguards and line-oriented JSON behavior.

## Current state

- Baseline: clean `master` at `35bd90d`.
- Implementation commit `6e5f0c4` is pushed to `master`.
- [complete] `status` is an on-demand dashboard: it verifies RPC/network,
  reports SOL and aggregated token balances, and shows separate native-stake
  and mainnet Jupiter Lend positions. Failed sections remain unavailable, not
  zero; no RPC calls were added to shell startup.
- [complete] Human token, validator, stake, Jupiter, and transaction outputs are
  more scannable. Writes have action-specific confirmations, TTY-only progress,
  and receipts with signature, slot, wallet, network, and Explorer link.
- [complete] Added lightweight `--help`, no-wallet onboarding, help/usage/
  completion updates, beginner docs, and source comments for new boundaries.
- [complete] Added unit and Docker/PTTY E2E coverage and updated beginner docs.
- [complete] Commit/push and GitHub Actions validation; no workflow failures
  required fixes.

## Constraints and decisions

- Keep shell startup fast; `status` is the explicit RPC refresh.
- Do not treat an RPC failure as zero or combine liquid balances with stake or
  lending positions. Jupiter Lend is not queried on devnet.
- Keep exact integer monetary values and stable command JSON fields; status
  additions are additive and transaction summaries affect human output only.
- Keep transaction validation, simulation, confirmation, signing, and broadcast
  order unchanged. Progress text must not contaminate JSON output.
- Docker image E2E runs in GitHub Actions as well as the local Docker daemon.

## Validation completed

- `npm test`: 62 tests across 15 files pass locally and in the Docker build.
- `npm run lint`, `npm run build`, and `npm run format:check`: pass.
- `python3 -m black --check test/e2e` and `git diff --check`: pass.
- `docker build --platform linux/amd64 -t sol-wallet:ux-review .`: passes.
- `SOL_WALLET_E2E_IMAGE=sol-wallet:ux-review python3 test/e2e/run_tests.py`:
  all 14 Docker E2E tests passed.
- `docker run --rm sol-wallet:ux-review --help`: passed with clean help output.
- GitHub Actions run `36275799426` for `6e5f0c4` passed npm installation,
  formatting, all 62 unit tests, build, linux/amd64 image build, all 14 Docker
  E2E tests, GHCR authentication, and publication of the exact tested image.
