# Stake validator vote-account display fix — complete

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
- GitHub Actions run
  [36400977108](https://github.com/cainiaocome/solona-wallet-cli/actions/runs/36400977108)
  passed dependency policy, formatting, all 87 unit tests, TypeScript build,
  Linux/amd64 image build, all image E2E tests, and publication of the tested
  image.
- The credentialed live Devnet lifecycle was not run; no live-chain transaction
  was submitted.

## Remaining

No implementation work remains. Run the scheduled/manual Devnet lifecycle when
the dedicated disposable-wallet credential is available.
