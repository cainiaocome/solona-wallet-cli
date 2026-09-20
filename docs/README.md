# Documentation map

This folder is the detailed manual for `sol-wallet`. If you are new to Web3,
read the documents in this order:

1. [Getting started](getting-started.md) — install the CLI, create or import a
   wallet, and perform a safe read-only or dry-run command.
2. [Web3 and Solana concepts](web3-concepts.md) — the vocabulary needed to
   understand addresses, keys, SOL, SPL tokens, RPC, transactions, staking,
   and lending.
3. [Command cookbook](command-cookbook.md) — practical examples, what each
   command changes, and how to automate JSON output.
4. [Architecture](architecture.md) — how a command travels through the source
   code and where to look when learning or changing the project.
5. [Security and testing](security-and-testing.md) — what the wallet protects,
   what it cannot protect, how to test without real funds, and how CI validates
   the Docker image.
6. [Supply-chain controls](supply-chain.md) — how the lockfile, release-age
   policy, CI, Docker build, and dependency updates work together.

The more focused reference documents are also useful:

- [Implementation and operations](implementation.md) records the implementation
  decisions, dependency-install incident, release workflow, and known limits.
- [Jupiter Lend Earn](jupiter-lend.md) documents the deliberately narrow v0.2
  mainnet USDC integration.
- [Original specification](spec.md) is the product specification that guided
  the implementation. It is preserved as a reference rather than a tutorial.

## How to read the source

Start with `src/cli.ts`, then follow this path:

```text
src/cli.ts
  -> src/config/config.ts
  -> src/commands/context.ts
  -> src/shell/repl.ts or src/commands/execute.ts
  -> src/commands/<feature>.ts
  -> src/solana/ or src/integrations/jupiter-lend/
  -> src/output/
```

The source files contain comments at the boundaries where Web3 concepts or
security decisions matter. Comments intentionally explain _why_ a boundary
exists; the function names and tests explain the smaller mechanics.
