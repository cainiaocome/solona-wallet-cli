import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { confirm } from "../shell/prompt.js";
import {
  InsufficientBalanceError,
  JupiterLendError,
  SimulationError,
  TransactionRejectedError,
  safeJson,
} from "../errors/errors.js";
import {
  JupiterLendAdapter,
  JUPITER_LEND_USDC_DECIMALS,
  JUPITER_LEND_USDC_MINT,
  LEGACY_SPL_TOKEN_ACCOUNT_SPACE,
  type JupiterLendInstructionPlan,
  type JupiterLendPosition,
  type WalletInstruction,
} from "../integrations/jupiter-lend/adapter.js";
import { confirmSignature } from "./send.js";
import type { CommandContext } from "./context.js";
import { requireWallet } from "./read-only.js";
import {
  formatSol,
  formatUnits,
  parseDecimalUnits,
} from "../solana/amounts.js";
import { rpcRequest } from "../solana/rpc.js";
import { hasFlag, type ParsedCommand } from "../shell/parser.js";
import { EncryptedKeystoreSigner } from "../wallet/signer.js";

export async function lendStatus(context: CommandContext): Promise<void> {
  const adapter = createAdapter(context);
  const owner = await requireWallet(context);
  const position = await runAdapter("reading Jupiter Lend position", () =>
    adapter.getPosition(owner),
  );
  const data = positionData(owner, position, context);
  context.output.print(data, positionHuman(data));
}

export async function lendDeposit(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (command.args.length !== 1)
    throw new JupiterLendError("Usage: lend deposit <amount>.");
  const amount = parseUsdcAmount(command.args[0]!);
  const adapter = createAdapter(context);
  const owner = await requireWallet(context);
  const signer = createLendSigner(context, owner);
  const plan = await runAdapter("building Jupiter Lend deposit", () =>
    adapter.buildDeposit(owner, amount, signer),
  );
  const position = await runAdapter("reading Jupiter Lend position", () =>
    adapter.getPosition(owner),
  );
  await runLendInstruction(
    context,
    command,
    owner,
    signer,
    "deposit",
    plan,
    {
      action: "Jupiter Lend USDC deposit",
      wallet: owner,
      asset: "USDC",
      amount,
      amountUsdc: formatUnits(amount, JUPITER_LEND_USDC_DECIMALS),
      protocol: "Jupiter Lend Earn",
      cluster: context.config.cluster,
      currentSupplied: position.supplied,
    },
    `Action:        Jupiter Lend USDC deposit\nWallet:        ${owner}\nAsset:         USDC\nAmount:        ${formatUnits(amount, JUPITER_LEND_USDC_DECIMALS)} USDC\nProtocol:      Jupiter Lend Earn\nCluster:       ${context.config.cluster}`,
    () => adapter.getPosition(owner),
  );
}

export async function lendWithdraw(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (
    command.args.length > 1 ||
    (hasFlag(command, "all") && command.args.length)
  )
    throw new JupiterLendError(
      "Usage: lend withdraw <amount> | lend withdraw --all.",
    );
  if (!hasFlag(command, "all") && command.args.length !== 1)
    throw new JupiterLendError(
      "Usage: lend withdraw <amount> | lend withdraw --all.",
    );
  const adapter = createAdapter(context);
  const owner = await requireWallet(context);
  const position = await runAdapter("reading Jupiter Lend position", () =>
    adapter.getPosition(owner),
  );
  const withdrawAll = hasFlag(command, "all");
  const amount = resolveWithdrawAmount(
    command.args[0],
    withdrawAll,
    position.withdrawable,
  );
  const signer = createLendSigner(context, owner);
  const redeemEntirePosition =
    withdrawAll && position.protocolWithdrawable >= position.supplied;
  const plan = await runAdapter("building Jupiter Lend withdrawal", () =>
    redeemEntirePosition
      ? adapter.buildRedeem(owner, position.receiptShares, signer)
      : adapter.buildWithdraw(owner, amount, signer),
  );
  await runLendInstruction(
    context,
    command,
    owner,
    signer,
    "withdraw",
    plan,
    {
      action: "Jupiter Lend USDC withdraw",
      wallet: owner,
      asset: "USDC",
      amount,
      amountUsdc: formatUnits(amount, JUPITER_LEND_USDC_DECIMALS),
      withdrawAll,
      redemption: redeemEntirePosition ? "all-receipt-shares" : "asset-amount",
      protocol: "Jupiter Lend Earn",
      cluster: context.config.cluster,
      currentSupplied: position.supplied,
      currentWithdrawable: position.withdrawable,
    },
    `Action:        Jupiter Lend USDC withdraw\nWallet:        ${owner}\nAsset:         USDC\nAmount:        ${formatUnits(amount, JUPITER_LEND_USDC_DECIMALS)} USDC\nProtocol:      Jupiter Lend Earn\nCluster:       ${context.config.cluster}`,
    () => adapter.getPosition(owner),
  );
}

