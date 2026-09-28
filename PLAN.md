# Stake validator vote-account display fix — implementation complete, CI pending

## Goal

Show the validator vote-account address returned by Solana's parsed Stake
Program RPC data in `stake list` and stake deactivation previews.

## Completed

- Read the JSON field `delegation.voter` in stake listing and controlled-stake
  previews; the former `voterPubkey` expectation did not match Solana's parsed
  RPC shape.
- Changed the RPC fixture to the real field name and asserted both JSON and
  human `stake list` output.
- Extended the resumable Devnet lifecycle check to compare the CLI result with
  an independent `getAccountInfo(jsonParsed)` response and validate deactivation
  preflight output.
- Updated implementation and Devnet-test documentation.

## Validation

- `npm test`: 87 tests passed across 20 files.
- `npm run lint`, `npm run build`, `npm run format:check`, Black, Python
  compilation, and `git diff --check` passed.
- Linux/amd64 Docker image build succeeded; all 21 Docker/Python E2E tests
  passed against that image.
- The credentialed live Devnet lifecycle was not run; no live-chain transaction
  was submitted.

## Remaining

- Commit and push the changes, then verify GitHub Actions for the pushed commit.
