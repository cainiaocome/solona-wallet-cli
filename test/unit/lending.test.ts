import { describe, expect, it } from "vitest";
import { AccountRole, address } from "@solana/kit";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  JupiterLendAdapter,
  JUPITER_LEND_USDC_DECIMALS,
  JUPITER_LEND_USDC_MINT,
  toWalletInstruction,
} from "../../src/integrations/jupiter-lend/adapter.js";
import {
  parseUsdcAmount,
  resolveWithdrawAmount,
} from "../../src/commands/lending.js";

describe("Jupiter Lend USDC boundary", () => {
  it("parses exact canonical USDC amounts", () => {
    expect(JUPITER_LEND_USDC_DECIMALS).toBe(6);
    expect(parseUsdcAmount("1.25")).toBe(1_250_000n);
    expect(() => parseUsdcAmount("1.0000001")).toThrow(/decimal places/);
    expect(() => parseUsdcAmount("0")).toThrow(/greater than zero/);
    expect(() => parseUsdcAmount("1e3")).toThrow(/decimal string/);
  });

  it("uses protocol withdrawability for explicit and --all withdrawals", () => {
    expect(resolveWithdrawAmount("1.25", false, 2_000_000n)).toBe(1_250_000n);
    expect(resolveWithdrawAmount(undefined, true, 2_000_000n)).toBe(2_000_000n);
    expect(() => resolveWithdrawAmount("2.1", false, 2_000_000n)).toThrow(
      /currently withdrawable/,
    );
    expect(() => resolveWithdrawAmount(undefined, true, 0n)).toThrow(/No USDC/);
  });

  it("keeps the canonical mint fixed and rejects non-mainnet adapters", () => {
    expect(JUPITER_LEND_USDC_MINT).toBe(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(
      () =>
        new JupiterLendAdapter({
          cluster: "devnet",
          rpcUrl: "https://api.devnet.solana.com",
          commitment: "confirmed",
          configDir: "/tmp",
        }),
    ).toThrow(/mainnet-beta/);
  });

  it("converts official SDK instructions without losing account roles", () => {
    const signer = new PublicKey("11111111111111111111111111111112");
    const program = new PublicKey("11111111111111111111111111111111");
    const instruction = new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },
        { pubkey: program, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]),
    });
    const converted = toWalletInstruction(instruction, {
      address: address(signer.toBase58()),
    });
    expect(converted.programAddress).toBe(address(program.toBase58()));
    expect(converted.data).toEqual(Uint8Array.from([1, 2, 3]));
    expect(converted.accounts.map((account) => account.role)).toEqual([
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
    ]);
    expect(converted.accounts[0]?.signer).toBeDefined();
  });
});
