# Managing multiple wallets

`sol-wallet` can keep several imported Solana keys in one configuration
directory. Each key belongs to one wallet and has its own encryption passphrase.
This guide explains aliases, the current and default choices, old-installation
migration, and recovery. A wallet alias is only a nickname on this computer; it
does not change an address or move tokens, SOL, stake, or lending positions.

## Start with the identity

Import a wallet by choosing a short alias:

```text
wallet import daily
```

The CLI asks for a private key or keypair file, displays its derived public
address, asks you to confirm it, and encrypts the key using a passphrase you
enter in a TTY. Private keys and passphrases are not accepted as command
arguments, environment variables, or piped input. The first wallet becomes both
the current and saved default wallet.

Import another wallet under a different alias:

```text
wallet import savings --keypair-file /secure/path/savings.json
```

Later imports do not change the current or default wallet. They print a
selection command after success. Aliases are 1–32 lowercase characters, start
with a letter, and contain only letters, numbers, `_`, and `-`.

List registered wallets without querying Solana:

```text
wallet list
wallet info savings
status
```

The list marks the current and default wallet separately and displays each full
address. `wallet info` reads public metadata without asking for a passphrase.
`status` displays the current wallet, saved default, network, RPC URL, and
commitment. Status is a local configuration summary; it does not check RPC
health or fetch a balance.

At interactive startup and in each prompt the CLI shows the alias and shortened
address. Before a transaction, it shows the selected alias, full source address,
and network. Read the full address carefully before approving a mainnet action.
Aliases help you recognize wallets but are not used as signing identities.

## Current wallet and saved default

The **current wallet** is used by the running shell. Switch it with:

```text
wallet use savings
```

This changes only this running process. In a piped interactive session it also
changes the selection for later input lines. `wallet use` is not available in a
one-shot `-c` invocation; choose explicitly when launching that command:

```bash
sol-wallet --wallet savings -c "balance" --json
```

The **saved default** is used by future invocations that do not specify
`--wallet`. Change it with:

```text
wallet default savings
```

Changing the default does not switch the current shell. An explicit startup
choice also does not change the default:

```bash
sol-wallet --wallet daily
sol-wallet --wallet daily -c "send <destination> 0.01 --dry-run" --json
```

If you open two terminals, changing the default in one does not silently switch
the other terminal. A rename is visible to a running session by its next prompt;
the selected UUID and signing address remain the same.

## Rename an alias

```text
wallet rename daily spending
```

This only changes the local nickname. The encrypted keystore filename, public
address, passphrase, current selection, default selection, and chain state do not
change. You can rename the selected wallet without re-importing it.

## Where wallet data lives

The default directory is `~/.config/sol-wallet`; Docker users should keep the
mounted configuration directory backed up. Its relevant files look like:

```text
config.json                    network and RPC preferences
wallets.json                   aliases, public addresses, saved default
wallets/<uuid>.json            one encrypted keystore for one wallet
stake-accounts/<uuid>/mainnet.json
stake-accounts/<uuid>/devnet.json
history                        filtered shell command history
```

UUID filenames are stable identifiers, not private keys. Aliases are stored in
`wallets.json` and never used as filesystem paths. The registry does not contain
the encrypted private-key payload. Each keystore contains its public address and
encrypted key material, using Argon2id and AES-256-GCM. The passphrase is needed
to sign, migrate the legacy wallet, or register a recovered encrypted key.
Listing, selecting, renaming, status, balances, and other public reads do not
unlock it.

Back up the entire configuration directory to retain aliases, defaults, all
encrypted wallet files, and local stake hints. Store the backup securely: every
keystore still needs its own passphrase. You may back up one
`wallets/<uuid>.json` independently, but without `wallets.json` you must recover
it explicitly and choose an alias again. Keep an independent secure backup of
the original private keys as well; a forgotten passphrase cannot be reset by
this CLI.

## Move from the old single-keystore layout

Older versions stored one file at `~/.config/sol-wallet/keystore.json`. The
multi-wallet version asks you to migrate it explicitly:

```text
wallet migrate old-wallet
```

Enter the existing keystore passphrase when requested. Migration verifies that
the decrypted key matches the stored address, copies the encrypted keystore to
a new UUID filename, and registers the chosen alias. It does not change the
passphrase or decrypt and save a plaintext key. The original
`keystore.json` is retained as a recovery copy. After registration, normal
commands use the UUID-named keystore only.

If the address was already migrated, retrying with the same alias reports that
state without making another wallet. If it was registered under a different
alias, rename the registered wallet. Migration does not guess a network for old
stake metadata: the old root `stake-accounts.json` is preserved but ignored.
Stake accounts are discovered from the selected network and their on-chain
authorities are checked before use.

## Recover wallet metadata

If `wallets.json` is lost but UUID keystores remain, the CLI will not choose one
automatically. Review the UUID-named files and register one explicitly:

```text
wallet recover 619c12ca-fc26-4db1-a9ed-aef7f6978643 daily
```

The CLI asks for that encrypted keystore's passphrase and verifies the derived
address. The first recovered wallet becomes current and default; later recovered
wallets do not replace those choices. Recovery does not re-encrypt or rename the
keystore. If registry publication failed after a successful import, the error
prints the orphan UUID and gives this same recovery command.

Do not edit `wallets.json` by hand while the CLI is running. Restore it from a
trusted backup when possible. If no backup exists, stop all CLI processes and
containers using the directory, then recover each wallet with an alias you
recognize. UUID keystores not yet registered are never active by themselves.

Wallet-store writers use an exclusive `.wallet-store.lock/` directory. If the
process crashes while writing, the next change reports that the store is busy.
The lock is not removed automatically based on age or process ID. First stop all
CLI processes and containers sharing this configuration directory. Inspect the
exact `.wallet-store.lock/` path, preserve its `owner.json` for diagnosis, and
remove only that stale lock directory after confirming no writer is running.
Then use `wallet list` and the recovery instructions above to inspect the data.
Never delete `wallets/` or `wallets.json` as a way to clear a lock.

An interrupted import can also leave hidden `.import-*.tmp` or `.recovery-*.tmp`
files inside `wallets/`. They contain encrypted keystore data and are not
registered wallets. Preserve them until the registry and every UUID file have
been checked; if you decide to clean them, stop all writers and move only the
specific stale temporary file to a secure quarantine before deleting it.

## JSON and automation

One-shot commands have no startup banner. Provide the wallet explicitly when
the command should not depend on the saved default:

```bash
sol-wallet --wallet savings -c "balance" --json
sol-wallet --wallet daily -c "jupiter-lend status" --json
```

Wallet-dependent JSON results include a stable identity object:

```json
{
  "wallet": {
    "id": "619c12ca-fc26-4db1-a9ed-aef7f6978643",
    "alias": "daily",
    "address": "<full Solana address>"
  },
  "cluster": "mainnet"
}
```

The `wallet` field is an object in v0.3; scripts that expected it to be an
address string should read `wallet.address`. Existing top-level fields such as
`address`, `from`, and `owner` remain available where a command provides them.
For `status`, `wallet` is the current identity or `null`, and `defaultWallet` is
the saved identity or `null`. RPC errors and command errors go to stderr; the
transaction preflight is also sent to stderr in JSON mode so stdout remains
machine-readable.

Wallet history remains shared between aliases and is not an audit log. It
filters secret-like command lines; never paste a key or passphrase into a
command line.
