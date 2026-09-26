# Multiple wallets: proposed v0.3 design

Status: product direction accepted; runtime implementation has not started.
Read the [implementation specification](multiple-wallets-implementation.md) for
exact schemas, edge cases, recovery rules, code changes, and acceptance tests.
That document resolves implementation details left open in this overview.

## Goal and current implementation

Support several named wallets, make the current signing identity obvious, and
keep existing SOL, token, staking, and Jupiter Lend commands consistent.

Today `configDir/keystore.json` is the only wallet. Import rejects a second key;
read commands and signers resolve that same file independently. The shell prompt
shows the cluster and shortened address. There is no general `status` command.
The stake registry is shared and its entries do not record wallet or network.

## Concepts

- **Wallet:** a public address with a locally encrypted private key. Funds and
  protocol positions live on the blockchain, not in this directory.
- **Alias:** a local nickname such as `daily` or `savings`. Renaming it does not
  change its address or move funds. Other applications do not see this nickname.
- **Current wallet:** the wallet used by this CLI process.
- **Default wallet:** the saved choice used when starting a new process without
  an explicit selection.
- **Network:** a separate choice. The same key can be used on mainnet and devnet,
  but balances and positions on those networks are independent.

One wallet has one alias in this release. Require 1–32 lowercase ASCII letters,
digits, hyphens, or underscores, starting with a letter. Reject invalid aliases
with an example; do not silently transform input. Aliases are unique within the
configuration directory. Duplicate public addresses are rejected with a pointer
to the existing alias and the rename command.

## Command contract

| Proposed command                                | Behavior                                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `wallet import <alias> [--keypair-file <path>]` | Import another encrypted wallet using the existing secure prompts.                  |
| `wallet list`                                   | List aliases, full addresses, and separate current/default markers; no RPC request. |
| `wallet use <alias>`                            | Select a wallet for this process only.                                              |
| `wallet default <alias>`                        | Save the startup default; leave the current selection unchanged.                    |
| `wallet rename <old> <new>`                     | Change the alias without changing identity, keys, or selection.                     |
| `wallet info [<alias>]`                         | Show local metadata for the specified wallet, or current wallet if omitted.         |
| `wallet migrate <alias>`                        | Convert the legacy single-keystore installation explicitly.                         |
| `wallet recover <uuid> <alias>`                 | Register an existing orphan encrypted keystore after passphrase verification.       |
| `status`                                        | Show current wallet, full address, default wallet, cluster, RPC, and commitment.    |
| `sol-wallet --wallet <alias>`                   | Start a shell with an explicit wallet selection.                                    |
| `sol-wallet --wallet <alias> -c 'balance'`      | Run one command using that wallet without changing the saved default.               |

Bare `wallet` and `help wallet` show the complete usage. Completion includes
wallet aliases in supported positions. This phase uses a startup `--wallet`
option, not separate overrides on individual REPL commands.

Selection at startup: explicit `--wallet`, otherwise saved default, otherwise
no selected wallet. An invalid explicit alias, missing default target, or corrupt
registry produces an actionable error, never a fallback to another key. `wallet
use` is for interactive or piped sessions; one-shot commands use startup
`--wallet` instead.

The first successful import becomes current and default. Subsequent imports
change neither; their success message explains how to select the new wallet.
Changing the default in another process does not change a running shell's
current wallet. `wallet default` output explicitly distinguishes the saved
default from the current wallet.

With no wallets, startup and `status` explain how to import one. Wallet-dependent
commands fail before RPC access. Help and unrelated commands remain available.

## Identity in the interface

Illustrative startup output (addresses below are abbreviated placeholders):

```text
Solana Wallet CLI
Wallet:  daily (385n…fwsT)
Network: mainnet
Type `status` for details or `wallet list` to see your wallets.

sol-wallet [mainnet | daily | 385n…fwsT]>
```

If current differs from default, startup and status also show the saved default.
`status` prints the full current address. It is an immediate local context
summary, not an RPC health check or portfolio calculation. Use `balance`,
`token list`, `stake list`, and `jupiter-lend status` for live data.

Every transaction preview includes alias, full source address, and network.
Passphrase prompts identify the alias and shortened address. Wallet-dependent
human output identifies the selected wallet; JSON results and previews include
a consistent `wallet: { id, alias, address }` identity object. Existing output
fields must be reviewed explicitly where `wallet` currently means an address;
document these v0.3 JSON shape changes with examples rather than silently mixing
string and object representations.

One-shot and JSON modes emit no startup banner. Identity must never depend on
color alone. RPC URLs are redacted in status if they contain credentials.

## Storage and signing

Proposed layout within the existing mounted configuration directory:

