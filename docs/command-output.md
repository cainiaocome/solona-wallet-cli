# Understanding CLI output

This guide explains what the terminal shows, which actions contact Solana, and
how to tell a missing balance from a failed request.

## There is no login session

Starting `sol-wallet` selects a wallet using the saved default or an explicit
`--wallet <alias>`. This does not decrypt or unlock the private key. The shell
shows the selected alias, a shortened address, and the network. Startup stays
quick and does not make an RPC request. If no wallet is selected, it suggests
how to import or choose one. Type `status` when you want to refresh on-chain
data.

The passphrase is requested only when a command needs to sign a transaction.
Read-only commands use the public wallet address and never need the passphrase.

## `status`: wallet and balance overview

`status` checks that the configured RPC responds and belongs to the selected
network, then reads the selected wallet's SOL balance and SPL/Token-2022 token
accounts. It shows non-zero token balances grouped by mint, with the token
program and number of token accounts. Use `token list` for full mint addresses
and `token list --accounts` for individual token-account addresses.

The output includes the wallet, saved default, network, sanitized RPC endpoint,
commitment, and refresh time. `MAINNET` is explicitly marked as real funds.
The “Default wallet keystore” field reports whether the saved default's local
keystore is healthy. A missing or invalid unrelated default appears as a
separate diagnostic and does not prevent status from reading a different
healthy wallet selected for this process.
`show config` remains the local configuration view and does not check RPC
health or fetch balances. Human TTY sessions show a short refresh notice while
the chain sections load; JSON output remains free of progress text.

RPC health and each balance section are reported separately. For example,
status can still show the wallet and network if an RPC read fails. Such a value
is marked **unavailable**, never reported as zero. A `degraded` health result
means the RPC was verified but at least one balance section could not be read;
`unavailable` means the endpoint could not be verified for the selected
network. `Updated` is the time this refresh completed, not a promise that the
chain state has not changed since then.

Status also summarizes native stake and, on mainnet, the selected wallet's
Jupiter Lend USDC position. These appear in a separate **Positions** section and
are never added to liquid SOL/token balances. On devnet, Jupiter Lend is marked
mainnet-only instead of being queried. Use `stake list` and `jupiter-lend
status` for full details; do not interpret staked or supplied assets as
immediately liquid.

## Wallet identity and ordinary reads

- `wallet list` marks current and saved-default wallets; `wallet info` shows a
  wallet's full public address. These are local metadata reads.
- `address` prints the selected wallet address and network.
- `balance` shows the human SOL amount. Exact lamports are available in JSON,
  or in human output when the process is started with `--verbose`.
- `token list` aggregates balances for each mint. `--accounts` expands the
  output to show each account. `token balance <mint>` shows the mint, total,
  account count, and (with `--verbose`) raw integer amount.
- `validators` is a table sorted by activated stake. It shows status,
  commission, stake, and the full vote-account address required by
  `stake create`.
- `stake list` shows state, total account balance, delegated amount, validator
  vote account, and stake-account address. An `unknown` state can identify a
  local recovery hint for an account the current RPC did not return.
- `jupiter-lend status` emphasizes wallet USDC, supplied assets, protocol
  liquidity, and the currently withdrawable amount. Raw receipt-token and rate
  fields are technical details available with `--verbose` or `--json`.
- `tx inspect <signature>` shows a human summary: result, slot, time, fee,
  signers, instruction count, and an explorer link. Add `--json` for the full
  RPC transaction response.

Token symbols are not guessed from arbitrary on-chain metadata. If a mint is
not otherwise recognized, its address is the token's identifier. The full mint
is retained in `token list` and JSON output.

## Transaction previews and receipts

Every write command validates and simulates before signing. The preview shows
the selected wallet, action, destination or target account, amount, estimated
network fee, and network. The confirmation question repeats the essential
action and network. On `mainnet`, read the full preview carefully before
answering `y`; an alias is only a local nickname.

After broadcast, the terminal briefly indicates that it is waiting for
confirmation (only in an interactive human terminal). A successful receipt
shows the wallet, network, confirmation level, slot, action details, full
signature, and a Solana Explorer link. If confirmation times out, the
transaction may still have landed: inspect the signature before retrying.

`--dry-run` prints that the transaction was simulated and not broadcast.
`--yes` skips only the confirmation question; it does not skip validation,
simulation, or the passphrase prompt required to sign.

## Help and scripting

Run `sol-wallet --help` (or `-h`) for startup flags. In the shell, `help` shows
commands and `help <topic>` shows a command group. Tab completion uses the
commands, flags, wallet aliases, token mints, validators, and stake accounts
already known to the current shell; it does not make background RPC calls.

For scripts, use `-c "<command>" --json`. JSON is one compact document on
stdout; errors are JSON on stderr and return a non-zero exit status. In JSON
mode, the preflight needed for a human confirmation is written to stderr, so it
does not corrupt the final JSON document on stdout. Integer amounts are strings
to preserve exact values. `status` adds a `health` field (`healthy`,
`degraded`, or `unavailable`), an `rpc` result, per-section `balances` and
separate `positions`, and an `updatedAt` timestamp; a missing wallet has
`balances: null` and `positions: null`. On devnet, the Jupiter position is
reported as not supported rather than queried.

Use `--verbose` as a startup option when you need technical raw amounts in
human output, for example `sol-wallet --verbose -c "balance"`.