async function runLendInstruction(
  context: CommandContext,
  command: ParsedCommand,
  owner: ReturnType<typeof address>,
  signer: EncryptedKeystoreSigner,
  operation: "deposit" | "withdraw",
  plan: JupiterLendInstructionPlan,
  summary: Record<string, unknown>,
  human: string,
  refresh: () => Promise<JupiterLendPosition>,
): Promise<void> {
  const instructions: WalletInstruction[] = [];
  const destination = address(plan.destinationTokenAccount);
  const destinationInfo = await rpcRequest(
    context.getClient().rpc.getAccountInfo(destination, {
      commitment: context.config.commitment,
    }),
    "Jupiter Lend destination token account lookup",
  );
  let ataCreationCost = 0n;
  if (!destinationInfo.value) {
    ataCreationCost = BigInt(
      await rpcRequest(
        context
          .getClient()
          .rpc.getMinimumBalanceForRentExemption(
            LEGACY_SPL_TOKEN_ACCOUNT_SPACE,
            {
              commitment: context.config.commitment,
            },
          ),
        "Jupiter Lend token account rent lookup",
      ),
    );
    const destinationMint =
      operation === "deposit"
        ? address(plan.receiptMint)
        : address(JUPITER_LEND_USDC_MINT);
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: destination,
        owner,
        mint: destinationMint,
        tokenProgram: address(plan.tokenProgram),
      }) as unknown as WalletInstruction,
    );
  }
  instructions.push(...plan.instructions);
  const rpc = context.getClient().rpc;
  const latest = await rpcRequest(
    rpc.getLatestBlockhash({ commitment: context.config.commitment }),
    "recent blockhash lookup",
  );
  let message: any = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayer(owner, message);
  message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
  for (const instruction of instructions)
    message = appendTransactionMessageInstruction(instruction as any, message);
  const unsigned = compileTransaction(message);
  const fee = BigInt(
    (
      await rpcRequest(
        rpc.getFeeForMessage(
          Buffer.from(unsigned.messageBytes).toString("base64") as any,
        ),
        "fee estimation",
      )
    ).value ?? 0n,
  );
  const balance = BigInt(
    (
      await rpcRequest(
        rpc.getBalance(owner, { commitment: context.config.commitment }),
        "balance lookup",
      )
    ).value as bigint,
  );
  if (balance < ataCreationCost + fee)
    throw new InsufficientBalanceError(
      `Insufficient SOL to pay the Jupiter Lend token-account rent and fee. Need ${formatSol(ataCreationCost + fee)} SOL; have ${formatSol(balance)} SOL.`,
    );
  const preflight = {
    ...summary,
    estimatedFeeLamports: fee,
    ataCreationCostLamports: ataCreationCost,
    dryRun: hasFlag(command, "dry-run") || context.session.dryRun,
  };
  if (!context.output.json)
    context.output.print(
      { ok: true, preflight },
      `${human}\nNetwork fee:  ~${formatSol(fee)} SOL\nCluster:       ${context.config.cluster}`,
    );
  const simulation = await rpcRequest(
    rpc.simulateTransaction(getBase64EncodedWireTransaction(unsigned), {
      encoding: "base64",
      sigVerify: false,
      commitment: context.config.commitment,
    }),
    "transaction simulation",
  );
  if (simulation.value.err)
    throw new SimulationError(
      `Transaction simulation failed: ${safeJson(simulation.value.err)}`,
      { logs: simulation.value.logs },
    );
  if (preflight.dryRun) {
    context.output.print(
      { ok: true, status: "simulated", dryRun: true, preflight },
      "Dry-run complete. The transaction was simulated and not broadcast.",
    );
    return;
  }
  if (
    !(
      hasFlag(command, "yes") ||
      context.session.yes ||
      (await confirm(
        "You are about to submit a MAINNET Jupiter Lend transaction. Proceed?",
      ))
    )
  )
    throw new TransactionRejectedError();
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpcRequest(
    rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      skipPreflight: true,
      preflightCommitment: context.config.commitment,
    }),
    "transaction broadcast",
  );
  const status = await confirmSignature(
    rpc,
    String(signature),
    context.config.commitment,
    latest.value.lastValidBlockHeight,
  );
  let refreshed: JupiterLendPosition | undefined;
  try {
    refreshed = await refresh();
  } catch {
    // A confirmed transaction remains confirmed if the post-write read is unavailable.
  }
  context.output.print(
    {
      ok: true,
      signature: String(signature),
      slot: status.slot,
      status: status.confirmationStatus,
      preflight,
      ...(refreshed
        ? { position: positionData(owner, refreshed, context) }
        : {}),
    },
    `Transaction confirmed: ${signature}${refreshed ? `\nCurrent supplied: ${formatUnits(refreshed.supplied, JUPITER_LEND_USDC_DECIMALS)} USDC\nCurrently withdrawable: ${formatUnits(refreshed.withdrawable, JUPITER_LEND_USDC_DECIMALS)} USDC` : "\nPosition refresh unavailable."}`,
  );
}

