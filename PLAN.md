# Review remediation

## Goal

Fix the actionable findings from the 2026-09-27 full-project review, add
regressions and beginner-facing documentation, then format, validate, commit,
push to `master`, and confirm GitHub Actions passes.

## Current state

- [complete] Token-send destination lookup explicitly uses base64; the Docker
  mock models the large-account encoding limit and covers absent/existing ATAs.
- [complete] The wrapper forwards supported network environment settings;
  README now explains its host `.env` limitation.
- [complete] Validator completion, JSON wallet-import address confirmation,
  and command-history filtering improvements with regressions.
- [complete] Stake-create stores its signed recovery hint before broadcast and
  includes the known stake address on uncertain confirmation/broadcast errors.
- [complete] Stake-account existence checks use base64, including the resumable
  Devnet lifecycle's direct lookup.
- [complete] Finalized confirmation gets a longer polling window and historical
  lookup is deferred until the last poll (expiry-boundary checks remain).
- [complete] Address smaller review notes: validate `tx inspect` signatures,
  remove unused imports, reuse the lending RPC client, and avoid the duplicate
  stake cluster check.
- [complete] Update beginner-facing output, configuration, security, Devnet,
  and review-remediation documentation.
- [complete] Final local validation: 87 unit tests; lint/build; Prettier/Black,
  Python/Bash checks; Linux/amd64 image build; all 21 Docker/Python E2E tests.
- [complete] Added a mocked ambiguous stake-create regression proving the local
  hint is saved before broadcast and the error carries signature/address data.
- [in progress] Final diff review, commit/push to `master`, monitor Actions, and
  record the actual workflow result in `docs/`.

## Decisions and constraints

- Leave RPC URL credentials in command output/history as previously accepted;
  document this behavior accurately without widening disclosure elsewhere.
- No Mainnet transaction or live-chain write is part of this remediation.
- Keep real-chain tests Devnet-only and deterministic PR tests as the required
  CI gate. Do not install system packages.
- Commit only after formatting, tests, lint/build, and available Docker E2E
  validation pass; verify the pushed workflow before reporting completion.

## Validation so far

- Primary edits: `test/unit/transaction-safety.test.ts` and
  `test/unit/staking.test.ts` — focused tests and integrated run passed.
- Launcher subtask reported wrapper tests, lint, Prettier, ShellCheck, Bash
  syntax, and diff check passing.
- Token-send subtask reported unit tests, lint, build, Docker image and 16
  Docker/mock E2E tests passing. Re-run full validation after integration.
