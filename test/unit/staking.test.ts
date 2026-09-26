import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { address } from "@solana/kit";
import {
  getDeactivateInstruction,
  getDelegateStakeInstruction,
  getInitializeInstruction,
  getWithdrawInstruction,
} from "@solana-program/stake";
import {
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_RENT_ADDRESS,
  SYSVAR_STAKE_HISTORY_ADDRESS,
} from "@solana/sysvars";
import {
  insertReadonlyAccounts,
  STAKE_ACCOUNT_SPACE,
  STAKE_STAKER_AUTHORITY_OFFSET,
  STAKE_WITHDRAW_AUTHORITY_OFFSET,
  STAKE_CONFIG_ADDRESS,
  addStakeRegistryEntry,
  readStakeRegistry,
} from "../../src/commands/staking.js";
import { createCommandContext } from "../../src/commands/context.js";
import {
  scopedStakeRegistryPath,
  setSessionCluster,
} from "../../src/config/config.js";
import { clusterSchema, defaultRpcUrl } from "../../src/config/schema.js";

const wallet = address("11111111111111111111111111111112");
const vote = address("11111111111111111111111111111113");
const signer = { address: wallet, signTransactions: async () => [] } as any;

function stakeContext(
  configDir: string,
  id: string,
  alias: string,
  walletAddress: ReturnType<typeof address>,
  cluster: "mainnet" | "devnet",
) {
  const context = createCommandContext(
    {
      configDir,
      cluster,
      rpcUrl: `https://api.${cluster}.solana.com`,
      commitment: "confirmed",
    },
    { json: true, verbose: false },
    { currentWalletId: id },
  );
  context.commandWallet = {
    identity: { id, alias, address: walletAddress },
    keystorePath: "unused-in-this-storage-test",
  };
  return context;
}

describe("native stake instruction safety", () => {
  it("keeps the documented StakeStateV2 filter offsets", () => {
    expect(STAKE_ACCOUNT_SPACE).toBe(200n);
    expect(STAKE_STAKER_AUTHORITY_OFFSET).toBe(12n);
    expect(STAKE_WITHDRAW_AUTHORITY_OFFSET).toBe(44n);
  });

  it("adds the sysvars in the Stake Program's positional order", () => {
    const initialize = insertReadonlyAccounts(
      getInitializeInstruction({
        stake: wallet,
        arg0: { staker: wallet, withdrawer: wallet },
        arg1: {
          unixTimestamp: 0n,
          epoch: 0n,
          custodian: address("11111111111111111111111111111111"),
        },
      }),
      1,
      [SYSVAR_RENT_ADDRESS],
    );
    const delegate = insertReadonlyAccounts(
      getDelegateStakeInstruction({
        stake: wallet,
        vote,
        stakeAuthority: signer,
      }),
      2,
      [
        SYSVAR_CLOCK_ADDRESS,
        SYSVAR_STAKE_HISTORY_ADDRESS,
        STAKE_CONFIG_ADDRESS,
      ],
    );
    const deactivate = insertReadonlyAccounts(
      getDeactivateInstruction({ stake: wallet, stakeAuthority: signer }),
      1,
      [SYSVAR_CLOCK_ADDRESS],
    );
    const withdraw = insertReadonlyAccounts(
      getWithdrawInstruction({
        stake: wallet,
        recipient: wallet,
        withdrawAuthority: signer,
        args: 1n,
      }) as any,
      2,
      [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS],
    );

    expect(initialize.accounts.map((account: any) => account.address)).toEqual([
      wallet,
      SYSVAR_RENT_ADDRESS,
    ]);
    expect(delegate.accounts.map((account: any) => account.address)).toEqual([
      wallet,
      vote,
      SYSVAR_CLOCK_ADDRESS,
      SYSVAR_STAKE_HISTORY_ADDRESS,
      STAKE_CONFIG_ADDRESS,
      wallet,
    ]);
    expect(deactivate.accounts.map((account: any) => account.address)).toEqual([
      wallet,
      SYSVAR_CLOCK_ADDRESS,
      wallet,
    ]);
    expect(withdraw.accounts.map((account: any) => account.address)).toEqual([
      wallet,
      wallet,
      SYSVAR_CLOCK_ADDRESS,
      SYSVAR_STAKE_HISTORY_ADDRESS,
      wallet,
    ]);
  });
});

