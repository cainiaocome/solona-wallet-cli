# Solana Wallet CLI implementation plan

## Goal

Implement the v0.1 Solana-only wallet described in `docs/spec.md`, with an interactive shell, encrypted local keystore, read-only wallet queries, safe transaction pipeline, native staking, Docker packaging, and tests.

## Current state

- TypeScript/ESM application, lockfile, tests, Docker packaging, wrapper, workflow, and operational documentation are implemented.
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

## Decisions / constraints

- Use stable `@solana/kit` and official generated Solana program packages; do not use `@solana/web3.js` in core code.
- Keep private-key and passphrase input out of CLI arguments and environment variables.
- Keep Jupiter Lend out of v0.1.
- Preserve the supplied `docs/spec.md`; update user-facing documentation as implementation lands.

## Validation

- `npm run format:check`: passing with Prettier 3.6.2.
- `python3 -m black --check test/e2e`: passing with Black 25.1.0.
- `npm test`: 18 offline unit tests passing across four files.
- `npm run build`: passing.
- `npm ci --dry-run --legacy-peer-deps`: passing.
- `docker build --platform linux/amd64 -t sol-wallet:e2e .`: passing, including in-image tests/build and production dependency pruning.
- Direct source TTY smoke test: shell boot, help, and clean exit passing.
- Direct deterministic mock-RPC test: SOL dry-run and signed confirmation path passing.
- Direct non-TTY shell smoke test: piped `help`/`exit` exits 0; unknown flags exit 2.
- Deterministic mock-RPC smoke test: JSON SOL dry-run parses as one object and confirms no passphrase/output leakage.
- Docker E2E: GitHub Actions run 35480368693 passed all 8 image tests and published the exact tested image; Docker remains unavailable in this workspace.
