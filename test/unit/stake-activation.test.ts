import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { address, createSolanaRpc } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { createCommandContext } from "../../src/commands/context.js";
import { stakeList } from "../../src/commands/staking.js";
import { Output } from "../../src/output/output.js";
import { ensureScopedStakeDirectory } from "../../src/wallet/store.js";

const walletAddress = address("11111111111111111111111111111114");
const stakeAddress = address("11111111111111111111111111111112");
const stakeProgram = "Stake11111111111111111111111111111111111111";
const stakeHistorySysvar = "SysvarStakeHistory1111111111111111111111111";
const mainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const maxEpoch = "18446744073709551615";

describe("stake activation compatibility", () => {
  it("lists a delegated account without calling the removed RPC method", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-activation-"),
    );
    const methods: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const rpcRequest = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as {
          id: number;
          method: string;
          params: unknown[];
        };
        methods.push(rpcRequest.method);

        let result: unknown;
        if (rpcRequest.method === "getGenesisHash") {
          result = mainnetGenesis;
        } else if (rpcRequest.method === "getProgramAccounts") {
          result = [
            {
              pubkey: stakeAddress,
              account: {
                data: {
                  program: "stake",
                  parsed: {
                    type: "delegated",
                    info: {
                      meta: {
                        rentExemptReserve: "1666240",
                        authorized: {
                          staker: walletAddress,
                          withdrawer: walletAddress,
                        },
                        lockup: {
                          unixTimestamp: "0",
                          epoch: "0",
                          custodian: "11111111111111111111111111111111",
                        },
                      },
                      stake: {
                        delegation: {
                          voter: "11111111111111111111111111111113",
                          stake: "1900000000",
                          activationEpoch: "1043",
                          deactivationEpoch: maxEpoch,
                        },
                        creditsObserved: "0",
                      },
                    },
                  },
                  space: 200,
                },
                executable: false,
                lamports: 1_901_666_240,
                owner: stakeProgram,
                rentEpoch: 0,
              },
            },
          ];
        } else if (rpcRequest.method === "getEpochInfo") {
          result = {
            epoch: 1043,
            absoluteSlot: 100,
            blockHeight: 100,
            slotIndex: 0,
            slotsInEpoch: 432_000,
          };
        } else if (rpcRequest.method === "getAccountInfo") {
          const account = rpcRequest.params[0];
          result = {
            context: { slot: 100 },
            value:
              account === stakeHistorySysvar
                ? {
                    data: {
                      program: "stake",
                      parsed: { type: "stakeHistory", info: [] },
                      space: 0,
                    },
                    executable: false,
                    lamports: 1,
                    owner: stakeProgram,
                    rentEpoch: 0,
                  }
                : {
                    data: {
                      program: "stake",
                      parsed: {
                        type: "delegated",
                        info: {
                          meta: {
                            rentExemptReserve: "1666240",
                            authorized: {
                              staker: walletAddress,
                              withdrawer: walletAddress,
                            },
                            lockup: {
                              unixTimestamp: "0",
                              epoch: "0",
                              custodian: "11111111111111111111111111111111",
                            },
                          },
                          stake: {
                            delegation: {
                              voter: "11111111111111111111111111111113",
                              stake: "1900000000",
                              activationEpoch: "1043",
                              deactivationEpoch: maxEpoch,
                            },
                            creditsObserved: "0",
                          },
                        },
                      },
                      space: 200,
                    },
                    executable: false,
                    lamports: 1_901_666_240,
                    owner: stakeProgram,
                    rentEpoch: 0,
                  },
          };
        } else {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcRequest.id,
              error: { code: -32601, message: "Method not found" },
            }),
          );
          return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: rpcRequest.id, result }),
        );
      })();
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const rpcUrl = `http://127.0.0.1:${port}`;
    const walletId = "d8ed414d-2175-4ab6-a0c9-4388514f5952";

    try {
      await ensureScopedStakeDirectory(configDir, walletId);
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl,
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: walletId },
      );
      context.commandWallet = {
        identity: { id: walletId, alias: "fixture", address: walletAddress },
        keystorePath: "unused-in-this-read-only-test",
      };
      context.getClient = () => ({ rpc: createSolanaRpc(rpcUrl) }) as never;
      const output: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await stakeList(context);

      const result = JSON.parse(output[0]!);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]).toMatchObject({
        address: stakeAddress,
        state: "activating",
        delegatedStakeLamports: "1900000000",
        validatorVoteAccount: "11111111111111111111111111111113",
      });
      expect(methods).toContain("getEpochInfo");
      expect(
        methods.filter((method) => method === "getAccountInfo"),
      ).toHaveLength(2);
      expect(methods).not.toContain("getStakeActivation");

      context.output = new Output(
        { json: false, verbose: false },
        () => context.commandWallet?.identity,
        () => context.config.cluster,
      );
      await stakeList(context);
      expect(output.slice(1).join("")).toContain(
        "11111111111111111111111111111113",
      );
    } finally {
      vi.restoreAllMocks();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
