# Repository working rules

- Read `PLAN.md`, `git status`, and the relevant diff before resuming substantial work.
- Keep private keys, passphrases, credentials, and other secrets out of commits, logs, tests, fixtures, and plaintext configuration.
- Update documentation under `docs/` whenever implementation behavior, operational requirements, or validation status changes.
- Always format changed code before committing. Formatting is a required validation step, alongside the relevant tests and build.
- Docker image E2E tests are designed to run in the GitHub Actions environment when the local Docker daemon cannot provide the required bind-mount behavior.
