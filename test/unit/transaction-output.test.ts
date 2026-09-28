import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { createCommandContext } from "../../src/commands/context.js";
import { executeLine } from "../../src/commands/execute.js";
import {
  formatTransactionReceipt,
  transactionExplorerUrl,
} from "../../src/output/transaction.js";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SIGNATURE = bs58.encode(new Uint8Array(64).fill(7));

describe("human transaction output", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders a complete receipt and selects the correct explorer network", () => {
    const receipt = formatTransactionReceipt({
      action: "SOL transfer",
      wallet: {
        alias: "daily",
        address: "11111111111111111111111111111112",
      },
      cluster: "devnet",
      confirmation: "confirmed",
      slot: 123n,
      signature: SIGNATURE,
      details: [["Amount", "0.5 SOL"]],
    });

    expect(receipt).toContain("SOL transfer confirmed");
    expect(receipt).toContain(
      "Wallet: daily (11111111111111111111111111111112)",
    );
    expect(receipt).toMatch(/Confirmation\s*:\s*confirmed/);
    expect(receipt).toMatch(/Amount\s*:\s*0.5 SOL/);
    expect(receipt).toContain(transactionExplorerUrl(SIGNATURE, "devnet"));
    expect(transactionExplorerUrl(SIGNATURE, "mainnet")).not.toContain(
      "cluster=",
    );
  });

  it("summarizes an inspected transaction while preserving its JSON response", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-tx-summary-"),
    );
    const output: string[] = [];
    try {
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      const response = {
        slot: 321n,
        blockTime: 1_700_000_000n,
        transaction: {
          message: {
            accountKeys: [
              "11111111111111111111111111111112",
              "11111111111111111111111111111113",
            ],
            header: { numRequiredSignatures: 1 },
            instructions: [{ programId: "11111111111111111111111111111111" }],
          },
        },
        meta: { err: null, fee: 5_000n },
      };
      context.getClient = () =>
        ({
          rpc: {
            getGenesisHash: () => request(MAINNET_GENESIS),
            getTransaction: () => request(response),
          },
        }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, `tx inspect ${SIGNATURE}`);
      const summary = output.join("");
      expect(summary).toContain("Result: successful");
      expect(summary).toContain("Slot: 321");
      expect(summary).toContain("Network fee: 0.000005 SOL");
      expect(summary).toContain("Signers: 11111111111111111111111111111112");
      expect(summary).toContain("Instructions: 1");
      expect(summary).toContain("Use --json");

      output.length = 0;
      await executeLine(context, `tx inspect ${SIGNATURE} --json`);
      expect(output).toHaveLength(1);
      expect(JSON.parse(output[0]!).transaction.slot).toBe("321");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function request<T>(value: T) {
  return { send: async () => value };
}
