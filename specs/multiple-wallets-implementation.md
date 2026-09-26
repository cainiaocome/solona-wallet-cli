# Multiple-wallet implementation specification (v0.3)

Status: implementation handoff; runtime implementation has not started.
Read [the product design](multiple-wallets-design.md) first. This document resolves
its implementation choices. For v0.3 wallet behavior, this document takes
precedence over the older single-wallet requirements in [spec.md](spec.md).
User instructions and repository working rules continue to take precedence.

## 1. Scope and invariants

Implement named imported wallets, one UUID-named encrypted file per wallet,
session selection, saved default, status, migration, recovery, and integration
with every existing wallet-dependent command. Do not add wallet generation,
watch-only wallets, removal, seed phrases, hardware wallets, recipient aliases,
portfolio aggregation, new lending protocols, or an unlock cache.

These are release-blocking invariants:

1. A command resolves its wallet once. Its RPC owner, fee payer, preview,
   passphrase prompt, signer, result, and local stake updates use that identity.
2. Selecting, renaming, listing, and reading metadata never decrypt a key.
3. No wallet fallback is allowed after a failed explicit selection, missing
   selected file, malformed registry, or signer identity mismatch.
4. A rename changes registry metadata only. Wallet UUID, address, encrypted
   bytes, passphrase, and stake-record paths remain unchanged.
5. Registry changes are serialized across processes and published atomically.
   Existing keystores are never replaced. No plaintext secret is persisted.
6. Simulation, confirmation, cluster/genesis checks, authority checks, token
   restrictions, and Jupiter restrictions retain their existing protections.
7. No alias is treated as a path or as an on-chain recipient address.
8. Human and machine output identify the wallet used, including dry runs and
   confirmed transactions. Secret input remains outside arguments/environment.

## 2. Storage contract

All paths below are relative to the existing configuration directory. Keep the
Docker volume mount and `SOL_WALLET_CONFIG_DIR` behavior unchanged.

```text
config.json
wallets.json
wallets/<uuid>.json
stake-accounts/<uuid>/mainnet.json
stake-accounts/<uuid>/devnet.json
.wallet-store.lock/
history
```

The lock directory exists only while a metadata writer owns it, except after a
crash. Legacy `keystore.json` and `stake-accounts.json` may remain as recovery
copies; normal v0.3 operation never uses them as active storage.

Registry schema (implement with strict Zod objects):

```ts
interface WalletEntry {
  id: string; // canonical lowercase UUID v4, generated with randomUUID()
  alias: string; // /^[a-z][a-z0-9_-]{0,31}$/
  address: string; // valid canonical Solana public address
  createdAt: string; // UTC ISO timestamp, emitted by Date.toISOString()
}

interface WalletRegistry {
  version: 1;
  defaultWalletId: string | null;
  wallets: WalletEntry[];
}
```

Require unique IDs, aliases, and addresses. Empty registry requires null default;
nonempty registry requires a default referencing an existing entry. Reject
unknown schema versions, invalid fields, duplicate entries, dangling defaults,
and unknown object fields. Preserve insertion order on disk; sort by alias for
`wallet list`. Persist only these fields: paths, passwords, cluster, and RPC URL
do not belong in the registry.

`wallets/<uuid>.json` uses the existing keystore version 1 contents unchanged.
Do not add UUID or alias to its authenticated encryption metadata. A keystore
remains decryptable independently of the registry. Derive its path from a
validated UUID, never from a stored path. Reject symlinks/nonregular files at
managed registry and keystore paths; reject symlinked managed subdirectories.
Do not prohibit an intentionally symlinked configuration root chosen by a user.

Use 0700 for managed directories and 0600 for managed files. Never recursively
chmod unrelated files. Readers validate schemas and metadata; only signing,
import verification, migration, and recovery need key decryption.

Scoped stake-file schema:

```ts
interface ScopedStakeRegistry {
  version: 1;
  walletId: string;
  walletAddress: string;
  cluster: "mainnet" | "devnet";
  accounts: Array<{
    address: string;
    validatorVoteAccount: string;
    createdSignature: string;
    createdAt: string;
  }>;
}
```

Validate wrapper identity against the command snapshot and deduplicate accounts
by stake address. Preserve existing on-chain discovery and authority checks;
local records are hints, never proof of current ownership or authority.

## 3. Process and command selection

Store `currentWalletId: string | null` in session state, separate from AppConfig.
Add `executionMode: "interactive" | "piped" | "oneshot"` to context. Do not add
a wallet-selection environment variable or persist current selection at exit.

Startup loads/validates the registry, then selects explicit `--wallet <alias>`
or the saved default. Startup options accept this option once; missing value,
duplicate occurrence, or invalid/unknown alias fails with exit 2. Do not treat
the next startup flag as the option's value. No `--wallet` inside REPL commands.

| State                                                    | Required behavior                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| No registry, no legacy keystore, no UUID keystores       | Empty store; no selection.                                            |
| Valid empty registry                                     | No selection; first import can establish default.                     |
| Valid nonempty registry                                  | Select the default unless overridden explicitly.                      |
| No registry, legacy keystore exists                      | Migration required; never use old key for normal commands.            |
| No registry, UUID keystores exist                        | Recovery required; never auto-select a file.                          |
| Malformed registry or dangling default                   | Fail store-dependent operations with storage error; never replace it. |
| Registry entry has missing/malformed/mismatched keystore | Fail when that wallet is inspected/selected/used; no fallback.        |

Implement lazy reporting of store errors so `help`, `exit`, and `show config`
remain usable without a healthy store. For interactive startup, print the
actionable error on stderr and use an unselected/error prompt. Wallet commands
and `status` report the applicable error. A valid registry with a broken
default keystore may be repaired operationally with explicit `wallet use` and
`wallet default` for an intact entry; structural registry corruption requires
restoring metadata from backup. An explicit invalid startup `--wallet` always
aborts startup, even for `help`.

Refresh the current entry by stable ID at command boundaries. Thus an external
rename is visible on the next prompt/command, while an external default change
does not switch the session. Capture alias/address/path for the entire command;
a rename during a command does not change its preview or result. Sequential
REPL execution must not run another command while a transaction is pending.

## 4. Commands and argument rules

All commands below support command-level `--json`. Reject extra positional
arguments and flags before prompting or mutating files.

| Command                                         | Arguments and effects                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `wallet`                                        | Help, successful exit; no store access required.                                                                               |
| `wallet import <alias> [--keypair-file <path>]` | Exactly one alias; secure existing import prompts.                                                                             |
| `wallet list`                                   | No arguments; list registered wallets without RPC/unlock.                                                                      |
| `wallet info [<alias>]`                         | Zero or one alias; named inspection never switches selection.                                                                  |
| `wallet use <alias>`                            | Exactly one; select only for this process. Reject in `-c` mode with guidance to startup `--wallet`. Allowed in piped sessions. |
| `wallet default <alias>`                        | Exactly one; save default, never switch current session.                                                                       |
| `wallet rename <old> <new>`                     | Exactly two; same alias is a successful no-op.                                                                                 |
| `wallet migrate <alias>`                        | Exactly one; migrate old single keystore as described below.                                                                   |
| `wallet recover <uuid> <alias>`                 | Exactly two; register an existing unregistered UUID keystore after verification.                                               |
| `status`                                        | No arguments; local context only, no balance/health RPC calls.                                                                 |

`wallet recover` is the narrowly scoped recovery command needed for interrupted
imports and registry loss. It does not accept external paths or plaintext keys.
No delete/reset/force flags are part of this release.

Validate alias syntax before file/key input. Check alias availability before
prompts and recheck under the write lock. Check address duplication after key
derivation and again under lock. Error messages identify the existing alias and
suggest `wallet use` or `wallet rename`. No silent lowercasing or abbreviation
matching. An alias equal to a command name is valid in an alias argument.

