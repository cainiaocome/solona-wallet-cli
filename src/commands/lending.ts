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
import {
  assertBlockhashFresh,
  broadcastSignedTransaction,
  confirmSignature,
} from "./send.js";
import type { CommandContext } from "./context.js";
import { requireSelectedWallet, requireWallet } from "./read-only.js";
import {
  formatSol,
  formatUnits,
  parseDecimalUnits,
} from "../solana/amounts.js";
import { rpcRequest } from "../solana/rpc.js";
import { hasFlag, type ParsedCommand } from "../shell/parser.js";
import { EncryptedKeystoreSigner } from "../wallet/signer.js";
import { formatTransactionReceipt } from "../output/transaction.js";
import {
  actionPreview,
  keyValueRows,
  networkLabel,
  sectionTitle,
} from "../output/human.js";
import { lendYieldRows } from "../output/lending.js";
import {
  calculateLendYield,
  estimateAnnualYield,
  YIELD_ASSUMPTION,
} from "../integrations/jupiter-lend/yield.js";

/**
 * Jupiter Lend command layer.
 *
 * This layer owns user-facing safety decisions: amounts are parsed as exact
 * USDC base units and all writes go through the common
 * simulation/confirmation/sign/broadcast lifecycle. The adapter owns mainnet
 * and canonical-asset checks plus official Jupiter SDK translation.
 */
export async function lendStatus(context: CommandContext): Promise<void> {
  const owner = await requireWallet(context);
  const position = await readLendPosition(context, owner);
  const data = positionData(owner, position, context);
  context.output.print(data, positionHuman(data, context.output.verbose));
}

/** Reusable public-position read for status and the dedicated command. */
export async function readLendPosition(
  context: CommandContext,
  owner: ReturnType<typeof address>,
): Promise<JupiterLendPosition> {
  const adapter = createAdapter(context);
  return runAdapter("reading Jupiter Lend position", () =>
    adapter.getPosition(owner),
  );
}

