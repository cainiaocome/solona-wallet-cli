# Solana Wallet CLI specification

This file consolidates the original product specification, the approved v0.3
multiple-wallet design, and its implementation contract. Requirements are retained
in their original release context; this is not a claim that every requirement has
been implemented or validated. See [PLAN.md](../PLAN.md) and [docs](../docs/README.md)
for current status.

- [Part I: Original product specification](#part-i-original-product-specification)
- [Part II: Multiple-wallet product design](#part-ii-multiple-wallet-product-design)
- [Part III: Multiple-wallet implementation contract](#part-iii-multiple-wallet-implementation-contract)

For wallet behavior, Part III takes precedence over Part II and the older
single-wallet requirements in Part I. Explicit user decisions and repository
working rules take precedence throughout. The user has accepted plaintext RPC
URLs in output/history; the older redaction requirements and W24 below are
retained as historical requirements, not outstanding implementation work.

## Part I: Original product specification

## 1. Purpose

Build a small, security-conscious, **Solana-only command-line wallet** for personal use.

The first release should intentionally stay narrow:

- import and manage **one Solana private key**
- show wallet address and SOL balance
- show SPL / Token-2022 balances
- send SOL
- send SPL tokens
- perform **native Solana staking**
- inspect, simulate, sign, broadcast, and confirm transactions
- keep the private key encrypted at rest

This is **not** intended to be a general-purpose browser wallet, dApp wallet, swap client, trading bot, or DeFi client.

The design should prefer a small attack surface and auditable code over feature count.

---

## 2. Core design principles

1. **Solana only**
   - Do not introduce generic multi-chain abstractions.
   - A small amount of Solana-specific code is preferable to a large generic wallet framework.

2. **Interactive shell first**
   - Running `sol-wallet` with no command launches a persistent interactive wallet shell, similar in spirit to IPython.
   - Users should not need to repeatedly type `sol-wallet` before every action.
   - The shell must support line editing, command history, contextual help, and context-aware tab completion.
   - Keep a non-interactive `-c` / `--command` mode for scripts and automation.

3. **Use the current Solana TypeScript stack**
   - Use `@solana/kit`.
   - Use official generated program packages where available:
     - `@solana-program/system`
     - `@solana-program/stake`
     - `@solana-program/token`
     - `@solana-program/token-2022`
   - Do **not** start a new implementation on legacy `@solana/web3.js` v1 unless a narrowly scoped compatibility dependency makes it unavoidable.

4. **Private keys never leave the local process**
   - RPC providers receive addresses, RPC requests, signatures, and signed transactions only.
   - Never send private key material, passphrases, or decrypted keystore bytes to any network service.

5. **Read-only commands must not decrypt the key**
   - `address`, `balance`, `token list`, validator queries, and stake-account queries should work using the public address only.
   - Decrypt the key only when an operation actually needs signing.

6. **Never take a private key or keystore password as a CLI argument**
   - CLI arguments can leak through shell history and process listings.
   - Secret input must be read through a hidden TTY prompt.

7. **No telemetry**
   - No analytics, crash reporting, remote logging, or usage tracking.

8. **No floating-point arithmetic for token amounts**
   - Internally use `bigint` lamports / raw token units.
   - Decimal strings are parsed exactly using mint decimals.

9. **Mainnet writes must be deliberate**
   - Build and summarize the transaction.
   - Simulate it.
   - Ask for confirmation unless `--yes` was explicitly supplied.
   - Only then broadcast.

10. **Keep implementation boring**

- Prefer official SDKs and Node standard library.
- Avoid custom cryptography and custom binary serialization when an official package already exposes the operation.

---

## 3. Scope for v0.1

### Required

- encrypted local keystore
- import a Solana private key
- derive and display the address
- SOL balance
- SPL Token and Token-2022 balances
- SOL transfer
- token transfer
- native SOL staking:
  - list validators
  - create + initialize + delegate a stake account
  - list stake accounts
  - deactivate stake
  - withdraw deactivated stake
- configurable RPC endpoint
- devnet and mainnet
- transaction simulation
- transaction confirmation
- human-readable output
- `--json`
- `--dry-run`
- unit tests
- opt-in integration tests

### Explicit non-goals for v0.1

Do **not** implement:

- mnemonic / seed phrase import
- multiple wallets
- multiple accounts / derivation paths
- Ethereum or any other chain
- WalletConnect
- browser extension integration
- dApp signing
- arbitrary transaction signing from untrusted external input
- swaps
- Jupiter integration
- liquid staking
- stake pools
- lending
- NFT UI
- address book
- cloud backup
- remote key storage
- hardware wallets
- Ledger
- multisig
- transaction scheduling
- background daemons
- automatic validator selection
- automatic redelegation
- MEV strategies

These can be revisited later only if there is a concrete need.

---

## 3.1 Planned v0.2 — Jupiter Lend USDC Earn

Jupiter Lend integration is intentionally **not part of v0.1**.

Codex should finish, test, and stabilize all v0.1 wallet functionality before starting this section.

v0.2 may add a narrowly-scoped Jupiter Lend integration for **USDC Earn only**:

```bash
sol-wallet jupiter-lend status
sol-wallet jupiter-lend deposit <amount>
sol-wallet jupiter-lend withdraw <amount>
sol-wallet jupiter-lend withdraw --all
```

Initial v0.2 scope:

- mainnet only
- canonical Solana USDC only
- Jupiter Lend Earn / supply side only
- read current USDC lending position
- deposit USDC
- withdraw USDC
- withdraw full available position
- use the same transaction pipeline as the rest of the wallet:
  - validate
  - build
  - summarize
  - simulate
  - confirm
  - sign
  - broadcast
  - confirm

Explicitly **out of scope for v0.2**:

- Jupiter Borrow
- collateral positions
- borrowing assets
- repaying debt
- leverage
- looped lending
- flash loans
- liquidations
- automated rebalancing
- automatic APY chasing
- generic support for every Jupiter Lend asset

The first Jupiter integration should remain intentionally boring and limited to:

```text
USDC
  ↓
Jupiter Lend Earn deposit
  ↓
yield-bearing position
  ↓
withdraw
  ↓
USDC
```

Do not start v0.2 work until v0.1 satisfies its Definition of Done.

---

## 4. Runtime, build, and distribution

Use:

- TypeScript
- Node.js current active LTS
- ESM
- strict TypeScript
- npm
- committed `package-lock.json`

The **official v0.1 distribution artifact is a Docker image**.

Do not spend v0.1 effort producing:

- a standalone Node SEA executable
- a Bun executable
- a statically linked binary
- macOS packages
- Windows packages
- ARM images

The only required release platform is:

```text
linux/amd64
```

The intended release flow is:

```text
TypeScript source
   ↓
npm ci
   ↓
npm test
   ↓
npm run build
   ↓
Docker image: linux/amd64
   ↓
E2E tests against that exact image
   ↓
push to GHCR
```

Recommended dependencies:

```text
@solana/kit
@solana/kit-plugin-rpc
@solana/kit-plugin-signer

@solana-program/system
@solana-program/stake
@solana-program/token
@solana-program/token-2022

commander
zod
@inquirer/prompts
bs58
@node-rs/argon2
dotenv
```

Recommended dev dependencies:

```text
typescript
tsx
vitest
@types/node
```

Optional if it materially improves integration testing:

```text
@solana/kit-plugin-litesvm
```

Use Node's built-in `node:crypto` for:

- `randomBytes`
- AES-256-GCM encryption/decryption
- timing-safe comparison where applicable

Do not add another crypto library unless necessary.

### Docker image requirements

Add:

```text
Dockerfile
.dockerignore
```

Use a multi-stage Dockerfile.

Recommended shape:

```dockerfile
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm test
RUN npm run build
RUN npm prune --omit=dev


FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

ENTRYPOINT ["node", "/app/dist/cli.js"]
```

The exact Node major may be adjusted to the current active LTS when implementation begins.

The runtime image must:

- contain only production dependencies
- not contain source `.ts` files unless required at runtime
- not contain test fixtures
- not contain `.env`
- not contain developer keys
- not contain npm cache
- not contain Git metadata
- start directly into `sol-wallet`
- work correctly with `docker run --rm -it`

The image must not run as root if avoiding root is practical without complicating bind-mounted config permissions.

If a non-root runtime user is used, document the expected UID/GID and ensure the mounted wallet directory remains writable.

### Persistent state in Docker

The wallet state lives outside the disposable container.

The intended host mount is:

```text
~/.config/sol-wallet
```

mounted into the container's configured wallet data directory.

Example:

```bash
docker run --rm -it \
  -v "$HOME/.config/sol-wallet:/home/solwallet/.config/sol-wallet" \
  ghcr.io/<owner>/sol-wallet:latest
```

The actual container home path may differ if the runtime user differs, but there must be exactly one documented persistent-data mount.

Do not use an anonymous Docker volume for the wallet keystore by default.

The user must be able to see and back up:

```text
config.json
keystore.json
stake-accounts.json
history
```

on the host filesystem.

### Host wrapper

Provide an optional helper script:

```text
scripts/sol-wallet
```

that makes Docker usage feel like a normal CLI.

Conceptually:

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="${SOL_WALLET_IMAGE:-ghcr.io/<owner>/sol-wallet:master}"
CONFIG_DIR="${SOL_WALLET_CONFIG_DIR:-$HOME/.config/sol-wallet}"

mkdir -p "$CONFIG_DIR"

TTY_ARGS=()
if [[ -t 0 && -t 1 ]]; then
  TTY_ARGS=(-it)
else
  TTY_ARGS=(-i)
fi

exec docker run --rm \
  "${TTY_ARGS[@]}" \
  -v "$CONFIG_DIR:/home/solwallet/.config/sol-wallet" \
  "$IMAGE" \
  "$@"
```

The exact container path must match the Dockerfile runtime user.

The wrapper is convenience only. The Docker image itself remains the release artifact.

### Version policy

At bootstrap time:

1. resolve the latest **stable** mutually compatible versions
2. never use `canary`, `beta`, `rc`, or experimental package versions
3. commit exact resolved versions in `package-lock.json`
4. add a short comment to the README stating the versions the code was tested against

The Solana Kit API is evolving quickly. When the exact API differs from examples in this spec, use the API exposed by the installed stable package and preserve the behavior described here.

### v0.2 dependency exception for Jupiter Lend

The core wallet should remain on `@solana/kit`.

If Jupiter's official Lend SDK still depends on legacy `@solana/web3.js` types when v0.2 is implemented, it is acceptable to add that dependency **only inside the Jupiter Lend integration adapter**.

Recommended v0.2 isolation:

```text
src/
  integrations/
    jupiter-lend/
      client.ts
      adapter.ts
      position.ts
      deposit.ts
      withdraw.ts
```

Rules:

- core wallet code must not begin importing `@solana/web3.js`
- Jupiter-specific `PublicKey`, `TransactionInstruction`, `Connection`, or related legacy types must stay inside `src/integrations/jupiter-lend/`
- convert Jupiter-generated instructions into the wallet's normal transaction representation at the adapter boundary
- do not rewrite or manually encode Jupiter Lend program instructions if the official Jupiter SDK can generate them
- do not replace `@solana/kit` globally just to accommodate Jupiter Lend

Before implementing v0.2, Codex must verify the current stable Jupiter Lend SDK package names and APIs because Jupiter SDKs may change.

---

## 5. Proposed project structure

```text
.
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── README.md
├── spec.md
├── Dockerfile
├── .dockerignore
├── .github/
│   └── workflows/
│       └── docker.yml
├── scripts/
│   └── sol-wallet
├── src/
│   ├── cli.ts
│   ├── shell/
│   │   ├── repl.ts
│   │   ├── parser.ts
│   │   ├── completion.ts
│   │   ├── history.ts
│   │   ├── prompt.ts
│   │   └── help.ts
│   ├── commands/
│   │   ├── wallet-import.ts
│   │   ├── address.ts
│   │   ├── balance.ts
│   │   ├── send.ts
│   │   ├── token-list.ts
│   │   ├── token-balance.ts
│   │   ├── token-send.ts
│   │   ├── validators.ts
│   │   ├── stake-create.ts
│   │   ├── stake-list.ts
│   │   ├── stake-deactivate.ts
│   │   ├── stake-withdraw.ts
│   │   └── tx-inspect.ts
│   ├── config/
│   │   ├── config.ts
│   │   └── schema.ts
│   ├── wallet/
│   │   ├── keystore.ts
│   │   ├── import.ts
│   │   ├── signer.ts
│   │   └── address.ts
│   ├── solana/
│   │   ├── client.ts
│   │   ├── rpc.ts
│   │   ├── amounts.ts
│   │   ├── transactions.ts
│   │   ├── confirmation.ts
│   │   ├── tokens.ts
│   │   └── staking/
│   │       ├── validators.ts
│   │       ├── stake-accounts.ts
│   │       ├── create.ts
│   │       ├── deactivate.ts
│   │       └── withdraw.ts
│   ├── output/
│   │   ├── human.ts
│   │   └── json.ts
│   └── errors/
│       └── errors.ts
└── test/
    ├── unit/
    ├── fixtures/
    ├── integration/
    └── e2e/
        ├── test_docker_repl.py
        ├── test_docker_oneshot.py
        └── mock_rpc/
```

Avoid creating a deep class hierarchy. Prefer small functions and explicit data structures.

---

## 6. CLI executable and interactive shell

Binary name:

```bash
sol-wallet
```

The primary UX is interactive.

Running:

```bash
sol-wallet
```

launches a persistent wallet shell:

```text
Solana Wallet CLI
Wallet: 7abc...xyz
Cluster: mainnet
Type `help` for commands.

sol-wallet [mainnet]>
```

Example session:

```text
sol-wallet [mainnet]> balance
12.345678901 SOL

sol-wallet [mainnet]> token list
USDC   EPjF...Dt1v   1,250.42
...

sol-wallet [mainnet]> token balance EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
1,250.42 USDC

sol-wallet [mainnet]> stake list
...

sol-wallet [mainnet]> exit
```

The shell should feel closer to IPython / a database shell than to repeatedly invoking Unix subcommands.

`package.json` should expose:

```json
{
  "bin": {
    "sol-wallet": "./dist/cli.js"
  }
}
```

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm link
sol-wallet
```

### Non-interactive mode

Keep a compact non-interactive mode for scripts, CI, Codex, and future agents:

```bash
sol-wallet -c "balance"
sol-wallet -c "token list" --json
sol-wallet -c "stake list" --json
```

Alias:

```bash
sol-wallet --command "balance"
```

Rules:

- `-c` executes exactly one wallet-shell command and exits.
- It must use the same parser, validators, command handlers, transaction pipeline, and output layer as the interactive shell.
- Do not maintain separate interactive and non-interactive implementations.
- `--json` is primarily intended for `-c` mode, although it may also be used interactively.
- State-changing commands in `-c` mode still require confirmation unless `--yes` is supplied.
- Secret prompts must still use the TTY and must never accept secrets embedded inside `-c`.

---

## 7. Interactive command language

Commands are entered **inside** the `sol-wallet` shell.

### Core commands

```text
help
help <command>
address
balance
exit
quit
clear
```

### Wallet

```text
wallet import
wallet info
```

For v0.1 there is only one controlled wallet, so commands do not need a wallet selector.

### SOL transfer

```text
send <destination> <amount>
```

Example:

```text
send 7abc...xyz 1.25
```

### Tokens

```text
token list
token balance <mint>
token send <mint> <destination> <amount>
```

### Validators

```text
validators
validators --limit 50
validators --current-only
validators --max-commission 5
```

### Native staking

```text
stake create <amount> --validator <vote-account>
stake list
stake deactivate <stake-account>
stake withdraw <stake-account>
stake withdraw <stake-account> --amount <amount>
```

### Transaction inspection

```text
tx inspect <signature>
```

### Future v0.2 Jupiter Lend

```text
jupiter-lend status
jupiter-lend deposit <amount>
jupiter-lend withdraw <amount>
jupiter-lend withdraw --all
```

### Session commands

Add a small set of shell/session commands:

```text
set
set cluster <mainnet|devnet>
set rpc-url <url>
set commitment <processed|confirmed|finalized>
show config
history
clear
help
exit
quit
```

Changing session configuration affects future commands in the current shell only unless an explicit persistent config command is added later.

For safety:

- changing `cluster` must print the new cluster prominently
- never silently switch clusters
- a state-changing command should include the cluster in its preflight summary

### Command parser

Use one parser for both:

```text
interactive shell input
```

and:

```bash
sol-wallet -c "..."
```

The parser should support:

- quoted strings
- whitespace separation
- long flags: `--validator`, `--amount`
- boolean flags: `--all`, `--json`, `--dry-run`, `--yes`
- `--flag=value`
- useful parse errors with command-specific usage

Do not execute commands through a shell.

Do not implement parsing by passing user text to `eval`, `bash`, `sh`, or another command interpreter.

A small explicit command grammar is preferable.

---

## 7.1 Prompt design

Default prompt:

```text
sol-wallet [mainnet]>
```

If practical, include a shortened wallet address:

```text
sol-wallet [mainnet 7abc…xyz]>
```

Do not include:

- private-key material
- secret-key fingerprint
- encrypted ciphertext
- token balances that require an RPC request on every prompt render

Prompt rendering should be instant and offline.

If the shell has no imported wallet yet:

```text
sol-wallet [mainnet no-wallet]>
```

and read-only network commands that require an owner address should return a clear message suggesting:

```text
wallet import
```

---

## 7.2 Tab completion

Tab completion is a required v0.1 feature.

Prefer Node's built-in `node:readline` / `readline/promises` facilities plus a custom completer before adding a large shell framework.

Completion must be **context aware**.

### Command completion

Examples:

```text
t<TAB>
```

may complete or suggest:

```text
token
tx
```

```text
token <TAB>
```

suggests:

```text
list
balance
send
```

```text
stake <TAB>
```

suggests:

```text
create
list
deactivate
withdraw
```

### Flag completion

Examples:

```text
validators --<TAB>
```

suggests:

```text
--limit
--current-only
--max-commission
--json
```

```text
stake create 10 --<TAB>
```

suggests:

```text
--validator
--dry-run
--yes
--json
```

### Dynamic completion

Where useful, complete values from safe local/read-only data.

Examples:

```text
token balance <TAB>
token send <TAB>
```

may suggest mints from the wallet's most recently fetched token inventory.

```text
stake deactivate <TAB>
stake withdraw <TAB>
```

may suggest known stake-account addresses discovered during the session or stored in the local public stake registry.

Do **not** attempt to tab-complete every validator vote account from the network; that list is too large.

For:

```text
stake create 10 --validator <TAB>
```

completion may suggest:

- validators previously inspected in the current session
- validators from the most recent `validators` result set

Do not perform a large RPC request synchronously on every TAB press.

### Completion cache

Maintain a small in-memory completion cache for the current shell session:

```ts
type CompletionCache = {
  tokenMints: string[];
  stakeAccounts: string[];
  recentValidators: string[];
};
```

Populate it opportunistically when the corresponding read commands run.

Completion data is public metadata only.

Do not cache decrypted secrets.

### Multiple matches

If multiple candidates match:

- show the candidates
- preserve the current input
- allow another TAB after additional characters

Behavior should be familiar to common Unix shells and IPython-style REPLs.

### Completion safety

Tab completion must never:

- decrypt the private key
- prompt for the keystore password
- sign a transaction
- execute a state-changing RPC
- broadcast anything
- read arbitrary filesystem paths based on RPC input

---

## 7.3 Command history and line editing

The interactive shell must support:

- left/right cursor movement
- home/end
- backspace/delete
- up/down command history
- Ctrl-A / Ctrl-E where supported by the terminal
- Ctrl-C to cancel the current input line
- Ctrl-D on an empty line to exit

Use terminal facilities provided by Node/readline.

### Persistent history

Persist command history to:

```text
~/.config/sol-wallet/history
```

with file mode:

```text
0600
```

Do not write commands containing secret prompts because secrets are never entered as part of the command line.

Still apply defensive filtering before persisting history.

Never persist a line containing obvious secret-bearing flags or terms such as:

```text
private-key
secret-key
seed-phrase
mnemonic
password
passphrase
```

even if such unsupported syntax is entered accidentally.

Cap history to a reasonable number such as:

```text
1000 entries
```

---

## 7.4 Help UX

Inside the shell:

```text
help
```

shows top-level command groups.

```text
help token
```

shows:

```text
token list
token balance <mint>
token send <mint> <destination> <amount>
```

```text
help stake create
```

shows arguments, flags, and examples.

Parse errors should suggest the nearest valid command when the match is unambiguous.

Example:

```text
sol-wallet [mainnet]> tokne list
Unknown command: tokne
Did you mean: token?
```

Do not make command autocorrection execute automatically.

---

## 7.5 Optional aliases

Keep aliases minimal.

Allowed built-in aliases:

```text
q     -> quit
cls   -> clear
bal   -> balance
```

Do not add many implicit aliases in v0.1.

Do not allow arbitrary shell aliases or shell command execution.

---

## 7.6 Global/session flags

The outer executable may still accept startup flags:

```bash
sol-wallet --cluster devnet
sol-wallet --rpc-url <url>
sol-wallet --commitment confirmed
```

These establish the initial session context.

For one-shot mode:

```bash
sol-wallet -c "balance" --cluster devnet --json
```

Supported outer flags:

```text
--cluster <mainnet|devnet>
--rpc-url <url>
--commitment <processed|confirmed|finalized>
--json
--dry-run
--yes
--verbose
-c, --command <command>
```

Within the interactive shell, command-local flags such as:

```text
--json
--dry-run
--yes
```

override session defaults for that command only.

Defaults:

```text
cluster: mainnet
commitment: confirmed
```

`--verbose` must still redact secrets.

---

## 8. Configuration

Configuration precedence:

```text
CLI flag
  >
environment / .env
  >
config file
  >
built-in default
```

Supported non-secret environment variables:

```env
SOL_WALLET_CLUSTER=mainnet
SOL_WALLET_RPC_URL=
SOL_WALLET_COMMITMENT=confirmed
SOL_WALLET_CONFIG_DIR=
```

`.env.example` should contain only these non-secret values.

### Forbidden secret configuration

Do not support:

```env
PRIVATE_KEY=
SECRET_KEY=
SEED_PHRASE=
WALLET_PASSWORD=
```

Do not read private keys from environment variables.

Default config directory:

```text
~/.config/sol-wallet/
```

Allow override with:

```text
SOL_WALLET_CONFIG_DIR
```

Files:

```text
~/.config/sol-wallet/
├── config.json
├── keystore.json
└── stake-accounts.json
```

Permissions:

```text
directory: 0700
files containing local wallet metadata: 0600
```

`stake-accounts.json` contains public metadata only and is not secret.

---

## 9. Keystore design

### 9.1 Goals

The keystore must protect the raw private key at rest.

It must:

- use a user-supplied passphrase
- use Argon2id to derive an encryption key
- use AES-256-GCM
- use a random salt
- use a random IV/nonce
- authenticate public keystore metadata as AAD
- be written atomically
- use file mode `0600`
- never log plaintext key bytes
- validate the key before and after storing

### 9.2 File format

Use a versioned JSON format similar to:

```json
{
  "version": 1,
  "kind": "solana-private-key",
  "publicKey": "<base58 address>",
  "kdf": {
    "name": "argon2id",
    "memoryKiB": 65536,
    "iterations": 3,
    "parallelism": 1,
    "salt": "<base64>"
  },
  "cipher": {
    "name": "aes-256-gcm",
    "iv": "<base64>",
    "tag": "<base64>"
  },
  "ciphertext": "<base64>"
}
```

Do not store the passphrase.

Do not store the raw private key outside the encrypted ciphertext.

### 9.3 Argon2id

Start with:

```text
memory: 64 MiB
iterations: 3
parallelism: 1
output: 32 bytes
```

Keep the parameters in the file so they can be upgraded later.

Do not silently weaken parameters on slow machines.

A future `wallet rekey` command can support KDF upgrades; it is not required for v0.1.

### 9.4 AES-GCM AAD

Authenticate at least:

```text
version
kind
publicKey
KDF algorithm + parameters
cipher algorithm
```

Use a deterministic canonical representation for AAD.

Changing metadata should make decryption fail authentication.

### 9.5 Atomic write

Write as:

```text
keystore.json.tmp
fsync
rename -> keystore.json
```

Never partially overwrite the existing keystore.

If `keystore.json` already exists, `wallet import` must refuse unless an explicit future replacement flow is implemented.

---

## 10. Private key import

Command:

```bash
sol-wallet wallet import
```

Do not accept:

```bash
sol-wallet wallet import --private-key ...
```

### Secret input

Use a hidden TTY prompt.

Prompt:

```text
Paste Solana private key:
```

Then prompt twice for a new keystore passphrase:

```text
New keystore passphrase:
Confirm passphrase:
```

### Accepted private-key formats

Support at least:

1. base58 Solana secret key
2. Solana CLI JSON byte-array keypair file, via an explicit file option

Example explicit import:

```bash
sol-wallet wallet import --keypair-file ~/.config/solana/id.json
```

The keypair file is an input only. Do not delete or modify it.

For base58 input, support the canonical forms exposed by the current Solana signing libraries. If both 32-byte seed and 64-byte expanded secret-key forms are supported by the installed API, validate both explicitly rather than guessing.

### Import validation

Before writing anything:

1. decode key
2. construct signer/keypair
3. derive public key
4. display derived address
5. ask user to confirm that this is the expected address
6. encrypt key
7. atomically write keystore
8. decrypt the newly written keystore
9. derive address again
10. require exact match
11. wipe mutable plaintext buffers

If validation after write fails, remove the newly-created invalid keystore and fail loudly.

### Memory handling

JavaScript cannot guarantee perfect secret zeroization because of GC and immutable strings.

Still:

- keep decoded secret material in `Uint8Array` / `Buffer`
- avoid extra copies
- never stringify decoded key bytes
- call `.fill(0)` on mutable key buffers immediately after signing/import
- zero temporary derived encryption-key buffers
- minimize lifetime of passphrase-derived material
- document this limitation in README

---

## 11. Signer boundary

Model the signer API so transaction construction does not directly know keystore details.

Conceptual interface:

```ts
interface WalletSigner {
  readonly address: Address;

  signTransaction(transaction: SignableTransaction): Promise<SignedTransaction>;
}
```

Implementation:

```text
EncryptedKeystoreSigner
```

Flow:

```text
command
  ↓
build transaction
  ↓
request signature
  ↓
prompt for passphrase
  ↓
decrypt key
  ↓
sign in memory
  ↓
wipe key buffer
  ↓
return signed transaction
```

Do not expose a general-purpose:

```ts
getPrivateKey();
```

to command code.

Only the keystore module should decrypt the key.

---

## 12. Solana client / RPC

Use `@solana/kit` and current stable Kit plugins.

Create one client factory that accepts:

```ts
{
  (rpcUrl, cluster, commitment);
}
```

All commands should obtain RPC access through this factory.

Do not scatter RPC URL parsing throughout the codebase.

### RPC requirements

Need at least the equivalent of:

```text
getBalance
getLatestBlockhash
getFeeForMessage
simulateTransaction
sendTransaction
getSignatureStatuses / confirmation
getTransaction
getTokenAccountsByOwner
getAccountInfo
getMinimumBalanceForRentExemption
getStakeMinimumDelegation
getVoteAccounts
getProgramAccounts
getEpochInfo
```

Use the Kit equivalents provided by the installed version.

RPC responses must be validated at the application boundary when external data is converted into application-specific structures.

---

## 13. Amount handling

### SOL

Constants:

```text
1 SOL = 1_000_000_000 lamports
```

Never calculate money with JS `number`.

Parse:

```text
"1.25"
```

into:

```text
1_250_000_000n
```

using string arithmetic.

### Tokens

For token amounts:

1. load mint decimals
2. parse decimal input exactly
3. convert to raw integer units
4. reject excess fractional precision

Example:

```text
USDC decimals = 6

"12.345678"
→ 12_345_678n
```

Reject:

```text
12.3456789
```

Do not round silently.

---

## 14. SOL balance

Command:

```bash
sol-wallet balance
```

Human output:

```text
Address:  <address>
Cluster:  mainnet
Balance:  12.345678901 SOL
Lamports: 12345678901
```

JSON output must use strings for bigint-like monetary values:

```json
{
  "address": "...",
  "cluster": "mainnet",
  "lamports": "12345678901",
  "sol": "12.345678901"
}
```

---

## 15. SOL transfer

Command:

```bash
sol-wallet send <destination> <amount>
```

Required checks:

- validate destination address
- parse amount exactly
- amount > 0
- fetch current balance
- leave enough for network fee
- fetch recent blockhash
- construct System Program transfer
- estimate fee
- simulate
- print summary
- confirm
- sign
- broadcast
- confirm transaction

Human preflight summary:

```text
Action:       Send SOL
From:         ...
To:           ...
Amount:       1.25 SOL
Network fee:  ~0.000005 SOL
Cluster:      mainnet
```

For `--dry-run`:

- construct
- simulate
- print expected effects
- do not broadcast

---

## 16. SPL / Token-2022 support

### Token list

```bash
sol-wallet token list
```

Query both:

- legacy Token Program
- Token-2022 Program

Return:

```text
mint
program
token account
decimals
raw balance
UI balance
```

Do not depend on third-party token-list metadata in v0.1.

Symbol/name/logo lookup is out of scope.

### Token send

```bash
sol-wallet token send <mint> <destination> <amount>
```

Behavior:

1. determine whether mint belongs to Token Program or Token-2022
2. read mint decimals
3. derive sender token account
4. derive destination associated token account
5. create destination ATA if absent and safe to do so
6. use checked transfer instruction where available
7. simulate
8. show:
   - mint
   - raw amount
   - UI amount
   - destination owner
   - destination ATA
   - ATA creation cost if applicable
   - network fee
9. confirm
10. sign and send

Do not support arbitrary Token-2022 extensions unless required for a basic transfer.

If an extension changes transfer semantics and the code does not explicitly support it, refuse with a clear error instead of guessing.

---

## 17. Native staking design

Native staking must use the Solana Stake Program directly.

Do not use:

- liquid staking tokens
- stake pools
- third-party staking APIs for transaction creation

Third-party RPC may be used only as an RPC transport.

### 17.1 Stake create flow

Command:

```bash
sol-wallet stake create 10 --validator <vote-account>
```

The user-facing amount means:

```text
10 SOL of effective stake
```

Therefore calculate:

```text
stakeAccountLamports =
  requestedStakeLamports
  + stakeAccountRentExemptReserve
```

Fetch the reserve dynamically using:

```text
getMinimumBalanceForRentExemption
```

for the canonical current stake-account size.

Do not hardcode the rent-exempt balance.

Also query:

```text
getStakeMinimumDelegation
```

and reject requested effective stake below the network minimum.

### 17.2 Validator validation

Before staking:

1. validate vote account address
2. query `getVoteAccounts`
3. require the vote account to be present
4. distinguish current vs delinquent
5. default to refusing delinquent validators
6. expose commission and activated stake in the confirmation screen

Do not automatically claim one validator is "best".

`validators` is informational; selection remains the user's decision.

### 17.3 Stake account creation strategy

Follow the useful pattern observed in Gem Wallet:

```text
wallet
  ↓
System Program: CreateAccountWithSeed
  ↓
Stake Program: Initialize / checked equivalent
  ↓
Stake Program: DelegateStake
```

Prefer `CreateAccountWithSeed` so the operation does not need a second randomly generated private key for the stake account.

The authority wallet should be both:

```text
staker authority
withdraw authority
```

for v0.1.

No lockup.

### 17.4 Stake-account seed

Generate a deterministic, valid seed derived from transaction-local fresh data, with the same goal as Gem Wallet's blockhash-based approach:

- no second stake-account keypair
- valid System Program seed length
- extremely low collision risk
- reproducible within the transaction build

A suitable initial strategy is to derive the seed from the latest blockhash and constrain it to the System Program seed rules.

Do not assume an arbitrary UTF-8 slice is safe; validate byte length according to the System Program API.

Derive the stake-account address using the official System Program helper/API rather than reimplementing the hash manually.

### 17.5 Instruction construction

Use the current official generated program packages.

Do not manually encode instruction discriminants or Bincode fields if `@solana-program/system` / `@solana-program/stake` provide a typed instruction builder.

Prefer checked instruction variants when the current Stake Program package recommends them.

Expected semantic sequence:

```text
CreateAccountWithSeed
Initialize stake account
Delegate stake
```

All in one atomic transaction when supported.

### 17.6 Preflight display

Before signing:

```text
Action:              Native SOL stake
Wallet:              ...
Validator vote acct: ...
Validator node:      ...
Validator commission: ...%
Effective stake:     10 SOL
Rent reserve:        ... SOL
Total moved:         ... SOL
Network fee:         ... SOL
Stake account:       ...
Cluster:             mainnet
```

Then simulate.

Only broadcast after successful simulation and confirmation.

### 17.7 Local public stake registry

After a successful stake creation, append public metadata to:

```text
stake-accounts.json
```

Example:

```json
{
  "version": 1,
  "accounts": [
    {
      "address": "...",
      "validatorVoteAccount": "...",
      "createdSignature": "...",
      "createdAt": "2026-09-19T00:00:00Z"
    }
  ]
}
```

This file contains no secret material.

---

## 18. Listing stake accounts

Command:

```bash
sol-wallet stake list
```

The command should support both:

1. locally-created stake accounts from `stake-accounts.json`
2. on-chain discovery of stake accounts controlled by this wallet

Do not fetch the entire Stake Program account set and filter it client-side.

Use `getProgramAccounts` with appropriate server-side filters for the canonical stake-account layout.

Important implementation rule:

> Do not guess or copy unexplained hard-coded byte offsets.

If memcmp offsets are needed:

- derive/verify them against the current official Stake Program layout
- define named constants
- cite the upstream source in a code comment
- add fixture tests proving that the filter matches both staker and withdrawer authority as intended

Decode account state using the current official Stake Program types/helpers when available.

For every stake account show at least:

```text
stake account address
lamports
rent reserve
delegated stake
validator vote account
staker authority
withdraw authority
activation/deactivation epoch
state
```

Human-friendly state should be one of approximately:

```text
inactive
activating
active
deactivating
withdrawable
unknown
```

Do not use the deprecated `getStakeActivation` RPC.

Derive state from current account data + epoch information using current supported APIs / stake-program semantics.

---

## 19. Deactivate stake

Command:

```bash
sol-wallet stake deactivate <stake-account>
```

Checks:

- stake account exists
- controlled by this wallet
- wallet is current staker authority
- account is delegated
- account is not already fully inactive
- show validator and amount

Construct native Stake Program deactivate instruction.

Preflight:

```text
Action:        Deactivate stake
Stake account: ...
Validator:      ...
Stake:          ...
```

Explain in output that deactivation is epoch-based and funds may not be immediately withdrawable.

No automatic follow-up transaction or polling daemon in v0.1.

---

## 20. Withdraw stake

Command:

```bash
sol-wallet stake withdraw <stake-account>
```

Default behavior:

- withdraw the maximum currently withdrawable amount back to the wallet

Optional:

```bash
sol-wallet stake withdraw <stake-account> --amount 1.5
```

Checks:

- wallet is withdraw authority
- requested amount is available for withdrawal
- account state permits the requested withdrawal
- do not accidentally leave an invalid non-rent-exempt residual account
- if closing the stake account, make this explicit in the confirmation summary

Destination is the main wallet in v0.1.

No custom withdrawal destination until a later version.

---

## 21. Validator listing

Command:

```bash
sol-wallet validators
```

Source:

```text
getVoteAccounts
```

Display factual fields only:

```text
vote account
node identity
commission
activated stake
last vote / root slot where useful
current or delinquent status
```

Default sorting can be deterministic, for example:

```text
activated stake descending
```

but label the sort clearly.

Do not implement a proprietary "best validator" score in v0.1.

Optional filters:

```bash
--max-commission <percent>
--current-only
--limit <n>
```

These are mechanical filters, not recommendations.

---

## 22. Transaction pipeline

Every state-changing command must go through one common pipeline.

Conceptually:

```text
build
  ↓
summarize
  ↓
estimate fee
  ↓
simulate
  ↓
display result
  ↓
confirm user
  ↓
decrypt/sign
  ↓
broadcast
  ↓
confirm
  ↓
display signature
```

If practical with the installed Kit API, signing may occur before simulation; however:

- never broadcast before explicit confirmation
- private-key lifetime must remain minimal
- do not decrypt twice unnecessarily

### Simulation failure

On simulation failure:

- do not broadcast
- show program error / logs in a concise form
- `--verbose` may show more logs
- redact secrets

### Confirmation

Use blockhash-aware transaction confirmation where supported.

Do not simply sleep for a fixed number of seconds and assume success.

Print explorer-compatible transaction signature text, but do not require or call a third-party explorer API.

---

## 23. `--dry-run`

`--dry-run` means:

- validate inputs
- fetch necessary chain data
- construct transaction
- estimate fees
- simulate
- print transaction summary
- **do not broadcast**

If simulation requires a valid signature with the current API, signing is allowed but the transaction must never be sent.

Prefer not to decrypt/sign during dry-run when simulation can be performed without it.

---

## 24. `--json`

All read commands and write results support machine-readable JSON.

Rules:

- no ANSI color
- monetary integers represented as decimal strings
- addresses represented as strings
- stable field names
- errors to stderr
- successful JSON only to stdout

Example:

```json
{
  "ok": true,
  "signature": "...",
  "slot": "123456789",
  "status": "confirmed"
}
```

This is useful for future agent automation without adding an HTTP server.

---

## 24.1 v0.2 — Jupiter Lend USDC Earn design

The implemented provider-specific command prefix is `jupiter-lend`. Reserve
the generic `lend` command name for a future protocol selector if more lending
providers are integrated.

This section is **future work** and must not block the v0.1 implementation.

### Commands

```bash
sol-wallet jupiter-lend status
sol-wallet jupiter-lend deposit <amount>
sol-wallet jupiter-lend withdraw <amount>
sol-wallet jupiter-lend withdraw --all
```

### Asset restriction

The first implementation supports only canonical Solana mainnet USDC.

Use the canonical mint:

```text
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Treat this as an explicit product decision, not a configurable arbitrary mint in v0.2.

Before every value-moving operation:

- verify cluster is `mainnet`
- verify the configured mint equals the canonical USDC mint
- verify mint owner/program information from chain data
- verify decimals from chain data
- never trust a display symbol such as `USDC` as identity

### Jupiter SDK boundary

Prefer Jupiter's official Lend SDK for:

- position discovery where appropriate
- deposit instruction construction
- withdraw instruction construction

Conceptually the adapter may expose:

```ts
interface JupiterLendAdapter {
  getUsdcPosition(owner: Address): Promise<JupiterLendUsdcPosition>;

  buildDepositInstructions(
    owner: Address,
    amount: bigint,
  ): Promise<ReadonlyArray<WalletInstruction>>;

  buildWithdrawInstructions(
    owner: Address,
    amount: bigint | "max",
  ): Promise<ReadonlyArray<WalletInstruction>>;
}
```

The rest of the wallet must not depend on Jupiter SDK-specific types.

### `jupiter-lend status`

Read-only.

It must not decrypt the private key.

Display at least:

```text
wallet
USDC wallet balance
Jupiter Lend supplied principal / position amount where available
current withdrawable amount
current protocol-reported rate/APY where available
position token / receipt-token balance where relevant
```

Do not present protocol APY as guaranteed future yield.

If Jupiter exposes multiple rate concepts, label them exactly and avoid inventing a single synthetic rate.

### Deposit

```bash
sol-wallet jupiter-lend deposit 100
```

Behavior:

1. parse `100` using USDC's on-chain decimals
2. confirm wallet has sufficient USDC
3. fetch any Jupiter Lend state needed to construct the deposit
4. obtain deposit instructions from the official Jupiter Lend SDK
5. adapt them into the wallet transaction pipeline
6. fetch recent blockhash and fees
7. simulate
8. show a human-readable summary
9. confirm
10. sign with the normal encrypted-keystore signer
11. broadcast
12. confirm
13. refresh and show the resulting lending position

Preflight summary should include approximately:

```text
Action:        Jupiter Lend USDC deposit
Wallet:        ...
Asset:         USDC
Amount:        100 USDC
Protocol:      Jupiter Lend
Cluster:       mainnet
Network fee:   ...
```

If the protocol mints or transfers a receipt/yield-bearing token as part of the position, show that fact in the summary.

### Withdraw

```bash
sol-wallet jupiter-lend withdraw 25
```

or:

```bash
sol-wallet jupiter-lend withdraw --all
```

Behavior:

1. load current lending position
2. determine the maximum protocol-available withdrawal amount
3. ensure requested withdrawal does not exceed what is currently withdrawable
4. obtain withdrawal instructions from the official SDK
5. adapt into the normal transaction pipeline
6. simulate
7. summarize
8. confirm
9. sign
10. broadcast
11. confirm
12. refresh wallet USDC balance and remaining position

Preflight summary:

```text
Action:        Jupiter Lend USDC withdraw
Wallet:        ...
Asset:         USDC
Amount:        ...
Protocol:      Jupiter Lend
Cluster:       mainnet
Network fee:   ...
```

`--all` means the maximum amount the protocol can currently withdraw for this wallet.

Do not implement `--all` as a guessed token balance conversion if the official protocol SDK exposes a more authoritative redemption path.

### Liquidity / protocol-state handling

A lending position may be economically withdrawable in principle while immediate liquidity is temporarily insufficient.

If Jupiter reports that a requested withdrawal cannot currently be completed:

- do not construct misleading output
- do not silently reduce the requested amount
- return a clear error with the requested amount and currently withdrawable amount where available

### Simulation and safety

Jupiter Lend write operations must use the same common transaction safety pipeline as native wallet transactions.

`--yes` may skip only the interactive confirmation.

It must not skip:

- amount validation
- protocol-state validation
- transaction construction checks
- simulation

`--dry-run` must never broadcast.

### No arbitrary Jupiter transaction signing

Do not add a command like:

```bash
sol-wallet jupiter sign <base64-transaction>
```

Do not blindly sign serialized transactions returned by a remote Jupiter endpoint.

Prefer locally constructed transactions composed from explicit instructions generated by the official SDK.

Before signing, the wallet should know and summarize the intended high-level action.

### v0.2 tests

Add unit tests for:

- exact USDC decimal conversion
- canonical USDC mint restriction
- adapter conversion from Jupiter instruction objects to wallet instructions
- deposit transaction summary
- withdraw transaction summary
- `--all` handling
- insufficient USDC balance
- insufficient/temporarily unavailable protocol liquidity
- failed simulation prevents broadcast
- read-only `jupiter-lend status` never decrypts the key

Add opt-in integration tests using the safest practical environment supported by the current Jupiter tooling.

Automated tests must not deposit real mainnet funds.

If Jupiter Lend cannot be meaningfully tested outside mainnet, keep integration tests read-only and require manual tiny-value mainnet smoke testing.

---

## 25. Security requirements

These are hard requirements.

### Never

- log private key
- print private key after import
- store private key unencrypted
- place private key in `.env`
- place private key in config JSON
- accept private key as command-line argument
- accept keystore password as command-line argument
- send key material to RPC
- send key material to analytics
- automatically sign arbitrary externally supplied transactions
- use `eval`
- execute shell commands assembled from RPC/user data
- silently switch RPC cluster
- silently fall back from mainnet to devnet or vice versa

### Logging redaction

A central logger should redact fields named similarly to:

```text
privateKey
secretKey
seed
mnemonic
password
passphrase
ciphertext plaintext
```

Avoid logging whole arbitrary objects from wallet modules.

### Dependency policy

Before adding a dependency, prefer in order:

1. Node standard library
2. official Solana / Anza package
3. small, actively maintained package with a clear purpose

Avoid packages that duplicate major wallet functionality.

Do not run postinstall scripts unless the dependency actually requires them and it has been reviewed.

Commit lockfile.

### RPC trust model

RPC is untrusted input.

Treat RPC responses as potentially:

- malformed
- stale
- inconsistent
- malicious

Do not let RPC responses influence filesystem paths, shell commands, or secret handling.

Simulation success is not a cryptographic guarantee of future execution.

---

## 26. UX safety for mainnet

For mainnet state-changing commands, confirmation should look approximately like:

```text
You are about to submit a MAINNET transaction.

Action: ...
Wallet: ...
Amount: ...
Fee: ...
Destination / validator: ...

Proceed? [y/N]
```

Default is `N`.

`--yes` bypasses the interactive confirmation but **not** validation or simulation.

Do not create a `--force` flag that bypasses core safety checks in v0.1.

---

## 27. Error model

Define typed application errors, for example:

```text
ConfigError
KeystoreError
InvalidPrivateKeyError
InvalidAddressError
InsufficientBalanceError
RpcError
SimulationError
TransactionRejectedError
ConfirmationError
UnsupportedTokenExtensionError
StakeAccountError
ValidatorError
```

CLI exit codes:

```text
0 success
1 general failure
2 invalid user input
3 RPC/network error
4 transaction simulation failure
5 transaction submitted but confirmation uncertain
```

If a transaction was submitted but confirmation timed out, clearly print the signature so the user can query it later.

Never retry a value-moving transaction blindly after an ambiguous send result.

---

## 28. Tests

### Unit tests

Must cover:

#### Amount parsing

- SOL decimal → lamports
- token decimal → raw units
- reject excessive precision
- reject negative numbers
- reject scientific notation unless intentionally supported
- large bigint values

#### Keystore

- import + encrypt + decrypt
- wrong passphrase
- corrupted ciphertext
- corrupted auth tag
- modified authenticated metadata
- atomic write behavior
- file mode where test platform supports it
- public address after decrypt matches metadata

#### Private key

- valid base58 key
- invalid base58
- invalid key length
- valid Solana CLI JSON keypair
- invalid JSON keypair

#### Transactions

- SOL transfer summary
- transaction cannot broadcast on failed simulation
- `--dry-run` never broadcasts
- `--yes` does not skip validation

#### Staking

- deterministic stake-account derivation for a fixed input
- stake amount adds dynamic rent reserve
- below-minimum delegation rejected
- stake create has expected semantic instruction sequence:
  - create account with seed
  - initialize
  - delegate
- main wallet is stake + withdraw authority
- deactivate targets correct stake account
- withdraw destination is main wallet
- delinquent validator rejected by default

#### Interactive shell

- top-level command completion
- nested command completion
- flag completion
- token-mint completion from session cache
- stake-account completion from session cache
- completion never invokes signer/decryption
- `-c` uses exactly the same command parser as the REPL
- history persistence
- history secret-pattern filtering
- Ctrl-C cancels input without exiting the process where supported by the test harness
- unknown-command suggestion does not auto-execute

### Integration tests

Integration tests must be opt-in:

```bash
RUN_SOLANA_INTEGRATION=1 npm test
```

Prefer:

1. LiteSVM / in-memory test environment
2. local validator
3. devnet

Never use mainnet for automated write tests.

CI must never require a real private key.

---

## 29. Test fixtures

Test keys must be obviously disposable and contain no funds.

Put test-only key material under:

```text
test/fixtures/
```

Add comments clearly marking them as public test fixtures.

Never load developer machine keys from:

```text
~/.config/solana/
```

during ordinary tests.

---

## 29.1 Docker image end-to-end tests

Docker image E2E tests are a **hard v0.1 requirement**.

Unit tests and source-level integration tests are not enough.

The CI must prove that the exact image intended for release:

```text
1. builds
2. starts
3. provides the interactive shell
4. persists wallet state across disposable containers
5. supports tab completion and line editing through a real TTY
6. supports one-shot `-c` mode
7. correctly connects to an RPC endpoint
8. follows the designed transaction safety pipeline
```

### Test the image, not the source tree

After the image is built, E2E tests must invoke:

```bash
docker run ...
```

against the built image tag.

Do not run:

```bash
npm run dev
tsx src/cli.ts
node dist/cli.js
```

as a substitute for Docker E2E.

The E2E test suite should receive an image reference such as:

```text
SOL_WALLET_E2E_IMAGE=sol-wallet:e2e
```

and every test must execute that image.

### Deterministic E2E environment

Normal CI E2E must not depend on:

- mainnet
- devnet uptime
- real user funds
- real user keys
- third-party RPC availability

Provide a deterministic mock/local RPC test service for the subset of Solana RPC used by the E2E scenarios.

The preferred structure is:

```text
E2E test runner
   │
   ├── mock/local Solana RPC
   │
   └── built sol-wallet Docker image
```

The wallet container should receive the RPC URL through normal supported configuration, for example:

```text
SOL_WALLET_RPC_URL=http://mock-rpc:8899
SOL_WALLET_CLUSTER=devnet
```

The mock/local RPC must return realistic Solana-shaped responses.

Do not add test-only branches to production command handlers such as:

```ts
if (process.env.E2E_TEST) {
  // fake wallet behavior
}
```

Production code must behave exactly as it does outside tests.

### TTY / REPL E2E harness

The interactive shell must be tested through a real pseudo-terminal.

A suitable implementation is:

```text
Python + pexpect
```

or another small PTY harness.

The test should launch approximately:

```bash
docker run --rm -it ...
```

and interact with the process as a user would.

Do not validate the REPL only by piping newline-delimited stdin without a TTY, because that does not test:

- readline behavior
- hidden secret prompts
- Tab completion
- prompt rendering
- Ctrl-C
- Ctrl-D

### Required Docker REPL E2E scenarios

At minimum implement these scenarios.

#### E2E 1 — image boots into shell

Launch the image with an empty temporary config directory.

Assert that a prompt appears similar to:

```text
sol-wallet [devnet no-wallet]>
```

Run:

```text
help
```

Assert the expected top-level commands are shown.

Run:

```text
exit
```

Assert clean exit code `0`.

#### E2E 2 — command and nested Tab completion

With a PTY:

Type:

```text
tok<TAB>
```

Assert it completes to or clearly offers:

```text
token
```

Then:

```text
token <TAB>
```

Assert suggestions include:

```text
list
balance
send
```

Also test at least:

```text
stake <TAB>
```

and verify:

```text
create
list
deactivate
withdraw
```

This test must exercise the real readline completer inside the Docker image.

#### E2E 3 — wallet import + encrypted persistence

Use a **publicly committed disposable test key fixture only**.

Do not use a developer wallet.

Inside the shell:

```text
wallet import
```

Drive the hidden prompt through the PTY.

Provide:

- disposable test private key
- disposable test keystore passphrase
- address confirmation

Assert:

- import succeeds
- expected address is shown
- `keystore.json` exists in the host-mounted temporary config directory
- plaintext private key is not present in `keystore.json`
- plaintext passphrase is not present in `keystore.json`

Stop the container.

Start a **new** container using the same temporary host directory.

Run:

```text
address
```

Assert it returns the same address without re-import.

This proves persistence across disposable containers.

#### E2E 4 — history persistence

In one container execute harmless commands such as:

```text
help
address
show config
```

Exit.

Start another container using the same mounted config directory.

Verify the history file persisted.

Also verify that deliberately typed unsupported secret-looking command text is filtered according to the history-security rules.

#### E2E 5 — one-shot mode

Run the built image non-interactively:

```bash
docker run --rm ... IMAGE -c "address" --json
```

Assert:

- exit code `0`
- stdout is valid JSON
- returned address matches imported fixture wallet
- stderr contains no secret

Then:

```bash
docker run --rm ... IMAGE -c "show config" --json
```

Assert the configured cluster and RPC URL are represented correctly according to the public-output schema.

#### E2E 6 — read-only RPC path

Using the deterministic mock/local RPC, run:

```text
balance
```

and:

```text
token list
```

Assert expected fixture balances are displayed.

This proves:

```text
Docker networking
→ config
→ @solana/kit RPC
→ decoding
→ command handler
→ output layer
```

works end to end.

#### E2E 7 — write-path dry run

Using the disposable fixture wallet and deterministic RPC service, execute:

```text
send <fixture-destination> 1 --dry-run
```

The mock/local RPC must support enough behavior for:

```text
latest blockhash
fee calculation
transaction simulation
```

Assert:

- transaction is constructed
- simulation is called
- expected summary is displayed
- no broadcast RPC is called
- command reports dry-run success

This must verify the **real Docker image transaction pipeline**.

#### E2E 8 — simulation failure blocks send

Configure the deterministic RPC fixture to return a simulation error.

Execute a state-changing command.

Assert:

- CLI reports simulation failure
- `sendTransaction` is never called
- process returns the documented simulation-failure exit code in one-shot mode

#### E2E 9 — keystore unlock during signing

For a dry-run or local non-value fixture transaction that requires signing:

- trigger the real passphrase prompt
- provide the test passphrase through PTY
- verify signing succeeds
- verify the passphrase and private key never appear in stdout/stderr

This verifies the Docker image contains all required native crypto dependencies, including Argon2 support.

### Optional deeper E2E

If practical, add local-validator/LiteSVM-based scenarios for:

```text
SOL transfer
stake create
stake deactivate
stake withdraw
basic token transfer
```

These are valuable but should not make ordinary CI dependent on a public network.

### E2E test artifacts on failure

On CI failure, preserve only non-secret diagnostics such as:

- container logs after redaction
- mock RPC request log
- exit code
- test name
- Docker image digest

Do not upload:

- keystore plaintext
- passphrases
- private keys other than explicitly public disposable fixture keys
- arbitrary mounted config directories

---

## 29.2 GitHub Actions release workflow

Add:

```text
.github/workflows/docker.yml
```

The workflow must target only:

```text
linux/amd64
```

Do not configure multi-platform Buildx output for v0.1.

### Pull requests

For pull requests:

```text
checkout
  ↓
npm/source tests
  ↓
docker build --platform linux/amd64
  ↓
tag locally as sol-wallet:e2e
  ↓
run Docker E2E suite
```

Do not push images from untrusted pull-request contexts.

### Main branch / release tags

For trusted pushes to `main` and version tags:

```text
checkout
  ↓
source tests
  ↓
docker build --platform linux/amd64
  ↓
Docker E2E against the exact built image
  ↓
only if every E2E test passes:
      authenticate to GHCR
      push image
```

**Never push first and test later.**

The image that passes E2E must be the same image content that is pushed.

Prefer using a content-addressed image ID/digest or a single Buildx build flow that guarantees the tested artifact and pushed artifact are identical.

### GHCR tags

For a trusted branch push:

```text
ghcr.io/<owner>/sol-wallet:latest
ghcr.io/<owner>/sol-wallet:<branch>
ghcr.io/<owner>/sol-wallet:<shortsha>
```

For version tags:

```text
ghcr.io/<owner>/sol-wallet:v0.1.0
ghcr.io/<owner>/sol-wallet:0.1.0
ghcr.io/<owner>/sol-wallet:0.1
ghcr.io/<owner>/sol-wallet:latest
```

Do not publish `linux/arm64` in v0.1.

### Required CI gate

GHCR publication must be impossible unless:

```text
unit tests
integration tests
Docker build
Docker E2E
```

all pass.

Docker E2E is a release gate, not an informational job.

---

## 30. README requirements

README should contain:

### Installation / release image

Document the official v0.1 install path as GHCR:

```bash
docker pull ghcr.io/<owner>/sol-wallet:latest
```

Interactive use:

```bash
docker run --rm -it \
  -v "$HOME/.config/sol-wallet:/home/solwallet/.config/sol-wallet" \
  ghcr.io/<owner>/sol-wallet:latest
```

Also document the optional `scripts/sol-wallet` host wrapper.

For local development only:

```bash
npm install
npm test
npm run build
```

### Setup

```bash
sol-wallet
```

Then inside the wallet shell:

```text
wallet import
address
balance
```

### Devnet example

```bash
sol-wallet --cluster devnet
```

Then:

```text
balance
```

### Staking example

Inside the wallet shell:

```text
validators --limit 20
stake create 1 --validator <vote-account>
stake list
```

### Non-interactive automation example

```bash
sol-wallet -c "balance" --json
sol-wallet -c "stake list" --json
```

### Security notes

Explicitly state:

- this is personal wallet software
- JavaScript cannot guarantee perfect in-memory key zeroization
- keep a separate secure backup of the original key
- losing the keystore passphrase can make the encrypted local key unusable
- RPC providers can observe addresses and network requests
- native staking is not liquid staking
- unstaking is not necessarily immediately withdrawable

Do not put real addresses or private keys in README examples.

---

## 31. Implementation phases

Codex should implement in this order.

### Phase 1 — scaffold

- package setup
- TypeScript strict config
- CLI entrypoint
- interactive REPL
- shared command parser
- command history
- context-aware tab completion
- contextual help
- `-c` / `--command` one-shot execution using the same parser
- config loader
- RPC client factory
- output abstraction
- tests running

### Phase 2 — keystore

- hidden secret prompt
- private-key decoding
- address derivation
- Argon2id
- AES-256-GCM
- atomic file write
- signer abstraction
- keystore tests

Do not proceed to value-moving transactions until keystore tests are solid.

### Phase 3 — read-only wallet

- `address`
- `balance`
- `token list`
- `token balance`
- `validators`

### Phase 4 — SOL transfers

- amount parser
- transaction builder
- simulation pipeline
- confirmation prompt
- send
- confirmation
- `--dry-run`
- `--json`

### Phase 5 — native staking

- minimum delegation query
- rent reserve query
- validator validation
- create-with-seed stake account
- initialize
- delegate
- local stake registry
- stake list
- deactivate
- withdraw

### Phase 6 — tokens

- mint decoding
- associated token account handling
- legacy Token Program transfer
- Token-2022 basic transfer
- refuse unsupported extensions

### Phase 7 — Docker packaging and end-to-end validation

- production multi-stage Dockerfile
- `.dockerignore`
- linux/amd64 only
- host wrapper script
- deterministic mock/local RPC fixture
- PTY-based Docker REPL E2E tests
- persistence-across-container tests
- one-shot `-c` Docker E2E tests
- write-path dry-run E2E
- simulation-failure safety E2E
- GitHub Actions workflow
- GHCR publish gate only after Docker E2E passes

### Phase 8 — hardening

- error cleanup
- redaction review
- dependency review
- integration tests
- Docker image security review
- README
- mainnet manual smoke test with a tiny disposable balance

### Phase 9 — v0.2 Jupiter Lend USDC Earn

Start this phase only after v0.1 is complete.

- add isolated Jupiter Lend integration adapter
- verify current official Jupiter Lend SDK APIs
- `jupiter-lend status`
- USDC deposit
- USDC withdraw
- `withdraw --all`
- simulation + confirmation through the common transaction pipeline
- adapter/unit tests
- read-only integration tests where possible
- tiny manual mainnet smoke test only after code review

---

## 32. Definition of done for v0.1

- the release Docker image builds successfully for `linux/amd64`
- no `linux/arm64`, macOS, or Windows release artifact is required
- the exact Docker image intended for GHCR passes PTY-based E2E tests
- Docker E2E proves the image opens the interactive shell
- Docker E2E proves Tab completion works inside a real TTY
- Docker E2E proves wallet import creates an encrypted host-persisted keystore
- Docker E2E proves wallet state survives deletion/recreation of the container
- Docker E2E proves `-c` one-shot mode works
- Docker E2E proves read-only RPC commands work through the configured RPC endpoint
- Docker E2E proves a write-path `--dry-run` simulates but never broadcasts
- Docker E2E proves simulation failure prevents broadcast
- Docker E2E proves signing/unlock works with the packaged Argon2/native dependencies
- GitHub Actions does not push the image to GHCR until Docker E2E passes
- the image tested by E2E is content-identical to the image pushed to GHCR

v0.1 is complete when all of the following are true:

- `npm test` passes without network access for unit tests
- running `sol-wallet` opens the interactive wallet shell
- interactive shell supports history and context-aware tab completion
- `sol-wallet -c "..."` uses the same parser and command handlers as the shell
- no production command requires `@solana/web3.js` v1
- a private key can be imported without appearing in shell history
- keystore file is encrypted and mode `0600`
- wrong password cannot decrypt it
- `address` and balance commands never decrypt the private key
- SOL can be sent on devnet
- SPL token balances can be read
- basic token transfer works on devnet
- validators can be listed
- native stake account can be created and delegated on devnet
- stake account can be deactivated
- inactive stake can be withdrawn
- every write operation supports `--dry-run`
- failed simulation prevents broadcast
- mainnet writes require confirmation unless `--yes`
- no real private key exists in tests, repository, logs, fixtures, or `.env`
- README documents limitations

---

## 33. Important implementation notes from Gem Wallet review

The Gem Wallet implementation was useful as a reference for two ideas.

### Keystore boundary

Gem's current design keeps an encrypted private-key file and performs routine signing behind the keystore boundary instead of passing raw private keys throughout UI code.

This project should preserve the same architectural idea:

```text
commands
  ↓
signer abstraction
  ↓
keystore decrypts internally
  ↓
sign
  ↓
wipe mutable secret buffers
```

Do not let each command load/decrypt the raw key itself.

### Native staking

Gem creates a stake account using a deterministic seed and then performs:

```text
CreateAccountWithSeed
Initialize
Delegate
```

This avoids managing a second long-lived private key for the stake account.

Use the same high-level design, but in TypeScript prefer the official generated Solana program clients rather than manually encoding instruction bytes.

---

## 34. Current upstream assumptions

At the time this spec was written (2026-09-19):

- Solana recommends `@solana/kit` for new TypeScript applications.
- legacy `@solana/web3.js` v1 remains available but is not the preferred starting point for new code.
- an official generated JavaScript client exists as `@solana-program/stake`.
- Solana RPC exposes `getStakeMinimumDelegation`.
- Solana RPC exposes `getMinimumBalanceForRentExemption`.
- Solana RPC exposes `getVoteAccounts`.
- `getStakeActivation` is deprecated and should not be used.

Codex should verify installed upstream APIs while implementing because these packages change quickly.

---

## 34.1 Release boundary

Codex should treat the releases as two separate milestones.

### v0.1 — core wallet

Ship only after the v0.1 Definition of Done is satisfied.

Includes:

```text
interactive wallet shell with history + contextual tab completion
encrypted Solana private-key wallet
SOL balance + send
SPL / Token-2022 balance + basic send
validator listing
native SOL staking
transaction inspection
simulation / confirmation pipeline
non-interactive `-c` mode for automation
```

Does not include Jupiter Lend.

### v0.2 — Jupiter Lend USDC Earn

Begin only after v0.1 is stable.

Includes only:

```text
jupiter-lend status
USDC deposit
USDC withdraw
USDC withdraw --all
```

Do not allow v0.2 SDK compatibility work to destabilize or redesign the v0.1 wallet core.

---

## 35. Final guidance to Codex

Docker E2E is mandatory.

Do not consider v0.1 finished merely because:

```text
TypeScript compiles
unit tests pass
integration tests pass
Docker image builds
```

v0.1 is not finished until the built `linux/amd64` image itself is exercised through the E2E suite and behaves like the designed wallet.

For release CI:

```text
build image
→ test that exact image
→ only then push to GHCR
```

Optimize for:

```text
small
auditable
boring
typed
tested
explicit
```

Do not expand scope just because an SDK makes another feature easy.

When there is a choice between:

```text
more abstraction
```

and:

```text
clear Solana-specific code
```

prefer the clear Solana-specific code.

When handling value-moving operations:

```text
validate
→ build
→ summarize
→ simulate
→ confirm
→ sign
→ send
→ confirm
```

When handling secrets:

```text
read as late as possible
→ keep in memory for as little time as possible
→ never log
→ wipe mutable buffers
```

---

## Part II: Multiple-wallet product design

Status: product direction accepted and implemented in this checkout.
Read the [implementation specification](#part-iii-multiple-wallet-implementation-contract) for
exact schemas, edge cases, recovery rules, code changes, and acceptance tests.
That document resolves implementation details left open in this overview.

## Goal and pre-v0.3 baseline

Support several named wallets, make the current signing identity obvious, and
keep existing SOL, token, staking, and Jupiter Lend commands consistent.

Before v0.3, `configDir/keystore.json` is the only wallet. Import rejects a second key;
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
| `wallet delete <alias> [--yes]`                 | Confirm local removal; never changes chain state. `--yes` skips confirmation.       |
| `wallet change-passphrase <alias>`              | Hidden old/new passphrase prompts; re-encrypt the existing key atomically.          |
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
switching, renaming, deleting, and viewing status do not require a passphrase.
Passphrase rotation verifies the old passphrase and re-encrypts the same private
key; it does not rotate the Solana address.

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
identity-aware output, completion, migration, safe local deletion and passphrase
rotation, and isolation of existing features.

Defer wallet creation/seed phrases, hardware wallets, address-book recipient
aliases, portfolio aggregation, and protocol additions. Local wallet removal
was deferred in the initial design and is now specified by the reviewed
deletion contract in Part III.

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

---

## Part III: Multiple-wallet implementation contract

Status: implementation contract used for v0.3 work; see root `PLAN.md` and
current code/tests for implementation and validation state.
Read [the product design](#part-ii-multiple-wallet-product-design) first. This document resolves
its implementation choices. For v0.3 wallet behavior, this document takes
precedence over the older single-wallet requirements in [Part I](#part-i-original-product-specification).
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
| `wallet delete <alias> [--yes]`                 | Exactly one alias; confirmed local removal, `--yes` skips confirmation. Never changes chain state.                             |
| `wallet change-passphrase <alias>`              | Exactly one alias; hidden old/new prompts and atomic re-encryption of the same key.                                            |
| `wallet migrate <alias>`                        | Exactly one; migrate old single keystore as described below.                                                                   |
| `wallet recover <uuid> <alias>`                 | Exactly two; register an existing unregistered UUID keystore after verification.                                               |
| `status`                                        | No arguments; local context only, no balance/health RPC calls.                                                                 |

`wallet recover` is the narrowly scoped recovery command needed for interrupted
imports and registry loss. It does not accept external paths or plaintext keys.
Local wallet deletion is limited to the explicit per-alias command below; there
is no broad reset or force-delete operation.

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

### Passphrase rotation

`wallet change-passphrase <alias>` asks privately for the existing passphrase,
then asks for a non-empty replacement twice. Never accept a passphrase through
arguments, environment variables, JSON, logs, or history. Validate the existing
decryption and derived address, encrypt with fresh salt/nonce, and verify a new
decrypt-and-derive round trip before touching the active file. Do not hold the
store lock while prompting or running Argon2. Under the lock, verify that the
same UUID/alias/address is still registered and that the keystore bytes still
match the original snapshot. Write a mode-0600 temporary file in `wallets/`,
validate it, atomically rename it over that exact UUID file, and sync the
directory. A pre-rename failure preserves the old file. A post-rename sync
failure is reported as uncertain; do not roll back a potentially committed
replacement. Existing backups, including the retained legacy migration copy,
are not re-encrypted and keep the old passphrase.

### Local wallet deletion

`wallet delete <alias>` shows the full address and requires an interactive
default-no confirmation. Without a TTY, require explicit `--yes`. Reject
deleting the saved default while any other wallet remains and tell the user to
set a replacement first; deleting the last wallet sets the registry to its
valid empty state. If the deleted wallet was current, clear that process's
selection instead of choosing another wallet. Do not require the passphrase to
delete an encrypted file.

Deletion makes no RPC request and removes no on-chain SOL, tokens, stake, or
lending positions. It removes the active registry entry, then unlinks only the
managed UUID keystore while holding the store lock. Registry removal is the
logical commit. If unlink fails, report partial completion and leave the
remaining UUID file visible to `wallet list`; never silently re-register or
recursively remove unrelated data. Preserve separate legacy backups and
wallet-scoped stake recovery hints. Explain that unlinking is not secure
erasure. A user must retain their original key or another backup if they may
need to control chain assets later.

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

> Implement v0.3 using the multiple-wallet sections of specs/spec.md. Follow AGENTS.md, inspect current
> state first, and maintain PLAN.md. Complete the required acceptance scenarios
> and documentation. Do not expand deferred scope or weaken security checks.
> Report validation accurately and leave publishing to a separate request.
