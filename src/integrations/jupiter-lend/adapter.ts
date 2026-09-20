import { Client as JupiterLendReadClient } from "@jup-ag/lend-read";
import {
  getDepositContext,
  getDepositIx,
  getWithdrawContext,
  getWithdrawIx,
} from "@jup-ag/lend/earn";
import BN from "bn.js";
import { AccountRole, address, type Address } from "@solana/kit";
import {
  Connection,
  PublicKey,
  type ParsedAccountData,
  type TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { AppConfig } from "../../config/config.js";
import { JupiterLendError } from "../../errors/errors.js";

export const JUPITER_LEND_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
export const JUPITER_LEND_USDC_DECIMALS = 6;

export interface WalletInstruction {
  programAddress: Address;
  accounts: ReadonlyArray<{
    address: Address;
    role: AccountRole;
    signer?: unknown;
  }>;
  data: Uint8Array;
}

export interface JupiterLendInstructionPlan {
  instructions: ReadonlyArray<WalletInstruction>;
  sourceTokenAccount: Address;
  destinationTokenAccount: Address;
  receiptMint: Address;
  tokenProgram: Address;
  walletBalance: bigint;
}

export interface JupiterLendPosition {
  walletBalance: bigint;
  supplied: bigint;
  withdrawable: bigint;
  receiptShares: bigint;
  receiptMint: Address;
  receiptTokenAccount: Address;
  supplyRateRaw: bigint;
  rewardsRateRaw: bigint;
}

export function toWalletInstruction(
  instruction: TransactionInstruction,
  signer?: { address: Address },
): WalletInstruction {
  const signerAddress = signer?.address;
  return {
    programAddress: address(instruction.programId.toBase58()),
    accounts: instruction.keys.map((meta) => {
      const accountAddress = address(meta.pubkey.toBase58());
      const isSigner = meta.isSigner;
      const role = isSigner
        ? meta.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : meta.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY;
      return {
        address: accountAddress,
        role,
        ...(isSigner && signerAddress === accountAddress ? { signer } : {}),
      };
    }),
    data: Uint8Array.from(instruction.data),
  };
}

export class JupiterLendAdapter {
  private readonly connection: Connection;
  private readonly readClient: JupiterLendReadClient;
  private verifiedUsdc = false;

  constructor(private readonly config: AppConfig) {
    if (config.cluster !== "mainnet-beta")
      throw new JupiterLendError(
        "Jupiter Lend v0.2 is available only on mainnet-beta.",
      );
    this.connection = new Connection(config.rpcUrl, config.commitment);
    this.readClient = new JupiterLendReadClient(
      this.connection,
      { commitment: config.commitment },
      "main",
    );
  }

  async getPosition(owner: Address): Promise<JupiterLendPosition> {
    await this.verifyCanonicalUsdc();
    const ownerKey = new PublicKey(owner);
    const mint = new PublicKey(JUPITER_LEND_USDC_MINT);
    const [details, position, userSupply] = await Promise.all([
      this.readClient.lending.getJlTokenDetails(mint),
      this.readClient.lending.getUserPosition(mint, ownerKey),
      this.readClient.liquidity.getUserSupplyData(ownerKey, mint),
    ]);
    const receiptTokenAccount = await this.deriveReceiptTokenAccount(
      ownerKey,
      new PublicKey(details.tokenAddress),
    );
    return {
      walletBalance: toBigInt(position.underlyingBalance),
      supplied: toBigInt(position.underlyingAssets),
      withdrawable: toBigInt(userSupply.userSupplyData.withdrawable),
      receiptShares: toBigInt(position.jlTokenShares),
      receiptMint: address(details.tokenAddress.toBase58()),
      receiptTokenAccount: address(receiptTokenAccount.toBase58()),
      supplyRateRaw: toBigInt(details.supplyRate),
      rewardsRateRaw: toBigInt(details.rewardsRate),
    };
  }

  async buildDeposit(
    owner: Address,
    amount: bigint,
  ): Promise<JupiterLendInstructionPlan> {
    await this.verifyCanonicalUsdc();
    const ownerKey = new PublicKey(owner);
    const asset = new PublicKey(JUPITER_LEND_USDC_MINT);
    const context = await getDepositContext({
      asset,
      signer: ownerKey,
      connection: this.connection,
    });
    const walletBalance = await this.getTokenAccountBalance(
      context.depositorTokenAccount,
    );
    if (walletBalance < amount)
      throw new JupiterLendError(
        `Insufficient USDC balance. Need ${amount} base units; have ${walletBalance}.`,
      );
    const instruction = await getDepositIx({
      amount: new BN(amount.toString()),
      asset,
      signer: ownerKey,
      connection: this.connection,
    });
    return {
      instructions: [toWalletInstruction(instruction)],
      sourceTokenAccount: address(context.depositorTokenAccount.toBase58()),
      destinationTokenAccount: address(
        context.recipientTokenAccount.toBase58(),
      ),
      receiptMint: address(context.fTokenMint.toBase58()),
      tokenProgram: address(context.tokenProgram.toBase58()),
      walletBalance,
    };
  }

  async buildWithdraw(
    owner: Address,
    amount: bigint,
  ): Promise<JupiterLendInstructionPlan> {
    await this.verifyCanonicalUsdc();
    const ownerKey = new PublicKey(owner);
    const asset = new PublicKey(JUPITER_LEND_USDC_MINT);
    const context = await getWithdrawContext({
      asset,
      signer: ownerKey,
      connection: this.connection,
    });
    const instruction = await getWithdrawIx({
      amount: new BN(amount.toString()),
      asset,
      signer: ownerKey,
      connection: this.connection,
    });
    return {
      instructions: [toWalletInstruction(instruction)],
      sourceTokenAccount: address(context.ownerTokenAccount.toBase58()),
      destinationTokenAccount: address(
        context.recipientTokenAccount.toBase58(),
      ),
      receiptMint: address(context.fTokenMint.toBase58()),
      tokenProgram: address(context.tokenProgram.toBase58()),
      walletBalance: 0n,
    };
  }

  private async verifyCanonicalUsdc(): Promise<void> {
    if (this.verifiedUsdc) return;
    const mint = new PublicKey(JUPITER_LEND_USDC_MINT);
    const response = await this.connection.getParsedAccountInfo(mint);
    const account = response.value;
    if (!account || !account.owner.equals(TOKEN_PROGRAM_ID))
      throw new JupiterLendError(
        "Canonical USDC is not owned by the legacy SPL Token Program.",
      );
    const data = account.data as ParsedAccountData;
    const decimals = data.parsed?.info?.decimals;
    if (data.parsed?.type !== "mint" || decimals !== JUPITER_LEND_USDC_DECIMALS)
      throw new JupiterLendError(
        "Canonical USDC returned unexpected mint metadata.",
      );
    this.verifiedUsdc = true;
  }

  private async getTokenAccountBalance(account: PublicKey): Promise<bigint> {
    try {
      const response = await this.connection.getTokenAccountBalance(account);
      return BigInt(response.value.amount);
    } catch {
      return 0n;
    }
  }

  private async deriveReceiptTokenAccount(
    owner: PublicKey,
    receiptMint: PublicKey,
  ): Promise<PublicKey> {
    const context = await getDepositContext({
      asset: new PublicKey(JUPITER_LEND_USDC_MINT),
      signer: owner,
      connection: this.connection,
    });
    if (!context.fTokenMint.equals(receiptMint))
      throw new JupiterLendError(
        "Jupiter Lend receipt mint changed unexpectedly.",
      );
    return context.recipientTokenAccount;
  }
}

function toBigInt(value: BN): bigint {
  return BigInt(value.toString());
}
