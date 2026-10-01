# Jupiter Lend yield display

## Goal

Show current base/rewards/total APR and estimated APY in Jupiter status and
deposit previews; include total APR in wallet status and a deposit annual yield
estimate. Add tests, docs, commit/push and verify GitHub CI.

## Decisions

- Pinned SDK: supply APR is basis points; rewards APR is percentage scaled by
  1e12. Normalize separately and use integer arithmetic.
- Estimated APY assumes daily compounding for 365 days at unchanged current
  rates; annual USDC estimate excludes fees and is not earned-interest history.
- Reuse existing pool reads without API keys or dependencies. Missing/invalid
  rates must say unavailable while preserving successfully read balances.
- Mainnet-only integration: deterministic positive coverage, Devnet rejection
  guard; no Mainnet test writes.

## Progress

- [x] Inspect clean checkout at a7023e0, Jupiter skills, current SDK and docs.
- [x] Implement shared yield calculations and output on all three surfaces.
- [x] Add conversion, output, missing-data and guard regression tests; docs.
- [x] Format, validate, and review the implementation and intended diff.

## Validation

- `npm test`: 121 tests passed across 22 files, including 17 focused yield tests.
- TypeScript lint/build, Prettier, Black25.1.0 (all 11 Python files), and
  `git diff --check` passed.
- Linux/amd64 `sol-wallet:yield-e2e` image built; all 22 Docker E2E tests passed.
  Jupiter status/deposit dry-run Devnet guards reject without RPC requests.
- No live Devnet suite or Mainnet writes were run. Positive-path Jupiter yield
  validation is deterministic, as required for this mainnet-only integration.
- Black/pexpect were installed only in temporary
  `/tmp/sol-wallet-yield-validation.IW6xas/venv`; no system packages or runtime
  dependencies were changed. Existing Docker/npm warnings did not block tests.

Implementation and local validation are complete. The user authorized commit,
push, and checking the resulting GitHub workflow; report publication results in
the final handoff.
