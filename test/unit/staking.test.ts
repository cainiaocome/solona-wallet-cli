import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
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
  getStakeAccountInfo,
  STAKE_STAKER_AUTHORITY_OFFSET,
  STAKE_WITHDRAW_AUTHORITY_OFFSET,
  STAKE_CONFIG_ADDRESS,
  addStakeRegistryEntry,
  readStakeAccounts,
  readStakeRegistry,
  submitStakeCreation,
  withStakeAccountRecovery,
} from "../../src/commands/staking.js";
import { createCommandContext } from "../../src/commands/context.js";
import {
  scopedStakeRegistryPath,
  setSessionCluster,
} from "../../src/config/config.js";
import { clusterSchema, defaultRpcUrl } from "../../src/config/schema.js";
import { ConfirmationError } from "../../src/errors/errors.js";
import { normalizeSecretKey } from "../../src/wallet/keystore.js";

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
  it("uses base64 when checking whether an existing stake account is present", async () => {
    const stakeAddress = "11111111111111111111111111111114";
    const getAccountInfo = vi.fn((_address: unknown, _config: unknown) =>
      request({ value: null }),
    );

    await getStakeAccountInfo(
      { getAccountInfo } as never,
      stakeAddress,
      "confirmed",
      "unit test stake lookup",
    );

    expect(getAccountInfo).toHaveBeenCalledWith(address(stakeAddress), {
      commitment: "confirmed",
      encoding: "base64",
    });
  });

  it("preserves stake-address recovery details on an uncertain create result", () => {
    const cause = new ConfirmationError("Query signature before retrying.", {
      signature: "offline-test-signature",
      broadcastOutcomeUnknown: true,
    });

    const result = withStakeAccountRecovery(
      cause,
      "11111111111111111111111111111114",
      true,
    );

    expect(result.message).toContain(
      "Stake account: 11111111111111111111111111111114",
    );
    expect(result.details).toMatchObject({
      signature: "offline-test-signature",
      broadcastOutcomeUnknown: true,
      stakeAccount: "11111111111111111111111111111114",
      localRecoveryHintSaved: true,
    });
  });

  it("persists the stake recovery hint before an ambiguous broadcast", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-create-unknown-"),
    );
    const context = stakeContext(
      configDir,
      "d8ed414d-2175-4ab6-a0c9-4388514f5952",
      "daily",
      wallet,
      "devnet",
    );
    const secret = await normalizeSecretKey(new Uint8Array(32).fill(31));
    const payer = await createKeyPairSignerFromBytes(secret);
    secret.fill(0);
    let message = createTransactionMessage({ version: 0 });
    message = setTransactionMessageFeePayer(payer.address, message);
    message = setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: "11111111111111111111111111111111" as never,
        lastValidBlockHeight: 100n,
      },
      message,
    );
    message = appendTransactionMessageInstruction(
      getTransferSolInstruction({
        source: payer,
        destination: address("11111111111111111111111111111113"),
        amount: 1n,
      }),
      message,
    );
    const signed = await signTransactionMessageWithSigners(message);
    const stakeAddress = "11111111111111111111111111111114";
    let hintWasSavedAtBroadcast = false;
    const rpc = {
      sendTransaction: () => ({
        send: async () => {
          hintWasSavedAtBroadcast = (
            await readStakeRegistry(context)
          ).accounts.some((entry) => entry.address === stakeAddress);
          throw new Error("connection closed after request body was sent");
        },
      }),
    } as never;

    try {
      const error = await submitStakeCreation(
        context,
        rpc,
        signed,
        stakeAddress,
        String(vote),
        100n,
      ).catch((failure: unknown) => failure);

      expect(hintWasSavedAtBroadcast).toBe(true);
      expect(error).toBeInstanceOf(ConfirmationError);
      expect((error as Error).message).toContain(stakeAddress);
      expect((error as ConfirmationError).details).toMatchObject({
        stakeAccount: stakeAddress,
        localRecoveryHintSaved: true,
        broadcastOutcomeUnknown: true,
      });
      expect((await readStakeRegistry(context)).accounts).toMatchObject([
        { address: stakeAddress, validatorVoteAccount: String(vote) },
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

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

  it("removes a local stake hint after an authoritative lookup proves the account closed", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-closed-"),
    );
    const id = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
    const context = stakeContext(configDir, id, "daily", wallet, "devnet");
    const stakeAddress = "11111111111111111111111111111114";
    try {
      await addStakeRegistryEntry(context, {
        address: stakeAddress,
        validatorVoteAccount: "11111111111111111111111111111115",
        createdSignature: "test-signature",
        createdAt: "2026-09-26T00:00:00.000Z",
      });
      context.getClient = () =>
        ({
          rpc: {
            getProgramAccounts: () => request([]),
            getAccountInfo: () => request({ value: null }),
          },
        }) as never;

      const accounts = await readStakeAccounts(context, wallet, true);

      expect(accounts).toEqual([]);
      expect((await readStakeRegistry(context)).accounts).toEqual([]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("retains a local stake hint when account lookup fails", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-unavailable-"),
    );
    const id = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
    const context = stakeContext(configDir, id, "daily", wallet, "devnet");
    const stakeAddress = "11111111111111111111111111111114";
    try {
      await addStakeRegistryEntry(context, {
        address: stakeAddress,
        validatorVoteAccount: "11111111111111111111111111111115",
        createdSignature: "test-signature",
        createdAt: "2026-09-26T00:00:00.000Z",
      });
      context.getClient = () =>
        ({
          rpc: {
            getProgramAccounts: () => request([]),
            getAccountInfo: () => ({
              send: async () => {
                throw new Error("RPC unavailable");
              },
            }),
          },
        }) as never;

      const accounts = await readStakeAccounts(context, wallet, true);

      expect(accounts).toMatchObject([
        { address: stakeAddress, state: "unknown", source: "local-registry" },
      ]);
      expect((await readStakeRegistry(context)).accounts).toHaveLength(1);
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

function request<T>(value: T) {
  return { send: async () => value };
}
