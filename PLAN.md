# Review findings remediation

## Current task

- Complete checkpoint `ac77a3a`: consolidated specifications and saved the
  review findings before fixes, per user instruction.
- Complete: fixed all ten review findings, including transaction
  ambiguity/expiry, stale stake hints, wrapper JSON output, status behavior,
  bounded KDF settings, and Devnet lifecycle ownership/resumption/workflow gates.
- Validation passed: 78 unit tests; lint/build; formatting; Black and Python
  compilation; Node syntax; diff check; fresh Linux/amd64 image and all 19 local
  Docker/Python E2E tests. Live Devnet writes were not run.
- `docs/review-2026-09-27.md` and `docs/devnet-e2e-plan.md` record fixes,
  decisions, and validation. No system packages installed.
- The review/specification checkpoint `ac77a3a` was pushed before implementation;
  the user has now requested this completed remediation be committed and pushed.

## Previous implementation handoff

## Goal

Add persistent Devnet on-chain end-to-end coverage for network-facing CLI
commands without weakening deterministic CI or risking Mainnet funds.

## Current state

- [complete] Added the standing real-Devnet E2E rule to `AGENTS.md`.
- [complete] Added scheduled/manual Devnet smoke workflow, disposable SOL/token
  fixtures, method/status-only RPC recording proxy, and no-broadcast assertions.
- [complete] Added an optional resumable stake lifecycle runner guarded by a
  dedicated Devnet-only GitHub secret and default-branch workflow conditions.
- [complete] Corrected the Devnet genesis hash and added a regression test;
  the prior wrong value was duplicated in the mock fixture.
- [complete] Expanded the Devnet guide and testing/security docs with setup,
  scope, limits, cleanup, secret-handling, and actual validation outcomes.
- [complete] Committed and pushed `9aef6a9` to `master`; the Docker workflow
  passed and published the tested image.
- [complete] Updated workflow action majors to native Node 24 releases after
  CI reported Node 20 runtime deprecation warnings; follow-up CI passed.
- [complete] Pinned both workflows to Ubuntu 24.04 after GitHub announced the
  `ubuntu-latest` migration to Ubuntu 26; final CI passed and published.

## Constraints and decisions

- Keep mock-RPC Docker E2E as the PR gate; Devnet public RPC/faucet availability
  is not deterministic and the live workflow does not run on pull requests.
- Verify the official Devnet genesis before faucet requests, signing, or CLI
  writes. Never submit test writes to Mainnet.
- Smoke wallets and token fixtures are generated in a temporary directory.
  Jupiter Lend remains mainnet-only; only its Devnet guard is tested live.
- Full native stake coverage spans epochs and requires the optional protected
  Devnet key secret. Advance at most one safe lifecycle step per invocation.
- Do not retry a faucet transaction when its result is unknown. The public
  faucet returned a 429 during local validation; use a configured dedicated
  Devnet RPC provider or wait for the faucet limit to clear.
- The implementation and workflow maintenance commits are pushed to `master`.

## Validation

- 65 unit tests passed; TypeScript lint and build passed.
- Linux/amd64 Docker image build passed; all 16 Docker E2E tests passed,
  including tests that the proxy retains no signed transaction payload and
  that an HTTP 429 does not trigger an airdrop retry.
- Prettier, Black, Python compilation, and Node syntax checks passed after the
  final no-retry edit.
- Live Devnet genesis verification passed. Two faucet attempts failed at setup
  (first RPC internal error; second HTTP 429); no CLI command transaction was
  submitted. See [the Devnet validation record](docs/devnet-e2e-plan.md).
- GitHub public status reported all selected components operational before
  pushing.
- Initial push Actions run [36282996061](https://github.com/cainiaocome/solona-wallet-cli/actions/runs/36282996061)
  passed every gate and published. It emitted Node 20 deprecation warnings;
  the follow-up action upgrade run [36283186689](https://github.com/cainiaocome/solona-wallet-cli/actions/runs/36283186689)
  passed and removed those warnings. Final Ubuntu 24.04 run
  [36283339265](https://github.com/cainiaocome/solona-wallet-cli/actions/runs/36283339265)
  passed every gate and published with no deprecation annotations.

## Remaining

- Re-run live smoke after faucet availability or a protected provider is
  configured; then record the actual outcome here and in `docs/`.
- Run the optional cross-epoch lifecycle only after the dedicated Devnet-only
  secret is configured; its completion requires later scheduled/manual runs.
