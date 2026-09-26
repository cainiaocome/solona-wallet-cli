import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCommandContext } from "../../src/commands/context.js";
import { executeLine } from "../../src/commands/execute.js";

describe("validators command filtering", () => {
  it("hides delinquent validators by default and includes them on request", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-validators-"),
    );
    const output: string[] = [];
    try {
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
      );
      context.getClient = () =>
        ({
          rpc: {
            getGenesisHash: () => request(MAINNET_GENESIS),
            getVoteAccounts: () =>
              request({
                current: [validator(CURRENT_VOTE, 200n)],
                delinquent: [validator(DELINQUENT_VOTE, 100n)],
              }),
          },
        }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "validators");
      const defaultResults = JSON.parse(output.pop()!).validators;
      expect(
        defaultResults.map((item: { voteAccount: string }) => item.voteAccount),
      ).toEqual([CURRENT_VOTE]);

      await executeLine(context, "validators --include-delinquent");
      const includedResults = JSON.parse(output.pop()!).validators;
      expect(
        includedResults.map(
          (item: { voteAccount: string }) => item.voteAccount,
        ),
      ).toEqual([CURRENT_VOTE, DELINQUENT_VOTE]);
    } finally {
      vi.restoreAllMocks();
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

function request<T>(value: T) {
  return { send: async () => value };
}

function validator(votePubkey: string, activatedStake: bigint) {
  return {
    votePubkey,
    nodePubkey: "11111111111111111111111111111113",
    commission: 5,
    activatedStake,
    lastVote: 100n,
    rootSlot: 100n,
  };
}

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const CURRENT_VOTE = "11111111111111111111111111111112";
const DELINQUENT_VOTE = "11111111111111111111111111111114";