export async function lendDeposit(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (command.args.length !== 1)
    throw new JupiterLendError("Usage: jupiter-lend deposit <amount>.");
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
  const yieldInfo = calculateLendYield(
    position.supplyRateRaw,
    position.rewardsRateRaw,
    position.ratesUpdatedAt,
  );
  const annualYield = estimateAnnualYield(amount, yieldInfo);
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
      yield: yieldInfo,
      estimatedAnnualYield: annualYield,
    },
    `${actionPreview("JUPITER LEND DEPOSIT · TRANSACTION PREVIEW", [
      ["Wallet", String(owner)],
      ["Asset", "USDC"],
      [
        "Amount",
        `${formatUnits(amount, JUPITER_LEND_USDC_DECIMALS)} USDC`,
        "emphasis",
      ],
      ["Protocol", "Jupiter Lend Earn"],
      ["Network", networkLabel(context.config.cluster)],
      ...lendYieldRows(yieldInfo),
      [
        "Estimated annual yield",
        annualYield.status === "available"
          ? annualYield.belowOneBaseUnit
            ? "<0.000001 USDC"
            : `~${annualYield.amountUsdc} USDC`
          : "Unavailable",
      ],
    ])}${yieldInfo.status === "available" ? `\n${YIELD_ASSUMPTION}` : ""}`,
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
      "Usage: jupiter-lend withdraw <amount> | jupiter-lend withdraw --all.",
    );
  if (!hasFlag(command, "all") && command.args.length !== 1)
    throw new JupiterLendError(
      "Usage: jupiter-lend withdraw <amount> | jupiter-lend withdraw --all.",
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
    actionPreview("JUPITER LEND WITHDRAW · TRANSACTION PREVIEW", [
      ["Wallet", String(owner)],
      ["Asset", "USDC"],
      [
        "Amount",
        `${formatUnits(amount, JUPITER_LEND_USDC_DECIMALS)} USDC`,
        "emphasis",
      ],
      ["Protocol", "Jupiter Lend Earn"],
      ["Network", networkLabel(context.config.cluster)],
    ]),
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
  const rpc = context.getClient().rpc;
  const instructions: WalletInstruction[] = [];
  const destination = address(plan.destinationTokenAccount);
  const destinationInfo = await rpcRequest(
    rpc.getAccountInfo(destination, {
      commitment: context.config.commitment,
      // Token accounts contain 165 bytes; Kit's omitted-encoding overload
      // requests legacy base58, which the RPC rejects above 129 bytes.
      encoding: "base64",
    }),
    "Jupiter Lend destination token account lookup",
  );
  let ataCreationCost = 0n;
  if (!destinationInfo.value) {
    ataCreationCost = BigInt(
      await rpcRequest(
        rpc.getMinimumBalanceForRentExemption(LEGACY_SPL_TOKEN_ACCOUNT_SPACE, {
          commitment: context.config.commitment,
        }),
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
  context.output.preflight(
    { ok: true, preflight },
    `${human}\n${keyValueRows([
      ["Account rent", `${formatSol(ataCreationCost)} SOL`],
      ["Estimated fee", `~${formatSol(fee)} SOL`],
    ])}`,
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
        `${operation === "deposit" ? "Deposit" : "Withdraw"} ${formatUnits(BigInt(summary.amount as bigint), JUPITER_LEND_USDC_DECIMALS)} USDC ${operation === "deposit" ? "into" : "from"} Jupiter Lend for ${context.commandWallet?.identity.alias ?? "the selected wallet"} on MAINNET?`,
      ))
    )
  )
    throw new TransactionRejectedError();
  signer.setBeforeSign(() =>
    assertBlockhashFresh(
      rpc,
      latest.value.lastValidBlockHeight,
      context.config.commitment,
    ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await broadcastSignedTransaction(
    rpc,
    signed,
    context.config.commitment,
  );
  const status = await confirmSignature(
    rpc,
    String(signature),
    context.config.commitment,
    latest.value.lastValidBlockHeight,
    !context.output.json && Boolean(process.stderr.isTTY),
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
    `${formatTransactionReceipt({
      action: `Jupiter Lend USDC ${operation}`,
      wallet: context.commandWallet?.identity,
      cluster: context.config.cluster,
      confirmation: status.confirmationStatus,
      slot: status.slot,
      signature: String(signature),
      details: [
        [
          "Amount",
          `${formatUnits(BigInt(summary.amount as bigint), JUPITER_LEND_USDC_DECIMALS)} USDC`,
        ],
        ["Estimated network fee", `~${formatSol(fee)} SOL`],
        ...(refreshed
          ? [
              [
                "Currently supplied",
                `${formatUnits(refreshed.supplied, JUPITER_LEND_USDC_DECIMALS)} USDC`,
              ] as const,
              [
                "Currently withdrawable",
                `${formatUnits(refreshed.withdrawable, JUPITER_LEND_USDC_DECIMALS)} USDC`,
              ] as const,
            ]
          : []),
      ],
    })}${refreshed ? "" : "\nPosition refresh unavailable."}`,
  );
}

function createAdapter(context: CommandContext): JupiterLendAdapter {
  return new JupiterLendAdapter(context.config);
}

function createLendSigner(
  context: CommandContext,
  owner: ReturnType<typeof address>,
): EncryptedKeystoreSigner {
  const selected = context.commandWallet;
  if (!selected || selected.identity.address !== owner)
    throw new Error("Jupiter signer wallet snapshot mismatch.");
  return new EncryptedKeystoreSigner(selected, context.readPassphrase);
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
      "Usage: jupiter-lend withdraw <amount> | jupiter-lend withdraw --all.",
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
    yield: calculateLendYield(
      position.supplyRateRaw,
      position.rewardsRateRaw,
      position.ratesUpdatedAt,
    ),
  };
}

function positionHuman(
  data: ReturnType<typeof positionData>,
  verbose: boolean,
): string {
  const lines = [
    sectionTitle("JUPITER LEND · USDC"),
    keyValueRows([
      ["Wallet", data.wallet],
      ["Network", networkLabel(data.cluster)],
      ["Wallet balance", `${data.walletBalanceUsdc} USDC`, "emphasis"],
      ["Supplied", `${data.suppliedUsdc} USDC`, "emphasis"],
      ["Protocol liquidity", `${data.protocolWithdrawableUsdc} USDC`],
      ["Withdrawable now", `${data.currentlyWithdrawableUsdc} USDC`, "success"],
      ...lendYieldRows(data.yield),
    ]),
    ...(data.yield.status === "available" ? [YIELD_ASSUMPTION] : []),
  ];
  if (verbose) {
    lines.push(
      "",
      sectionTitle("TECHNICAL DETAILS"),
      keyValueRows([
        ["Receipt token mint", data.receiptTokenMint],
        ["Receipt token shares", String(data.receiptTokenShares)],
        ["Protocol supply rate (raw)", String(data.protocolSupplyRateRaw)],
        ["Protocol rewards rate (raw)", String(data.protocolRewardsRateRaw)],
      ]),
    );
  }
  return lines.join("\n");
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
