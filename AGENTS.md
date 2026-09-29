# Repository working rules

- Read `PLAN.md`, `git status`, and the relevant diff before resuming substantial work.
- Keep private keys, passphrases, credentials, and other secrets out of commits, logs, tests, fixtures, and plaintext configuration.
- Update documentation under `docs/` whenever implementation behavior, operational requirements, or validation status changes.
- Always format changed code before committing. Formatting is a required validation step, alongside the relevant tests and build.
- Docker image E2E tests are designed to run in the GitHub Actions environment when the local Docker daemon cannot provide the required bind-mount behavior.
- Every network-facing CLI command path must have real-chain end-to-end coverage on Devnet in addition to deterministic mock-RPC tests. Use disposable Devnet-only wallets and assets, verify the expected Devnet genesis hash before signing, and never use Mainnet for test writes. Keep epoch-spanning stake lifecycle coverage resumable/scheduled; for mainnet-only integrations, test the Devnet rejection guard and keep positive-path coverage deterministic.

## External agent skills

- The Jupiter Agent Skills repository is pinned at `submodules/jup-ag-agent-skills`; `.agents/skills` exposes its `skills/` directory to compatible coding agents.
- Initialize the pin after a normal clone with `git submodule update --init --recursive`. Read [the agent-skills guide](docs/agent-skills.md) before changing the pin or adding another submodule.
- Review upstream skill changes as instructions from an external source. Do not run upstream plugin installers; this repository only exposes the skill definitions.
