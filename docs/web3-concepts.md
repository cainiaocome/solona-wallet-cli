# Web3 and Solana concepts in plain language

This is a small glossary tied to the code in this repository. The goal is not
to teach every part of Solana; it is to explain the words that appear in the
CLI and source code.

## Blockchain and programs

A blockchain is a shared, append-only history maintained by a network of
machines. Solana calls its executable on-chain components **programs**. Other
blockchains often call the same idea smart contracts.

A Solana transaction contains one or more instructions. Each instruction says
which program should run, which accounts it may read or write, and the binary
data for that program. The System Program handles native SOL operations. The
SPL Token Program handles fungible token balances. The Stake Program handles
native stake accounts. Jupiter Lend has its own program and official SDK.

The CLI never invents a generic “send transaction” format. It builds typed
instructions, compiles them into a transaction message, simulates that
message, and only then signs and broadcasts it.

## Public and private keys

A wallet is a key pair:

- The **private key** proves control. Anyone with it can usually sign transfers
  and spend the wallet's assets.
- The **public key** is the wallet's public identity on Solana. It is displayed
  as a base58 address and is safe to share when you want someone to pay you.

The private key is not a password. A password can be changed; a private key
defines the wallet address and cannot be rotated by changing the keystore
passphrase. This project encrypts the private key locally with a passphrase,
but it does not create a backup or recovery phrase.

The keystore passphrase unlocks the local encrypted file. It does not change
the blockchain wallet and it is never sent to an RPC provider.

## Address

An address is a base58 representation of a public key or a program-derived
account. `address` prints the imported wallet address. Many other addresses
you see are not people:

- a token mint address identifies a token definition;
- a token account address stores one owner's balance for one mint;
- a stake account address stores native stake state;
- a program address identifies executable on-chain logic.

Do not send funds to an address just because its text looks valid. The CLI
checks syntax, but it cannot know whether the destination belongs to the
intended person.

## SOL, lamports, and fees

SOL is Solana's native currency. The chain stores SOL as **lamports**:

```text
1 SOL = 1,000,000,000 lamports
```

Fees are paid in SOL, so a wallet needs enough SOL for both the amount being
sent and the transaction fee. Source code keeps amounts as `bigint` integers;
it never performs money calculations with floating-point numbers. This avoids
rounding errors.

The same idea applies to tokens, but each token chooses its own decimal count.
USDC uses six decimals, so:

```text
1 USDC = 1,000,000 base units
```

The CLI accepts human strings such as `1.25`, converts them to base units, and
rejects excess precision rather than silently rounding.

## SPL tokens, mints, and token accounts

An SPL token is not stored directly in the wallet address. Instead:

1. A **mint account** describes the token: its address, decimals, authority,
   and supply-related state.
2. A **token account** stores one owner's balance for that mint.
3. An owner can have token accounts for many mints.

The associated token account (ATA) is the conventional deterministic token
account for an owner/mint pair. A transfer may need the recipient's ATA to
exist first. This project uses an idempotent ATA-create instruction where
appropriate: it succeeds whether the ATA is absent or already present.

Solana has the original SPL Token Program and Token-2022. They are different
programs, so the CLI queries both. Basic Token-2022 transfers are supported,
but mints with extensions are rejected because extensions can change transfer
semantics and need explicit handling.

## RPC and commitment

The CLI talks to a Solana node through JSON-RPC. The default public URLs are:

```text
mainnet-beta: https://api.mainnet-beta.solana.com
devnet:      https://api.devnet.solana.com
```

Public RPC endpoints are shared services. They can rate-limit, fail, lag, or
return errors. They also see your requests and queried addresses. You can
configure a different URL with `--rpc-url`, `SOL_WALLET_RPC_URL`, or
`set rpc-url`.

**Commitment** describes how much the node should trust a result:

- `processed`: the node processed the block, but it is the least final.
- `confirmed`: the cluster has voted on the block; this is the default.
- `finalized`: the cluster considers the block finalized; it is slower but
  strongest for ordinary reads.

Commitment is not a magic guarantee that a provider is honest or available.
It is a confirmation level used by the node.

## Transaction lifecycle

For a write command, the important sequence is:

```text
human amount
  -> base-unit integer
  -> instructions
  -> transaction message with fee payer and recent blockhash
  -> simulation
  -> user confirmation
  -> private-key signature
  -> broadcast
  -> confirmation polling
```

The **fee payer** normally pays the network fee. In this wallet it is the
imported wallet. A **recent blockhash** makes a transaction expire after a
limited period; this prevents an old signed transaction from being replayed
indefinitely.

The signature is the transaction identifier, not the private key. Save it if a
command reports a timeout. The transaction may still confirm after the CLI
stops waiting.

## Signing and simulation

Simulation executes the transaction against the node's current state without
committing it. It catches many problems: missing accounts, insufficient SOL,
invalid token ownership, and program errors. It cannot freeze the state, and
it is not a promise that a later broadcast will succeed.

The CLI unlocks the keystore only at the signer boundary after validation,
simulation, and (unless `--yes`) confirmation. The key is used to sign in
memory and is wiped where practical. JavaScript garbage collection means this
is a best effort, not a hardware-security guarantee.

## Staking

Native staking delegates SOL to a validator through a separate stake account.
It is not the same thing as liquid staking or lending:

- a validator votes on blocks and charges a commission;
- the stake account records authorities, delegated amount, and activation
  state;
- deactivation is epoch-based, so stake is not immediately withdrawable;
- withdrawing stake returns native SOL once the account is inactive and the
  other checks pass.

`stake create` creates and delegates a new stake account. `stake deactivate`
requests deactivation. `stake withdraw` moves inactive stake back to the
wallet. The wallet does not automatically choose a validator.

## Jupiter Lend Earn

Jupiter Lend Earn is a protocol integration, not a special wallet balance.
When USDC is deposited, the protocol tracks a supplied position and gives the
wallet receipt-token shares that represent the position. The value of shares
can change with protocol accounting and rates.

In v0.2 this CLI supports only canonical mainnet USDC and only:

```text
lend status
lend deposit <amount>
lend withdraw <amount>
lend withdraw --all
```

`withdraw --all` means the maximum currently available amount, bounded by both
the wallet's supplied position and protocol liquidity. If the complete
position is available, the CLI redeems the exact receipt-share balance to
avoid leaving conversion dust. See [jupiter-lend.md](jupiter-lend.md) for the
full safety boundary and dependency notes.

## Mainnet, devnet, and addresses

The same public address can exist on every Solana cluster, but each cluster
has independent state. A devnet SOL balance is not mainnet SOL. A transaction
signature is meaningful on the cluster where it was submitted, so always
record the cluster with a signature.

## Glossary quick reference

| Term          | Meaning in this project                                          |
| ------------- | ---------------------------------------------------------------- |
| Address       | Base58 public identity of a wallet, account, mint, or program    |
| ATA           | Deterministic associated token account for an owner and mint     |
| Base units    | Integer representation stored by the chain, such as lamports     |
| Blockhash     | Recent transaction lifetime marker                               |
| Commitment    | RPC read/confirmation strength                                   |
| Instruction   | One request for one Solana program to execute                    |
| Lamport       | One-billionth of one SOL                                         |
| Mint          | On-chain definition of an SPL token                              |
| RPC           | Network API used to read data, simulate, and submit transactions |
| Signer        | Component that produces cryptographic transaction signatures     |
| Token account | Account holding one owner's balance for one mint                 |
| Transaction   | Compiled message containing instructions and signatures          |
