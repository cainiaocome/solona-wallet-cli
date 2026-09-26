# Command cookbook

The examples below use shell syntax for commands typed into the interactive
prompt unless a command starts with `sol-wallet`. Replace angle-bracket values
with real addresses. Do not paste a private key into shell history, a script,
or a command-line argument.

## Common options

Startup options apply to one invocation:

```bash
sol-wallet --cluster devnet
sol-wallet --rpc-url https://example.invalid/rpc
sol-wallet --commitment finalized
sol-wallet -c "balance" --json
```

Command options are parsed by the same command engine in the REPL and one-shot
mode:

```text
send <destination> 0.001 --dry-run
send <destination> 0.001 --yes
```

- `--dry-run` builds and simulates a write without broadcasting it.
- `--yes` skips the confirmation question only. Validation and simulation still
  happen.
- `--json` writes machine-readable output. Use it for scripts, not human
  reading.

## Wallet and public identity

```text
wallet import
wallet import --keypair-file /secure/path/id.json
wallet info
address
```

`wallet import` creates the one local encrypted keystore. Replacement is not
supported in v0.2, so import into a new `SOL_WALLET_CONFIG_DIR` if you are
learning with another key:

```bash
SOL_WALLET_CONFIG_DIR=/tmp/sol-wallet-demo sol-wallet
```

`address` and `wallet info` are public-only. They do not ask for the
passphrase.

## Configuration

```text
show config
set cluster devnet
set commitment finalized
set rpc-url https://api.devnet.solana.com
```

Configuration precedence is:

```text
CLI flag > environment/.env > config.json > built-in default
```

`set` changes the current process only. Use `config.json`, environment
variables, or startup flags for repeatable configuration. Never put a private
key or passphrase in any of those locations.

## SOL

```text
balance
send <destination> 0.001 --dry-run
```

`balance` displays SOL and the exact lamport value. `send` requires enough SOL
for the amount plus a network fee. Start with a small devnet dry-run.

For JSON automation:

```bash
sol-wallet -c "balance" --cluster devnet --json > balance.json
```

## SPL and Token-2022 tokens

List token accounts owned by the wallet:

```text
token list
```

Read one mint's balance:

```text
token balance <mint-address>
```

Send a token using its mint address and human-readable amount:

```text
token send <mint-address> <destination> 1.25 --dry-run
```

The amount uses the mint's on-chain decimals. The CLI refuses excess decimal
places and does not silently round. The sender supports basic checked
transfers. Token-2022 mints with extensions are intentionally refused until
their transfer semantics are modeled explicitly.

## Validators and native staking

Inspect validator data before choosing one:

```text
validators --limit 20 --current-only
validators --max-commission 8
```

Create and delegate a native stake account:

```text
stake create 1 --validator <vote-account> --dry-run
```

List stake accounts discovered for the wallet:

```text
stake list
```

Request deactivation and later withdraw inactive stake:

```text
stake deactivate <stake-account> --dry-run
stake withdraw <stake-account> --dry-run
stake withdraw <stake-account> --amount 0.5 --dry-run
```

Deactivation is not instant. Wait for the relevant epoch transition and check
`stake list` before withdrawing. Native staking is different from liquid
staking: the wallet creates and controls a real Stake Program account.

## Jupiter Lend Earn

First check the canonical mainnet USDC position:

```text
jupiter-lend status
```

The command reports supplied assets, protocol liquidity, and the smaller
currently withdrawable amount. It requires `mainnet`; it is not a devnet
demo.

Deposit after independently checking the amount and protocol:

```text
jupiter-lend deposit 1 --dry-run
```

Withdraw a specific amount:

```text
jupiter-lend withdraw 0.5 --dry-run
```

Withdraw the maximum currently available for the position:

```text
jupiter-lend withdraw --all --dry-run
```

When all supplied assets are available, `--all` redeems the exact receipt
shares. If protocol liquidity is constrained, it withdraws only the currently
available amount and leaves the rest supplied. No live mainnet lending write
has been performed by this repository's automated validation.

## Transaction inspection

```text
tx inspect <signature>
```

Use the signature printed after broadcast. Run the inspection on the same
cluster where the transaction was submitted. If a confirmation timeout occurs,
inspect first and only retry after determining whether the transaction landed.

## Interactive shell conveniences

```text
help
help stake
token
stake
jupiter-lend
history
clear
exit
```

Typing a command group without a subcommand displays that group's available
commands and usage. This also works with the wallet, transaction, and show
groups.

The shell stores up to 1,000 filtered commands. Lines containing common secret
words such as `private key`, `password`, or `passphrase` are not persisted.
Completion uses only cached public values and does not unlock the wallet or
make synchronous network requests.

## JSON scripting pattern

Use exit status and stderr, not only stdout, to decide whether a command
succeeded:

```bash
if result="$(sol-wallet -c "balance" --json 2>error.json)"; then
  printf '%s\n' "$result"
else
  cat error.json >&2
  exit 1
fi
```

Do not parse human output. JSON integers are strings, and a successful
transaction response includes the signature and confirmation status.
