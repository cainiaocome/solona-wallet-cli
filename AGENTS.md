# Repository working rules

- Read `PLAN.md`, `git status`, and the relevant diff before resuming substantial work.
- Keep private keys, passphrases, credentials, and other secrets out of commits, logs, tests, fixtures, and plaintext configuration.
- Update documentation under `docs/` whenever implementation behavior, operational requirements, or validation status changes.
- Always format changed code before committing. Formatting is a required validation step, alongside the relevant tests and build.
- Docker image E2E tests are designed to run in the GitHub Actions environment when the local Docker daemon cannot provide the required bind-mount behavior.
- Every network-facing CLI command path must have real-chain end-to-end coverage on Devnet in addition to deterministic mock-RPC tests. Use disposable Devnet-only wallets and assets, verify the expected Devnet genesis hash before signing, and never use Mainnet for test writes. Keep epoch-spanning stake lifecycle coverage resumable/scheduled; for mainnet-only integrations, test the Devnet rejection guard and keep positive-path coverage deterministic.