```text
config.json
wallets.json
wallets/<uuid>.json
stake-accounts/<uuid>/<network>.json
history
```

`wallets.json` is a versioned registry containing the default wallet ID and wallet
entries with stable UUIDs, aliases, public addresses, and creation times.
Each `wallets/<uuid>.json` is one complete encrypted keystore representing one
wallet, as requested. Its contents retain the public address, encryption/KDF
metadata, and encrypted private key, so decrypting it does not depend on the
alias registry. Aliases never form filesystem paths. Renaming changes registry
metadata only, leaving the UUID filename and keystore contents unchanged.
Network and RPC configuration remain independent of wallets.

Backing up the whole configuration directory preserves aliases, defaults, and
stake records as well as encrypted keys. An individual keystore can also be
backed up independently, but its passphrase is still required. Losing only the
registry must not mean losing keys: document how to rebuild registry entries
from intact keystores with newly chosen aliases. Missing registry entries must
never cause an arbitrary wallet to become selected automatically.

Each wallet retains its own existing encryption format and passphrase. There
is no shared master password, persistent unlock, or decrypted-key cache. Listing,
switching, renaming, and viewing status do not require a passphrase.

Resolve wallet identity once per command and pass that immutable selection to
all handlers and the signer. Verify the registry address, keystore address,
decrypted key address, and expected signer address agree before signing. Never
re-read a mutable default to determine which key signs a prepared transaction.

Keep directories private (0700) and files private (0600). Registry writes need
atomic replacement and serialized read-modify-write operations across processes.
Imports need create-only keystore writes, round-trip verification before registry
publication, and recoverable cleanup after failures. Concurrent operations must
not overwrite keys, lose entries, or bypass alias/address uniqueness checks.
Document lock recovery and interrupted-import recovery before release.

Scope stake records by stable wallet ID and network; verify on-chain authority
before using a local record. Clear wallet-dependent completion caches on switch
and network-dependent caches on cluster changes. Keep command history global
with existing secret filtering; it remains a convenience, not an audit log.

## Existing single-wallet installations

Recommend an explicit `wallet migrate <alias>` command. This is a one-time data
conversion, not permanent support for two runtime storage layouts.

When only the old keystore exists, explain the migration command. Validate and
copy the encrypted keystore, preserve its passphrase, and publish the new registry
only after validation succeeds. Keep the original encrypted file as a clearly
documented recovery copy; never overwrite or delete it automatically. Re-running
after interruption must be safe and must not create duplicate wallets. Once the
registry is committed, normal operation uses the new layout exclusively.

Legacy stake records have no reliable network tag. Preserve them as unclassified
recovery data; do not assign all of them to the current network. Normal chain
discovery can find authorized accounts, while any recovered legacy record must
be verified on the selected network before entering its scoped registry.

## Scope recommendations

Include multiple imported wallets, aliases, selection/default behavior, status,
identity-aware output, completion, migration, and isolation of existing features.

Defer wallet creation/seed phrases, hardware wallets, address-book recipient
aliases, portfolio aggregation, and protocol additions. Also defer local wallet
removal: deleting the only key copy deserves a separately reviewed recovery and
confirmation design. Importing and renaming are enough for the initial release.

Watch-only wallets are a useful follow-up: they would store a public address
without its private key, support reads, and reject signing. The initial release
does not need them to deliver multiple-wallet support.

## Implementation and acceptance plan

1. Build and test the registry, storage transactions, migration, and immutable
   wallet-selection boundary.
2. Route all wallet reads, SOL/token signing, staking, and Jupiter Lend through
   that boundary. Scope stake records and clear relevant completion caches.
3. Implement commands, startup selection, status, prompts, help, completion, and
   consistent human/JSON identity output.
4. Update beginner guides, command cookbook, architecture, security/recovery
   documentation, and source comments. Format code before committing.
5. Run unit/integration tests, lint/build, and Docker E2E in GitHub Actions before
   publishing when authorized.

Acceptance coverage must exercise two distinct wallet keys: first/subsequent
imports; duplicate aliases/addresses; rename; current versus default; process
restart and startup overrides; invalid selections; corrupted storage; concurrent
imports and metadata updates; interruption during import/migration; wrong
passphrases and mismatched signer identity; wallet/network stake isolation;
cache invalidation; no secret leakage; JSON without banners; and PTY prompts.

Mock-RPC transaction tests must verify that selecting wallet B uses B's source,
fee payer, and signer throughout SOL, token, stake, and Jupiter Lend flows, and
never requests A's key. Docker tests must prove both wallets and the default
survive container restarts with the existing volume mount.

Validation performed for this proposal: read current source, configuration,
documentation, Git status, and recent history. No runtime tests were run because
no application behavior was changed.