The operation that changes an empty registry to nonempty sets both default and
that process's current wallet. Later imports/recoveries leave both unchanged.
If two empty sessions import concurrently, only the first committer gets this
behavior; the second remains unselected until `wallet use`. Never change a
session because another process populated an empty store.

Selecting the current wallet again and setting the existing default succeed as
no-ops. Selecting, defaulting, and inspecting a wallet require an intact keystore
whose public metadata agrees with its registry entry; no passphrase required.
Rename requires valid registry metadata and does not rewrite/open the key file.

## 5. Atomic writes, locks, and interruption recovery

Use Node built-ins, existing crypto, and Zod; no new storage dependency is
required. Use atomic `mkdir` of `.wallet-store.lock` as an exclusive store-wide
writer lock. All registry and scoped stake read-modify-write operations use it.
Readers observe complete old/new snapshots through atomic replacement.

On EEXIST, fail promptly with `WalletStoreBusy` (exit 1). Do not auto-steal based
on PID or timeout: separate Docker containers can reuse PIDs. Include guidance
to retry and consult recovery docs. Optional owner metadata contains only PID,
timestamp, and a random ownership token; it is diagnostic, not proof of liveness.
Remove only the owned lock in `finally`. Do not hold the lock during user prompts,
KDF work, RPC calls, simulation, signing, or transaction confirmation.

Recovery docs must say to stop every CLI process/container using this config
directory before manually removing the exact stale lock directory. Never offer
automatic broad deletion, and never infer that age alone makes a lock stale.

Metadata writes: validate prospective contents, write a unique same-directory
temporary file with create-only mode and 0600, sync/close, atomically rename over
the old metadata, then sync the containing directory. Scope the guarantee to
the supported Linux filesystem/Docker bind mount. Preserve old data on failures
before rename. If a post-rename sync fails, report commit durability as uncertain
and tell users to inspect state; do not roll back a potentially committed write.

Import order:

1. Validate arguments/store, read key, derive/confirm address, collect/confirm
   passphrase, encrypt, and verify an in-memory decrypt round trip.
2. Write a private unique temporary keystore in `wallets/`, read it back and
   decrypt/verify it. Clear owned decrypted buffers in `finally`.
3. Acquire lock, reload registry, and recheck alias/address uniqueness. Generate
   UUID, publish the verified key to its final UUID path using create-only
   semantics (existing hard-link approach is suitable), and sync the directory.
4. Atomically publish updated registry. This is the logical commit point.
5. Release lock and remove this operation's temporary file. Change session
   selection only after successful commit, following the first-import rule.

If publication of the key succeeds but registry publication fails, retain the
final encrypted key as an orphan and report its UUID plus `wallet recover`.
Never delete a final UUID keystore on an error path, especially after an
uncertain registry commit. Private temporary files are not active wallets; a
crash may leave them behind. Document targeted cleanup only after stopping all
writers and preserving possible recovery data.

When a valid registry has orphan UUID files, ordinary registered-wallet commands
still work. `wallet list` reports orphan UUIDs separately without adopting them.
With no registry and orphan files, ordinary imports are blocked until recovery;
`wallet recover` can create the registry and register a user-chosen file.

Recovery reads the validated UUID path, asks for its passphrase, validates the
derived address, and registers it under lock after duplicate checks. Recheck
the encrypted file has not changed since verification (compare bytes/hash).
Never re-encrypt or rename the file. First recovery becomes current/default;
later recovery does not. Repeating recovery of the same UUID and alias is a
successful no-op; a conflicting alias/UUID/address is an error with guidance.

## 6. Legacy migration

`wallet migrate <alias>` operates on root `keystore.json`. Do not use its old
implicit path from any other command. Allow migration into an empty store, or
idempotent detection of an already registered legacy public address. If a
nonempty registry contains different wallets but not the legacy address, reject
with guidance to back up data and use normal import; do not merge implicitly.

