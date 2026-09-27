import { describe, expect, it } from "vitest";
import { assertRpcCluster, type SolanaRpc } from "../../src/solana/rpc.js";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

function rpcWithGenesisHash(genesisHash: string): SolanaRpc {
  return {
    getGenesisHash: () => ({ send: async () => genesisHash }),
  } as unknown as SolanaRpc;
}

describe("RPC cluster identity guard", () => {
  it("accepts the published Devnet and Mainnet genesis hashes", async () => {
    await expect(
      assertRpcCluster(rpcWithGenesisHash(DEVNET_GENESIS), "devnet"),
    ).resolves.toBeUndefined();
    await expect(
      assertRpcCluster(rpcWithGenesisHash(MAINNET_GENESIS), "mainnet"),
    ).resolves.toBeUndefined();
  });

  it("rejects the stale mock hash as Devnet before any write can proceed", async () => {
    await expect(
      assertRpcCluster(
        rpcWithGenesisHash("GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC"),
        "devnet",
      ),
    ).rejects.toThrow(/not on devnet; refusing to prepare a transaction/);
  });
});
