# Solana Wallet CLI implementation plan

## Goal

Implement the v0.1 Solana-only wallet described in `docs/spec.md`, with an interactive shell, encrypted local keystore, read-only wallet queries, safe transaction pipeline, native staking, Docker packaging, and tests.

## Current state

- TypeScript/ESM application, lockfile, tests, Docker packaging, wrapper, workflow, and operational documentation are implemented.
- Source build and offline unit tests pass.
- The local Docker image build passes its in-image test/build/prune stages.
- Docker PTY/mock-RPC E2E is present but not passing in this workspace because its Docker runtime exposes bind mounts as root-owned; the GitHub Actions workflow is the supported environment for that gate.

## Milestones

- [complete] Scaffold TypeScript project, parser, shell, configuration, output, and error model.
- [complete] Implement encrypted keystore and signer boundary.
- [complete] Implement read-only RPC commands.
- [complete] Implement SOL/token transaction pipeline.
- [complete] Implement native staking commands.
- [complete] Add Docker image, wrapper, mock RPC, E2E tests, and CI.
- [in progress] Run full validation and review the final diff; GitHub Docker E2E remains environment-dependent.

## Decisions / constraints

- Use stable `@solana/kit` and official generated Solana program packages; do not use `@solana/web3.js` in core code.
- Keep private-key and passphrase input out of CLI arguments and environment variables.
- Keep Jupiter Lend out of v0.1.
- Preserve the supplied `docs/spec.md`; update user-facing documentation as implementation lands.

## Validation

- `npm test`: 12 offline unit tests passing.
- `npm run build`: passing.
- `npm ci --dry-run --legacy-peer-deps`: passing.
- `docker build --platform linux/amd64 -t sol-wallet:e2e .`: passing, including in-image tests/build and production dependency pruning.
- Direct source TTY smoke test: shell boot, help, and clean exit passing.
- Direct deterministic mock-RPC test: SOL dry-run and signed confirmation path passing.
- Docker E2E: not completed locally because of bind-mount ownership behavior; run in GitHub Actions.
