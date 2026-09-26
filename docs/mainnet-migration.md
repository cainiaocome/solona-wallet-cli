# Solana `mainnet` setup

The CLI uses Solana's current production cluster name, `mainnet`, and its
official public RPC endpoint, `https://api.mainnet.solana.com`. The public
endpoint is rate-limited and has no production availability guarantee. For
dependable use, choose a reputable RPC provider and configure its URL explicitly.

## Configuration

Use the current cluster name in CLI arguments, environment variables, and
`config.json`:

```bash
sol-wallet --cluster mainnet
```

```dotenv
SOL_WALLET_CLUSTER=mainnet
```

```json
{
  "version": 1,
  "cluster": "mainnet",
  "rpcUrl": "https://api.mainnet.solana.com",
  "commitment": "confirmed"
}
```

Devnet remains available for learning and testing with
`--cluster devnet` or `SOL_WALLET_CLUSTER=devnet`; its public endpoint is
`https://api.devnet.solana.com`. Devnet assets have no real-world value and
devnet state may be reset.

The cluster label and configured RPC URL are distinct. With a custom RPC URL,
the CLI verifies the endpoint's genesis hash against the selected cluster
before network-sensitive operations. This prevents accidentally treating a
different Solana network as mainnet.

## Existing configuration

The CLI accepts only `mainnet` and `devnet` as cluster names. If an existing
`config.json` or environment variable uses another spelling, update it to
`mainnet`. For the official public endpoint, use
`https://api.mainnet.solana.com`. Custom provider URLs can remain unchanged.

## Learn more

- [Solana cluster and public RPC documentation](https://solana.com/docs/references/clusters)
- [Getting started](getting-started.md)
- [Web3 concepts explained](web3-concepts.md)