Validate the old encrypted file, unlock once with its existing passphrase, and
verify its derived address. Copy the exact encrypted bytes via the same staged
publication and registry commit mechanism as import. Keep the old file untouched.
Use the supplied alias, a new UUID, and current timestamp. Do not prompt for or
change the passphrase. Do not migrate automatically on startup.

If the legacy address is already registered under the requested alias, report
already migrated without mutation. If under another alias, report that alias
and suggest rename. If a previous failed migration left an unregistered UUID
keystore for the legacy address, report that UUID and require `wallet recover`
rather than creating another copy. This orphan check also applies to imports
so retries cannot proliferate duplicate keys.

If old and new layouts coexist with a valid registry, new layout wins exclusively.
Leave root `stake-accounts.json` untouched and out of live results: its network
is unknown. No automatic legacy stake-record conversion in v0.3. On-chain stake
discovery remains authoritative and available; document why the old file is
preserved and why it must not be blindly assigned to a network.

## 7. Code boundaries and identity binding

Suggested interfaces (equivalent names are allowed; semantics are required):

```ts
type WalletIdentity = Readonly<{
  id: string;
  alias: string;
  address: Address;
}>;

type SelectedWallet = Readonly<{
  identity: WalletIdentity;
  keystorePath: string;
}>;

// store.ts: public metadata and serialized persistence; no RPC.
readRegistry(configDir): Promise<WalletRegistry>;
resolveWallet(configDir, id): Promise<SelectedWallet>;
withStoreLock(configDir, operation): Promise<T>;

// selection.ts / context.ts: called once at command dispatch.
resolveCommandWallet(context): Promise<SelectedWallet>;

// signer.ts: no default/alias lookup during signing.
new EncryptedKeystoreSigner(selectedWallet, readPassphrase);
```

Use an execution-scoped context or explicit argument carrying the frozen selected
wallet. The existing `requireWallet` may remain as an accessor returning that
snapshot's address; it must no longer read files/reselect. Resolve only for
commands that need a wallet, not globally before help/wallet import/validators.
Snapshot network/RPC/commitment for the command too. Nested staking helpers and
Jupiter callbacks must receive the same context. Do not shallow-copy session
mutation state accidentally when constructing execution contexts.

The signer reads the captured file once at signing, validates its public address
against the captured address, decrypts that exact parsed object, derives the
address, and checks equality again before constructing the Kit signer. Never
reopen an alias-selected path between validation and decryption. Clear secret
buffers in `finally`; do not claim JavaScript guarantees complete memory erasure.

