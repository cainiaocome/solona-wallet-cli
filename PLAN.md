# Solana Wallet CLI implementation plan

## Goal

Implement the v0.2 Solana-only wallet described in `docs/spec.md`, preserving the completed v0.1 wallet and adding the narrowly-scoped mainnet USDC Jupiter Lend Earn integration with tests, documentation, and CI validation.

## Current state

- TypeScript/ESM application, lockfile, tests, Docker packaging, wrapper, workflow, and operational documentation are implemented.
- v0.1 is complete and published through the verified Docker/GHCR workflow.
- v0.2 Jupiter Lend adapter, commands, unit coverage, and documentation are implemented and published.
- Beginner documentation, command examples, architecture notes, security guidance, and source-level explanatory comments are now maintained under `docs/` and the main Web3 boundaries in `src/`.
- Source formatting, build, and offline unit tests pass.
- The local Docker image build passed its in-image test/build/prune stages before the review fixes.
- The Docker PTY/mock-RPC E2E is now a hard gate with PTY wallet import, signer unlock, completion, JSON config, and failure artifacts; it must be rerun by GitHub Actions because this workspace has no usable Docker daemon/bind-mount runtime.

## Milestones

- [complete] Scaffold TypeScript project, parser, shell, configuration, output, and error model.
- [complete] Implement encrypted keystore and signer boundary.
- [complete] Implement read-only RPC commands.
- [complete] Implement SOL/token transaction pipeline.
- [complete] Implement native staking commands.
- [complete] Add Docker image, wrapper, mock RPC, E2E tests, and CI.
- [complete] Run the post-review GitHub workflow and inspect its Docker E2E and publish result.
- [complete] Verify the current stable Jupiter Lend SDK APIs and isolate legacy web3 types at the adapter boundary.
- [complete] Implement mainnet canonical-USDC `jupiter-lend status`, `deposit`, `withdraw`, and `withdraw --all`.
- [complete] Add v0.2 unit tests and operational/dependency-risk documentation.
- [complete] Run v0.2 full validation and GitHub Docker workflow.
- [complete] Expand beginner documentation and annotate the Web3/security boundaries in source code.

## Decisions / constraints

- Use stable `@solana/kit` and official generated Solana program packages; do not use `@solana/web3.js` in core code.
- Keep private-key and passphrase input out of CLI arguments and environment variables.
- Keep Jupiter Borrow, arbitrary lending assets, leverage, and arbitrary serialized Jupiter signing out of v0.2.
- Canonical USDC is `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; do not make the first integration an arbitrary-mint feature.
- Keep legacy Jupiter types inside `src/integrations/jupiter-lend/` and the legacy stake-activation RPC helper inside `src/integrations/stake-activation.ts`; the wallet's core transaction pipeline remains on Kit.
- Preserve the supplied `docs/spec.md`; update user-facing documentation as implementation lands.

## Validation

- `npm run format:check`: passing with Prettier 3.6.2.
- `python3 -m black --check test/e2e`: passing with Black 25.1.0.
- `npm test`: 23 offline unit tests passing across five files.
- `npm run build`: passing.
- `npm run lint`: passing.
- `npm ci --dry-run --legacy-peer-deps`: passing.
- `npm audit --omit=dev`: reports upstream transitive advisories in the pinned Jupiter SDK graph; documented in `docs/jupiter-lend.md` and not auto-upgraded.
- `docker build --platform linux/amd64 -t sol-wallet:e2e .`: passing, including in-image tests/build and production dependency pruning.
- Direct source TTY smoke test: shell boot, help, and clean exit passing.
- Direct deterministic mock-RPC test: SOL dry-run and signed confirmation path passing.
- Direct non-TTY shell smoke test: piped `help`/`exit` exits 0; unknown flags exit 2.
- Deterministic mock-RPC smoke test: JSON SOL dry-run parses as one object and confirms no passphrase/output leakage.
- v0.2 command smoke tests: help/completion expose `jupiter-lend`; devnet lending is rejected before wallet/network use after the mainnet guard.
- Docker E2E: post-review GitHub Actions run 35482612396 passed all 9 image tests and published the exact tested image; Docker remains unavailable in this workspace.
- Documentation-only follow-up validation passes: Prettier, Black, 23 unit tests, TypeScript lint, build, and `git diff --check`.
- Image publication now includes branch, bare short-commit, and legacy `latest` tags; the wrapper defaults to the repository's `master` image tag.
- npm dependency installation now enforces the seven-day `min-release-age` policy in local installs, GitHub Actions, and Docker builds.
- Supply-chain validation passes locally with the shell override removed: project npm config reports `7`, and `npm ci --dry-run --legacy-peer-deps` succeeds. The changed Docker install path must be validated by the next GitHub Actions run because no usable local Docker daemon is available.
- Current review fixes are implemented: network reads and writes verify RPC genesis identity; keystore create-only writes are atomic; shell history detects raw key encodings; malformed boolean/value flags are rejected; confirmation checks status before expiry and includes signatures in errors; stake activation and lockup checks use RPC state; JSON preflight goes to stderr; npm age-policy documentation distinguishes resolution from lockfile reproduction. Formatting, Black, TypeScript lint/build, shell syntax, and diff checks pass. Unit and Docker E2E suites were not run in this pass.
- The host wrapper now pulls its selected image tag before each invocation and stops on pull failure rather than silently using stale cached content.
- Bare command groups display their usage and available subcommands instead of producing a self-referential unknown-command suggestion.
- The user-facing Jupiter integration command is named `jupiter-lend`, reserving `lend` for possible future multi-protocol routing.
