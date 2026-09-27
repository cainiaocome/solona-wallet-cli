# Implementation plan

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
- [existing local work] The stake-activation compatibility fix remains
  uncommitted and unpushed; preserve it with this task.

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
- User has now requested a commit and push; keep the scope to the changes
  listed in this plan and monitor the resulting GitHub Actions run.

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
- GitHub workflow has not run yet; the requested push is pending.
- GitHub public status reported all selected components operational before
  pushing.

## Remaining

- Re-run live smoke after faucet availability or a protected provider is
  configured; then record the actual outcome here and in `docs/`.
- Run the optional cross-epoch lifecycle only after the dedicated Devnet-only
  secret is configured; its completion requires later scheduled/manual runs.
