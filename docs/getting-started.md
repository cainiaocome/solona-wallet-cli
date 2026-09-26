# Getting started for a Web3 beginner

This guide assumes you have never used a blockchain wallet before. The short
version is: `sol-wallet` stores one Solana private key in an encrypted local
file, uses a Solana RPC service to read the chain, and only signs a transaction
after the command has validated and simulated it.

## 1. What you are installing

There are two ways to use the project:

- **Release container:** use the published `linux/amd64` image. This is the
  safest way to run the same artifact that CI tests.
- **Source checkout:** install Node dependencies and run the TypeScript source
  during development.

The application is not a hosted wallet. There is no server that stores your
key, and there is no recovery service. The important wallet file stays in your
local configuration directory.

## 2. Run the release image

Replace `<owner>` with the GitHub owner that published the image:

```bash
docker pull ghcr.io/<owner>/sol-wallet:latest
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$HOME/.config/sol-wallet:/home/solwallet/.config/sol-wallet" \
  ghcr.io/<owner>/sol-wallet:latest
```

The `-v` option is important: containers are disposable, so without the mount
the encrypted wallet would disappear when the container exits. The wrapper
does this setup for you:

```bash
scripts/sol-wallet
scripts/sol-wallet -c "balance" --json
```

By default the wrapper runs `ghcr.io/cainiaocome/sol-wallet:master`, the
latest image published from this repository's `master` branch. Set
`SOL_WALLET_IMAGE` when using a fork, a release tag, or a specific commit tag.
Every wrapper invocation pulls the selected image first. If Docker cannot
reach the registry or the pull fails, the wrapper stops instead of using a
possibly outdated local copy.

The container runs as an unprivileged user. Mapping your host UID/GID lets the
container write the `0700` configuration directory without making that
directory world-readable.

## 3. Run from source

Use Node `24` or newer:

```bash
npm ci --legacy-peer-deps
npm test
npm run build
npm run dev
```

The lockfile is authoritative. `.npmrc` applies npm's seven-day release-age
window during dependency resolution and updates; `npm ci` reproduces the exact
versions already pinned in the lockfile and does not itself prove those
versions are older than seven days. The `--legacy-peer-deps` flag is required
by the pinned Jupiter SDK dependency graph. The original dependency-install
issue is recorded in [implementation.md](implementation.md). See
[supply-chain.md](supply-chain.md) before changing dependencies.

## 4. Import a wallet safely

Start the shell and type:

```text
wallet import
```

The program asks for a base58 Solana private key through a hidden prompt,
shows the derived public address, asks you to confirm that address, and then
asks for a new keystore passphrase. A Solana CLI JSON keypair can be imported
without pasting its private key into the terminal:

```text
wallet import --keypair-file /path/to/id.json
```

The input file is read but never modified or deleted. The passphrase is not
stored anywhere. The resulting file is:

```text
~/.config/sol-wallet/keystore.json
```

It contains encrypted key material and public metadata, not a plaintext key.
Keep a separate secure backup of the original private key. If you lose both
the original key and the keystore passphrase, this application cannot recover
the wallet.

After import, these commands do not unlock the keystore:

```text
address
wallet info
```

They read only the public address and keystore metadata.

## 5. Understand the cluster before using funds

Solana has separate networks. This project supports:

- `mainnet-beta`: real SOL, real tokens, and real transactions.
- `devnet`: a public testing network whose tokens are not real money.

The default is `mainnet-beta`. Check the prompt or run:

```text
show config
```

For learning, use devnet explicitly:

```bash
sol-wallet --cluster devnet
```

The prompt includes the current cluster. A command sent to devnet does not
affect the same address on mainnet, even though the address text is identical.
Do not assume that a devnet success proves a mainnet transaction is safe; it
only proves that the code path worked against a different network.

## 6. Start with read-only commands

These inspect public chain data and do not need the passphrase:

```text
address
balance
token list
token balance <mint>
validators --limit 10
stake list
jupiter-lend status
```

Most of them use an RPC request. RPC means “Remote Procedure Call”: the CLI
sends a request to a Solana node or provider, and the provider returns chain
data. The provider can see the addresses and requests you make, but the CLI
does not send it your private key or passphrase.

## 7. Use dry-run before every write

Write commands can create transactions. A transaction is a signed message
that asks one or more Solana programs to change on-chain state. Use
`--dry-run` while learning:

```text
send <destination> 0.001 --dry-run
token send <mint> <destination> 1.5 --dry-run
stake create 1 --validator <vote-account> --dry-run
jupiter-lend deposit 1 --dry-run
```

Dry-run validates the input, builds the transaction, and asks the RPC node to
simulate it. It does not broadcast the transaction and does not move funds.
Simulation is useful but not a guarantee: balances, prices, protocol
liquidity, blockhash validity, and account state can change after simulation.

Without `--dry-run`, the command prints a preflight summary, simulates first,
and asks for confirmation. `--yes` skips only that human prompt; it does not
skip validation or simulation.

## 8. A safe learning sequence

Use this order when learning the project:

1. `address` and `wallet info` — learn the public identity.
2. `show config` — verify cluster, RPC URL, and commitment.
3. `balance` — learn SOL and lamports.
4. `token list` — learn token accounts and mint addresses.
5. Run a `send ... --dry-run` against devnet — learn transaction preflight.
6. Try `stake list` and inspect a transaction with `tx inspect <signature>`.
7. Read [web3-concepts.md](web3-concepts.md) before using staking or lending.

Never use a valuable private key as a test fixture. Use the disposable fixture
under `test/fixtures/` or a wallet created solely for testing.

## 9. JSON automation

One-shot commands are selected with `-c`. JSON output is one document on
stdout; errors are JSON on stderr and the exit status is non-zero:

```bash
sol-wallet -c "balance" --json
sol-wallet -c "token list" --cluster devnet --json
sol-wallet -c "send <destination> 0.001 --dry-run" --json
```

Integer amounts are strings in JSON because JavaScript numbers cannot exactly
represent every possible on-chain integer. For example, `1 SOL` is stored as
`1000000000` lamports, not as a floating-point number.

## 10. If something goes wrong

Read the error and preserve the transaction signature if one was printed:

- `ConfigError` or `ParseError`: fix the command or configuration.
- `KeystoreError`: check the passphrase and keystore file integrity.
- `RpcError`: check the RPC URL, network, and provider availability.
- `SimulationError`: no transaction was broadcast; inspect the message and
  current balances/accounts.
- `ConfirmationError`: the transaction may have been submitted but the CLI
  did not observe confirmation; inspect the signature with `tx inspect` and a
  trusted Solana explorer before retrying.

Do not blindly retry a timeout. A transaction can land after the client gives
up waiting.
