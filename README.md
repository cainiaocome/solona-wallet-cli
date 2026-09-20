# Solana Wallet CLI

`sol-wallet` is a small, Solana-only command-line wallet for personal use. It keeps one imported Solana private key encrypted locally, supports read-only SOL and SPL/Token-2022 queries, SOL/token transfers, native staking, transaction inspection, and an interactive shell.

The v0.1 release artifact is a `linux/amd64` Docker image. Jupiter Lend, seed phrases, multiple wallets, swaps, hardware wallets, dApps, and arbitrary transaction signing are intentionally out of scope.

## Release image

```bash
docker pull ghcr.io/<owner>/sol-wallet:latest
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$HOME/.config/sol-wallet:/home/solwallet/.config/sol-wallet" \
  ghcr.io/<owner>/sol-wallet:latest
```

The image defaults to the non-root `solwallet` user (UID/GID `10001`). The direct example maps the caller's UID/GID so a host directory with mode `0700` remains writable; the wrapper does this automatically. The only persistent mount is the host directory above. It contains public configuration and metadata plus the encrypted `keystore.json`; the disposable container does not own the wallet state.

The optional wrapper provides normal CLI-like usage:

```bash
scripts/sol-wallet
scripts/sol-wallet -c "balance" --json
```

Set `SOL_WALLET_IMAGE` or `SOL_WALLET_CONFIG_DIR` to override the wrapper defaults.

## Local development

```bash
npm install
npm test
npm run build
npm run format:check
npm run dev
```

The code was tested with these exact stable dependency versions in the current lockfile: `@solana/kit 8.3.0`, `@solana/sysvars 8.3.0`, `@solana-program/system 0.14.1`, `@solana-program/stake 0.9.1`, `@solana-program/token 0.16.1`, `@solana-program/token-2022 0.17.0`, Node `>=24`, TypeScript `7.0.2`, Vitest `5.0.0`, Vite `8.3.0`, and Prettier `3.6.2`.

## First use

Start the shell and import a base58 key through a hidden prompt:

```text
wallet import
address
balance
```

A Solana CLI JSON keypair can be imported as an input file:

```text
wallet import --keypair-file /path/to/id.json
```

The keypair file is never modified or deleted. Private keys and keystore passwords are deliberately not accepted as CLI arguments or environment variables.

## Commands

```text
help
wallet info
address
balance
token list
token balance <mint>
token send <mint> <destination> <amount>
send <destination> <amount>
validators --limit 20
stake create <amount> --validator <vote-account>
stake list
stake deactivate <stake-account>
stake withdraw <stake-account> [--amount <amount>]
tx inspect <signature>
```

Every write command supports `--dry-run`, and confirmation can be skipped with `--yes` after validation and simulation still succeed. Automation uses the same parser and handlers as the shell:

```bash
sol-wallet -c "balance" --json
sol-wallet -c "stake list" --cluster devnet --json
```

The default cluster is `mainnet-beta`; use `--cluster devnet`, `SOL_WALLET_CLUSTER=devnet`, or `set cluster devnet` for a session change. The current cluster is shown in prompts and write summaries.

## Configuration and files

Configuration precedence is CLI flag, environment/`.env`, `config.json`, then built-in defaults. Supported non-secret values are `SOL_WALLET_CLUSTER`, `SOL_WALLET_RPC_URL`, `SOL_WALLET_COMMITMENT`, and `SOL_WALLET_CONFIG_DIR`. Never put key material or passwords in `.env`.

The default directory is `~/.config/sol-wallet`:

```text
config.json          0600  non-secret session defaults
keystore.json        0600  Argon2id + AES-256-GCM encrypted key
stake-accounts.json  0600  public stake registry
history              0600  filtered shell history
```

SOL and token amounts are parsed as strings into `bigint`; no monetary calculation uses floating point. JSON output represents integer monetary values as decimal strings.

## Security limits

This is personal wallet software. Keep an independent secure backup of the original private key. Losing the keystore passphrase can make the local encrypted key unusable. JavaScript cannot guarantee perfect in-memory zeroization; the implementation uses mutable buffers, minimizes key lifetime, and wipes buffers where practical. RPC providers can observe addresses and network requests. Native staking is not liquid staking, and deactivation is epoch-based rather than immediately withdrawable.

The wallet never sends private keys, passphrases, or decrypted keystore bytes to RPC. It does not use telemetry, arbitrary transaction signing, shell evaluation, or automatic validator selection.

## Tests

Unit tests are offline:

```bash
npm test
```

Opt-in Solana integration tests use `RUN_SOLANA_INTEGRATION=1` and must never use a real developer wallet. Docker E2E tests exercise the built image through a PTY and deterministic mock RPC; set `SOL_WALLET_E2E_IMAGE` to the image under test.

See [docs/implementation.md](docs/implementation.md) for the architecture, validation record, dependency-install incident, Docker workflow, and operational notes.
