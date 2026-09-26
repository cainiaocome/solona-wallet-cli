import { createSolanaRpc } from "@solana/kit";
import type { AppConfig } from "../config/config.js";
import type { Cluster } from "../config/schema.js";
import { RpcError } from "../errors/errors.js";

/**
 * Small RPC boundary shared by command handlers.
 *
 * The Kit client returns lazy request objects whose `.send()` performs the
 * network call. Converting failures here gives every handler the same typed
 * `RpcError` and prevents raw provider errors from leaking into user output.
 */
export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export function createRpc(config: AppConfig): SolanaRpc {
  return createSolanaRpc(
    config.rpcUrl as Parameters<typeof createSolanaRpc>[0],
  );
}

const CLUSTER_GENESIS_HASH: Record<Cluster, string> = {
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
};

/** Refuse to sign through an RPC endpoint that belongs to another cluster. */
export async function assertRpcCluster(
  rpc: SolanaRpc,
  expected: Cluster,
): Promise<void> {
  const genesisHash = await rpcRequest(
    rpc.getGenesisHash(),
    "cluster identity lookup",
  );
  if (genesisHash !== CLUSTER_GENESIS_HASH[expected])
    throw new RpcError(
      `RPC endpoint is not on ${expected}; refusing to prepare a transaction.`,
      { expectedCluster: expected, genesisHash },
    );
}

export async function rpcRequest<T>(
  request: { send: () => Promise<T> },
  description: string,
): Promise<T> {
  try {
    return await request.send();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown RPC failure";
    throw new RpcError(`${description} failed: ${message}`);
  }
}
