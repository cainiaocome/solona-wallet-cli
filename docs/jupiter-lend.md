# Jupiter Lend Earn integration

This document describes the v0.2 Jupiter Lend scope and the operational boundary around it. It is intentionally narrower than a general lending client.

## Supported surface

The wallet supports only these commands:

```text
lend status
lend deposit <amount>
lend withdraw <amount>
lend withdraw --all
```

The asset is hard-coded to canonical mainnet Solana USDC:

```text
EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

Before every operation the adapter requires `mainnet-beta`, verifies the mint is owned by the legacy SPL Token Program, and verifies six decimals. A display symbol or user-selected mint is never used as the asset identity. Borrowing, collateral, leverage, liquidation, arbitrary assets, and arbitrary Jupiter transaction signing are not implemented.

## SDK boundary

The checked-in versions are `@jup-ag/lend@0.0.108` and `@jup-ag/lend-read@0.0.14`. The write package's current npm `latest` tag is a beta line, so v0.2 pins the latest non-prerelease SDK line rather than introducing a beta dependency. The write SDK supplies Earn `getDepositIx` and `getWithdrawIx`; the read SDK supplies the current position, receipt shares, protocol-reported rates, and the protocol's current withdrawable amount.

The SDK line uses legacy `@solana/web3.js` and `bn.js` types. Those imports are confined to `src/integrations/jupiter-lend/adapter.ts`. The adapter converts SDK `TransactionInstruction` objects into the wallet's `@solana/kit` instruction shape. The encrypted signer remains in the normal wallet command layer and is attached only at the signing boundary.

The adapter uses the official SDK's position/account derivation. The command layer may add an idempotent associated-token-account instruction for the Jupiter receipt token on deposit or the USDC destination on withdrawal. It does not hand-author Jupiter protocol instructions.

## Read behavior

`lend status` does not unlock the keystore. It reports:

- wallet and canonical asset
- wallet USDC balance
- supplied position in underlying USDC
- protocol-reported currently withdrawable USDC
- receipt-token mint/account and shares
- supply and rewards rates as raw protocol values, without inventing a percentage scale

The read SDK's `withdrawable` value is authoritative for `lend withdraw <amount>` validation and for `lend withdraw --all`. The command never guesses a maximum from a receipt-token balance.

## Write behavior

Deposit and withdrawal use the same wallet transaction safety sequence as SOL, token, and stake writes:

```text
canonical asset validation
  -> amount / position / balance validation
  -> official Jupiter instruction construction
  -> optional idempotent ATA creation
  -> blockhash and fee lookup
  -> human or JSON preflight
  -> simulation
  -> confirmation unless --yes/session yes
  -> encrypted signer unlock
  -> broadcast
  -> blockhash-aware confirmation
  -> best-effort position refresh
```

`--dry-run` simulates without broadcasting. `--yes` skips only the confirmation prompt; it does not skip validation or simulation. If protocol liquidity makes a requested withdrawal unavailable, the requested and currently withdrawable amounts are reported and no transaction is built.

`--all` uses the SDK-reported maximum currently withdrawable amount. It does not convert a receipt-token balance heuristically.

JSON mode writes one success document to stdout. Integer amounts are decimal strings, while errors go to stderr. A confirmed transaction remains a success even if the post-confirmation position refresh is temporarily unavailable; the output explicitly says when that refresh could not be completed.

## Dependency and security note

The legacy Jupiter SDK dependency tree introduces `@solana/web3.js`, Anchor, and other packages that are not used by the v0.1 wallet core. `npm audit --omit=dev` currently reports transitive advisories through this upstream SDK line, including advisories associated with `toml`, `uuid`, and the web3/Anchor graph. No safe automated upgrade was applied because the SDK pins and API compatibility must be reviewed together. This is recorded as a release blocker for a future dependency refresh, not hidden by weakening audit output.

The current implementation has no live mainnet deposit or withdrawal test and does not claim one. Unit tests cover exact USDC amounts, canonical-mainnet gating, SDK-instruction conversion, and completion. A future opt-in read-only integration test may exercise the current public position API. Any manual write smoke test must use a separately funded disposable wallet and a deliberately tiny amount after independent code review.