function createAdapter(context: CommandContext): JupiterLendAdapter {
  return new JupiterLendAdapter(context.config);
}

function createLendSigner(
  context: CommandContext,
  owner: ReturnType<typeof address>,
): EncryptedKeystoreSigner {
  return new EncryptedKeystoreSigner(
    context.config.configDir,
    owner,
    context.readPassphrase,
  );
}

export function parseUsdcAmount(value: string): bigint {
  const amount = parseDecimalUnits(
    value,
    JUPITER_LEND_USDC_DECIMALS,
    "USDC amount",
  );
  if (amount <= 0n)
    throw new JupiterLendError("USDC amount must be greater than zero.");
  return amount;
}

export function resolveWithdrawAmount(
  value: string | undefined,
  withdrawAll: boolean,
  withdrawable: bigint,
): bigint {
  if (!withdrawAll && value === undefined)
    throw new JupiterLendError(
      "Usage: lend withdraw <amount> | lend withdraw --all.",
    );
  const amount = withdrawAll ? withdrawable : parseUsdcAmount(value!);
  if (amount <= 0n)
    throw new JupiterLendError(
      "No USDC is currently withdrawable from the Jupiter Lend position.",
    );
  if (amount > withdrawable)
    throw new JupiterLendError(
      `Requested ${formatUnits(amount, JUPITER_LEND_USDC_DECIMALS)} USDC, but only ${formatUnits(withdrawable, JUPITER_LEND_USDC_DECIMALS)} USDC is currently withdrawable.`,
    );
  return amount;
}

function positionData(
  owner: ReturnType<typeof address>,
  position: JupiterLendPosition,
  context: CommandContext,
) {
  return {
    ok: true,
    wallet: owner,
    asset: "USDC",
    mint: JUPITER_LEND_USDC_MINT,
    cluster: context.config.cluster,
    walletBalance: position.walletBalance,
    walletBalanceUsdc: formatUnits(
      position.walletBalance,
      JUPITER_LEND_USDC_DECIMALS,
    ),
    supplied: position.supplied,
    suppliedUsdc: formatUnits(position.supplied, JUPITER_LEND_USDC_DECIMALS),
    protocolWithdrawable: position.protocolWithdrawable,
    protocolWithdrawableUsdc: formatUnits(
      position.protocolWithdrawable,
      JUPITER_LEND_USDC_DECIMALS,
    ),
    currentlyWithdrawable: position.withdrawable,
    currentlyWithdrawableUsdc: formatUnits(
      position.withdrawable,
      JUPITER_LEND_USDC_DECIMALS,
    ),
    receiptTokenMint: position.receiptMint,
    receiptTokenAccount: position.receiptTokenAccount,
    receiptTokenShares: position.receiptShares,
    protocolSupplyRateRaw: position.supplyRateRaw,
    protocolRewardsRateRaw: position.rewardsRateRaw,
  };
}

function positionHuman(data: ReturnType<typeof positionData>): string {
  return `Wallet:                    ${data.wallet}\nAsset:                     USDC\nWallet balance:            ${data.walletBalanceUsdc} USDC\nJupiter Lend supplied:     ${data.suppliedUsdc} USDC\nProtocol liquidity limit:  ${data.protocolWithdrawableUsdc} USDC\nCurrently withdrawable:    ${data.currentlyWithdrawableUsdc} USDC\nReceipt token mint:         ${data.receiptTokenMint}\nReceipt token shares:       ${data.receiptTokenShares}\nProtocol supply rate (raw): ${data.protocolSupplyRateRaw}\nProtocol rewards rate (raw): ${data.protocolRewardsRateRaw}`;
}

async function runAdapter<T>(
  action: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof JupiterLendError) throw error;
    const message = error instanceof Error ? error.message : "unknown failure";
    throw new JupiterLendError(`${action} failed: ${message}`);
  }
}
