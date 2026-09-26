# Solana Wallet CLI — `spec.md`

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
- devnet and mainnet-beta
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

- mainnet-beta only
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
Cluster: mainnet-beta
Type `help` for commands.

sol-wallet [mainnet-beta]>
```

Example session:

```text
sol-wallet [mainnet-beta]> balance
12.345678901 SOL

sol-wallet [mainnet-beta]> token list
USDC   EPjF...Dt1v   1,250.42
...

sol-wallet [mainnet-beta]> token balance EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
1,250.42 USDC

sol-wallet [mainnet-beta]> stake list
...

sol-wallet [mainnet-beta]> exit
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
set cluster <mainnet-beta|devnet>
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
sol-wallet [mainnet-beta]>
```

If practical, include a shortened wallet address:

```text
sol-wallet [mainnet-beta 7abc…xyz]>
```

Do not include:

- private-key material
- secret-key fingerprint
- encrypted ciphertext
- token balances that require an RPC request on every prompt render

Prompt rendering should be instant and offline.

If the shell has no imported wallet yet:

```text
sol-wallet [mainnet-beta no-wallet]>
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
sol-wallet [mainnet-beta]> tokne list
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
--cluster <mainnet-beta|devnet>
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
cluster: mainnet-beta
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
SOL_WALLET_CLUSTER=mainnet-beta
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
Cluster:  mainnet-beta
Balance:  12.345678901 SOL
Lamports: 12345678901
```

JSON output must use strings for bigint-like monetary values:

```json
{
  "address": "...",
  "cluster": "mainnet-beta",
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
Cluster:      mainnet-beta
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
Cluster:             mainnet-beta
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

- verify cluster is `mainnet-beta`
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
Cluster:       mainnet-beta
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
Cluster:       mainnet-beta
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