| Area                                                           | Required changes                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/wallet/store.ts`, `selection.ts` (new)                    | Strict schemas, ID/path validation, registry transactions, selection.                                             |
| `src/wallet/keystore.ts`                                       | Explicit file-path I/O; keep crypto format and create-only protection. Separate legacy path helper for migration. |
| `src/wallet/signer.ts`                                         | Captured wallet/path; expected-address checks; remove implicit config-directory lookup.                           |
| `src/config/config.ts`                                         | New path helpers; keep network config independent; legacy helpers migration-only.                                 |
| `src/cli.ts`, `commands/context.ts`                            | Startup option, execution mode, session current ID, command snapshot.                                             |
| `commands/execute.ts`, `wallet-import.ts`, new wallet handlers | Exact arity/flags; commands; import/migration/recovery transactions.                                              |
| `commands/read-only.ts`                                        | Snapshot-based wallet reads; status; consistent identity.                                                         |
| `commands/send.ts`, `token-send.ts`                            | Bound source/fee payer/signer; previews and final identity.                                                       |
| `commands/staking.ts`                                          | Every signer and authority helper, shared execute path, scoped registry and outputs.                              |
| `commands/lending.ts`                                          | `createLendSigner`, read/deposit/withdraw flows, position output and refresh callbacks.                           |
| `shell/repl.ts`, `help.ts`, `completion.ts`                    | Startup, prompt, aliases, command help, no JSON banners.                                                          |
| `output/`, `errors/`                                           | Consistent identity payloads, typed errors, safe RPC display.                                                     |
| `test/unit/`, `test/e2e/`                                      | Update single-wallet setup and add matrix below.                                                                  |

Do not change Jupiter adapter business logic or core Solana transaction behavior
unless necessary to pass the captured identity. Clear token/stake completion on
wallet switch; clear token/stake/validator caches on cluster or RPC changes.
Refresh alias completion at command boundaries, using public metadata only.

## 8. Output and errors

All JSON examples use `<address>` as an explanatory placeholder, not a fixture.
Wallet identity always has `{ id, alias, address }`; never a bare string in a
field named `wallet`. Preserve existing separate `address`, `owner`, `from`,
`to`, and numeric/result fields. Update existing stake/Jupiter `wallet` string
fields to the identity object, including nested preflight and position objects.
All wallet-dependent successes include top-level `wallet` and `cluster`.

`status` success shape:

```json
{
  "ok": true,
  "wallet": {
    "id": "619c12ca-fc26-4db1-a9ed-aef7f6978643",
    "alias": "daily",
    "address": "<address>"
  },
  "defaultWallet": {
    "id": "619c12ca-fc26-4db1-a9ed-aef7f6978643",
    "alias": "daily",
    "address": "<address>"
  },
  "cluster": "mainnet",
  "rpcUrl": "https://api.mainnet.solana.com",
  "commitment": "confirmed"
}
```

For a genuinely empty healthy store, both wallet fields are null and status
succeeds. Migration/recovery-required/corrupt states are errors, not empty stores.
`wallet list` returns `{ ok, currentWalletId, defaultWalletId, wallets, orphanIds }`;
each wallets entry contains the identity plus `createdAt`, `current`, `default`,
and `health: "ok" | "missing" | "invalid"`. Inspect public keystore metadata for
health; never decrypt. An invalid unrelated file does not hide intact entries.

`wallet info` returns `{ ok, wallet, cluster, createdAt, current, default,
encrypted: true }`. Mutation successes return `{ ok, action, wallet,
currentWalletId, defaultWalletId, changed }`; action is the wallet subcommand,
`wallet` is its target, and `changed` is false for defined no-ops. Transaction
success and dry-run payloads retain existing fields plus wallet/cluster.

Human list columns: CURRENT, DEFAULT, ALIAS, ADDRESS, HEALTH, with separate `*`
markers for current/default; no numeric wallet selectors. Status prints full
address and default alias. Preview includes `Wallet: alias (full address)` and
cluster. Passphrase prompt: `Passphrase for alias (short-address): `.

Human TTY startup uses the product design's example. Prompt with no selection:
`sol-wallet [mainnet | no-wallet]> `; with store error use `wallet-error`.
No startup banner or readline prompt in piped/JSON modes. JSON commands each emit
one result line on stdout; diagnostics/errors/prompts go to stderr. Retain the
existing preflight-on-stderr behavior for JSON transactions. Secret input still
requires a TTY; do not invent stdin passwords for automation.

Display RPC URLs consistently in status/show config: remove userinfo, query,
fragment, and replace any non-root path with `/[REDACTED]`. This conservative
display rule avoids assuming which provider embeds credentials in a path. Keep
the actual connection URL unchanged internally. Do not include raw URLs in new
wallet error messages.

New typed errors use the existing `{ ok: false, error, message, details? }`
envelope. Stable codes and process exit codes:

| Error                     | Exit | Examples                                                                  |
| ------------------------- | ---- | ------------------------------------------------------------------------- |
| `ParseError`              | 2    | Arity, unknown flags, forbidden one-shot `wallet use`.                    |
| `WalletAliasInvalid`      | 2    | Invalid alias syntax.                                                     |
| `WalletNotFound`          | 2    | Unknown explicit alias.                                                   |
| `WalletAliasExists`       | 2    | Alias collision.                                                          |
| `WalletAlreadyExists`     | 2    | Duplicate address or conflicting recovery target.                         |
| `WalletNotSelected`       | 2    | Wallet command needing current identity with no selection.                |
| `WalletMigrationRequired` | 2    | Legacy-only installation.                                                 |
| `WalletRecoveryRequired`  | 2    | UUID files without registry.                                              |
| `WalletStoreInvalid`      | 1    | Corruption, dangling default, missing/mismatched selected keystore.       |
| `WalletStoreBusy`         | 1    | Writer lock exists.                                                       |
| `WalletStoreWriteError`   | 1    | I/O failure; distinguish committed/uncertain state in message.            |
| `KeystoreError`           | 1    | Wrong passphrase, encrypted integrity failure, signing identity mismatch. |

In REPL, display the error and continue without changing selection. Exit-code
values apply to one-shot/startup failures; preserve existing piped error policy.
Errors after wallet resolution may include safe `details.wallet`; never key
material, passphrases, or encrypted payloads. No permissive catch-and-fallback.

## 9. Required acceptance scenarios

Use two disposable distinct wallets A and B with distinct test passphrases.
Use temporary config directories, never the developer's real wallet directory.
No real RPC or funds are required. Fault injection must exercise real storage
boundaries, not just mock a happy-path registry return value.

| ID  | Scenario                                                                            | Expected result                                                                                                              |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| W01 | Import A into empty store, then B                                                   | Two UUID files; A remains current/default; original A bytes unchanged.                                                       |
| W02 | Invalid/duplicate alias; duplicate address under new alias                          | Typed error; no registry changes or new final keys.                                                                          |
| W03 | Use B, restart process                                                              | Current B in old process; new process selects saved A.                                                                       |
| W04 | Current A, default B                                                                | Current stays A; next process selects B; explicit `--wallet A` overrides without saving.                                     |
| W05 | Unknown/missing/duplicate startup wallet flag                                       | Exit 2; no fallback, prompt, or RPC.                                                                                         |
| W06 | Rename selected/default A                                                           | Same ID/key bytes/stake path; updated alias in next prompt and startup.                                                      |
| W07 | Another process changes default/alias during B transaction                          | Source, fee payer, signer, preview/result retain captured B identity.                                                        |
| W08 | Empty-store status/help, wallet-dependent balance                                   | Status succeeds with null; help works; balance fails before RPC.                                                             |
| W09 | Invalid registry/version/default; missing selected key                              | Fail safely; help usable; no replacement/fallback; intact explicit selection only where registry valid.                      |
| W10 | Registry/path traversal, symlink, address mismatch                                  | Reject before secret prompt/signing; no escaped writes.                                                                      |
| W11 | Two processes import same alias/address concurrently                                | Exactly one registration succeeds; no overwritten key/lost registry entry.                                                   |
| W12 | Two writers use different aliases                                                   | Busy writer retries explicitly; after retry both records survive.                                                            |
| W13 | Fail before key publish / after key publish / before registry rename / after rename | Old registry or committed registry stays valid; retained final key recoverable; uncertain commit never deletes key.          |
| W14 | Crash leaves lock                                                                   | Next writer fails busy; no timed/PID auto-steal; documented recovery works.                                                  |
| W15 | Legacy migration, wrong password, retry, interrupted migration                      | Correct password preserves encrypted bytes; wrong password makes no mutation; retry no duplicate; orphan recovery supported. |
| W16 | Old and new files coexist                                                           | Every normal command uses only selected new UUID file.                                                                       |
| W17 | Registry lost, UUID files survive                                                   | No automatic selection; explicit recovery restores chosen aliases/default without re-encryption.                             |
| W18 | Stake A/B and mainnet/devnet records                                                | Isolated paths and matching headers; no legacy unclassified entries mixed in.                                                |
| W19 | Switch wallet/network/RPC                                                           | Relevant completion caches cleared; alias completion refreshed.                                                              |
| W20 | JSON status/list/info/transactions, piped commands                                  | Correct schemas and identities; no banner/prompt on stdout; errors on stderr.                                                |
| W21 | Wrong B passphrase or substitute A keystore for B                                   | No signature/broadcast; no attempt to open A as fallback.                                                                    |
| W22 | Dry run with B                                                                      | Correct B identity and fee payer; no unlock/sign/broadcast.                                                                  |
| W23 | All wallet subcommands with missing/extra args and flags                            | Usage errors before file writes or secret prompts; bare group shows help.                                                    |
| W24 | Credentials in RPC userinfo/query/path                                              | Status/show config redact them; RPC client retains actual URL.                                                               |

For W07/W21/W22, cover SOL send, token send, stake create/deactivate/withdraw,
and Jupiter deposit/withdraw/withdraw-all. Inspect compiled transaction accounts
and cryptographically verify produced signatures against B where applicable;
checking only displayed alias or a mocked signer call is insufficient. Stub the
Jupiter adapter to return deterministic instructions to avoid live SDK/network
dependencies while exercising the real CLI signing boundary.

Docker E2E must import both wallets, switch/rename/default, restart containers
with the same volume, verify prompt and JSON identity, migrate a legacy fixture,
and execute at least one mock-RPC signed transaction using B. Existing token,
staking, lending, history-filtering, non-TTY, and help regressions must still pass.

## 10. Milestones and final handoff

Update root PLAN.md to current implementation state when coding begins. Work in
these coherent units; do not mark later milestones done based on an earlier
unit's tests:

1. Storage schemas/path helpers/locking/import publication and recovery tests.
2. Migration/recovery plus selected-wallet context and bound signer tests.
3. All feature handlers and scoped stake storage, including transaction identity
   assertions across the existing command set.
4. Commands, startup, status, help/completion, output contracts, and PTY coverage.
5. Beginner/recovery docs, formatting, full validation, and final diff review.

Update `docs/getting-started.md`, `command-cookbook.md`, `architecture.md`,
`security-and-testing.md`, `implementation.md`, `jupiter-lend.md`, and README
examples as applicable. Add a dedicated `docs/multiple-wallets.md` tutorial with
two-wallet examples, alias-versus-address explanation, selection/default rules,
whole-directory and individual-keystore backups, passphrase requirements,
migration, orphan recovery, stale locks, and v0.3 JSON changes. Explain that
renaming/migrating local data does not move funds. Comment storage ordering and
signer invariants in source. Keep `specs/` as requirements, not operational logs.

Required local checks: `npm run format`, `npm run format:check`, `npm test`,
`npm run lint`, `npm run build`, `git diff --check`, and Black formatting/check
when Python E2E files change. Use existing dependencies and release-age controls.
Record any environment installs or blocked validation in `docs/` and PLAN.md.

Retain the existing GitHub workflow's exact-image build/E2E/publish gate, branch
and bare short-commit image tags, and wrapper pull-on-launch behavior. If local
Docker is unavailable, record E2E as pending GitHub Actions, not passed. When
commit/push is requested, follow the applicable skills and inspect CI through
completion. This specification does not itself authorize publishing or asking
Claude Code to review. Do not bump versions or upgrade dependencies incidentally.

Before completion, search for all old implicit keystore accesses, old `wallet
import` examples, and signer constructors. No runtime single-key fallback may
remain outside migration helpers. Review the final diff and report actual test
results, unresolved failures, and remaining work.

Suggested implementation prompt:

> Implement v0.3 using specs/multiple-wallets-design.md and
> specs/multiple-wallets-implementation.md. Follow AGENTS.md, inspect current
> state first, and maintain PLAN.md. Complete the required acceptance scenarios
> and documentation. Do not expand deferred scope or weaken security checks.
> Report validation accurately and leave publishing to a separate request.