describe("session cluster safety", () => {
  it("persists stake hints separately for each wallet and network", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-scope-"),
    );
    const dailyId = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
    const savingsId = "a8ed414d-2175-4ab6-a0c9-4388514f5952";
    const dailyAddress = address("11111111111111111111111111111112");
    const savingsAddress = address("11111111111111111111111111111113");
    const dailyMainnet = stakeContext(
      configDir,
      dailyId,
      "daily",
      dailyAddress,
      "mainnet",
    );
    const dailyDevnet = stakeContext(
      configDir,
      dailyId,
      "daily",
      dailyAddress,
      "devnet",
    );
    const savingsMainnet = stakeContext(
      configDir,
      savingsId,
      "savings",
      savingsAddress,
      "mainnet",
    );
    try {
      await addStakeRegistryEntry(dailyMainnet, {
        address: "11111111111111111111111111111114",
        validatorVoteAccount: "11111111111111111111111111111115",
        createdSignature: "daily-mainnet",
        createdAt: "2026-09-26T00:00:00.000Z",
      });
      await addStakeRegistryEntry(dailyDevnet, {
        address: "11111111111111111111111111111116",
        validatorVoteAccount: "11111111111111111111111111111117",
        createdSignature: "daily-devnet",
        createdAt: "2026-09-26T00:00:00.000Z",
      });
      await addStakeRegistryEntry(savingsMainnet, {
        address: "11111111111111111111111111111118",
        validatorVoteAccount: "11111111111111111111111111111119",
        createdSignature: "savings-mainnet",
        createdAt: "2026-09-26T00:00:00.000Z",
      });

      expect(
        (await readStakeRegistry(dailyMainnet)).accounts[0]?.createdSignature,
      ).toBe("daily-mainnet");
      expect(
        (await readStakeRegistry(dailyDevnet)).accounts[0]?.createdSignature,
      ).toBe("daily-devnet");
      expect(
        (await readStakeRegistry(savingsMainnet)).accounts[0]?.createdSignature,
      ).toBe("savings-mainnet");
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps stake metadata paths separate for each wallet and network", () => {
    const dailyMainnet = scopedStakeRegistryPath(
      "/tmp/wallets",
      "d8ed414d-2175-4ab6-a0c9-4388514f5952",
      "mainnet",
    );
    const dailyDevnet = scopedStakeRegistryPath(
      "/tmp/wallets",
      "d8ed414d-2175-4ab6-a0c9-4388514f5952",
      "devnet",
    );
    const savingsMainnet = scopedStakeRegistryPath(
      "/tmp/wallets",
      "a8ed414d-2175-4ab6-a0c9-4388514f5952",
      "mainnet",
    );
    expect(new Set([dailyMainnet, dailyDevnet, savingsMainnet]).size).toBe(3);
  });

  it("switches the default RPC together with the cluster", () => {
    const config = {
      cluster: "mainnet" as const,
      rpcUrl: "https://api.mainnet.solana.com",
      commitment: "confirmed" as const,
      configDir: "/tmp",
    };
    setSessionCluster(config, "devnet");
    expect(config.cluster).toBe("devnet");
    expect(config.rpcUrl).toBe("https://api.devnet.solana.com");
  });

  it("refuses to relabel a session with an explicit RPC URL", () => {
    const config = {
      cluster: "mainnet" as const,
      rpcUrl: "https://rpc.example.invalid",
      commitment: "confirmed" as const,
      configDir: "/tmp",
    };
    expect(() => setSessionCluster(config, "devnet")).toThrow(
      /explicit RPC URL/,
    );
  });

  it("uses Solana's current mainnet name and endpoint", () => {
    expect(defaultRpcUrl("mainnet")).toBe("https://api.mainnet.solana.com");
    expect(clusterSchema.safeParse("mainnet").success).toBe(true);
    expect(clusterSchema.safeParse("mainnet-beta").success).toBe(false);
  });
});
