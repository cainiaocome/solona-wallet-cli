import { describe, expect, it } from "vitest";
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
} from "../../src/commands/staking.js";
import { setSessionCluster } from "../../src/config/config.js";

const wallet = address("11111111111111111111111111111112");
const vote = address("11111111111111111111111111111113");
const signer = { address: wallet, signTransactions: async () => [] } as any;

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
  it("switches the default RPC together with the cluster", () => {
    const config = {
      cluster: "mainnet-beta" as const,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      commitment: "confirmed" as const,
      configDir: "/tmp",
    };
    setSessionCluster(config, "devnet");
    expect(config.cluster).toBe("devnet");
    expect(config.rpcUrl).toBe("https://api.devnet.solana.com");
  });

  it("refuses to relabel a session with an explicit RPC URL", () => {
    const config = {
      cluster: "mainnet-beta" as const,
      rpcUrl: "https://rpc.example.invalid",
      commitment: "confirmed" as const,
      configDir: "/tmp",
    };
    expect(() => setSessionCluster(config, "devnet")).toThrow(
      /explicit RPC URL/,
    );
  });
});
