import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getCompiledTransactionMessageEncoder,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { confirm } from "../shell/prompt.js";
import {
  SimulationError,
  ConfirmationError,
  InsufficientBalanceError,
  TransactionRejectedError,
  safeJson,
} from "../errors/errors.js";
import { formatSol, parseSol } from "../solana/amounts.js";
import { assertRpcCluster, rpcRequest } from "../solana/rpc.js";
import { parseAddress } from "../wallet/address.js";
import { EncryptedKeystoreSigner } from "../wallet/signer.js";
import { requireWallet } from "./read-only.js";
import { requireSelectedWallet } from "./read-only.js";
import type { CommandContext } from "./context.js";
import { formatTransactionReceipt } from "../output/transaction.js";
import { shortenAddress } from "../output/human.js";

/**
 * SOL transfer command.
 *
 * The important security property is the order of operations in this module:
 * build and simulate first, ask for confirmation second, unlock/sign third,
 * and broadcast last. The same shape is reused by token, stake, and lending
 * commands so a feature cannot accidentally sign before preflight.
 */
export async function sendSol(
  context: CommandContext,
  destinationValue: string,
  amountValue: string,
  dryRun: boolean,
  yes: boolean,
): Promise<void> {
  const source = await requireWallet(context);
  const selectedWallet = await requireSelectedWallet(context);
  const destination = parseAddress(destinationValue);
  const lamports = parseSol(amountValue);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const balanceResponse = await rpcRequest(
    rpc.getBalance(source, { commitment: context.config.commitment }),
    "balance lookup",
  );
  const balance = BigInt(balanceResponse.value as bigint);
  const latest = await rpcRequest(
    rpc.getLatestBlockhash({ commitment: context.config.commitment }),
    "recent blockhash lookup",
  );
  const signer = new EncryptedKeystoreSigner(
    selectedWallet,
    context.readPassphrase,
  );
  let message: any = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayer(source, message);
  message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
  message = appendTransactionMessageInstruction(
    getTransferSolInstruction({
      source: signer,
      destination,
      amount: lamports,
    }),
    message,
  );
  const unsigned = compileTransaction(message);
  const feeMessage = Buffer.from(unsigned.messageBytes).toString(
    "base64",
  ) as any;
  const feeResponse = await rpcRequest(
    rpc.getFeeForMessage(feeMessage),
    "fee estimation",
  );
  const fee = BigInt(feeResponse.value ?? 0n);
  if (balance < lamports + fee)
    throw new InsufficientBalanceError(
      `Insufficient SOL balance. Need ${formatSol(lamports + fee)} SOL including the estimated fee; have ${formatSol(balance)} SOL.`,
    );
  const summary = {
    action: "Send SOL",
    from: source,
    to: destination,
    lamports,
    sol: formatSol(lamports),
    estimatedFeeLamports: fee,
    estimatedFeeSol: formatSol(fee),
    cluster: context.config.cluster,
    dryRun,
  };
  const human = `Action:       Send SOL\nWallet:       ${source}\nTo:           ${destination}\nAmount:       ${formatSol(lamports)} SOL\nNetwork fee:  ~${formatSol(fee)} SOL\nNetwork:      ${context.config.cluster}`;
  context.output.preflight({ ok: true, preflight: summary }, human);

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
  if (dryRun) {
    context.output.print(
      { ok: true, status: "simulated", dryRun: true, preflight: summary },
      "Dry-run complete. The transaction was simulated and not broadcast.",
    );
    return;
  }
  if (
    !yes &&
    !(await confirm(
      context.config.cluster === "mainnet"
        ? `Send ${formatSol(lamports)} SOL from ${selectedWallet.identity.alias} (${shortenAddress(source)}) to ${shortenAddress(destination)} on MAINNET?`
        : `Send ${formatSol(lamports)} SOL from ${selectedWallet.identity.alias} (${shortenAddress(source)}) to ${shortenAddress(destination)} on devnet?`,
    ))
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
  context.output.print(
    {
      ok: true,
      signature: String(signature),
      slot: status.slot,
      status: status.confirmationStatus,
    },
    formatTransactionReceipt({
      action: "SOL transfer",
      wallet: selectedWallet.identity,
      cluster: context.config.cluster,
      confirmation: status.confirmationStatus,
      slot: status.slot,
      signature: String(signature),
      details: [
        ["From", String(source)],
        ["To", String(destination)],
        ["Amount", `${formatSol(lamports)} SOL`],
        ["Estimated network fee", `~${formatSol(fee)} SOL`],
      ],
    }),
  );
}

export async function confirmSignature(
  rpc: ReturnType<CommandContext["getClient"]>["rpc"],
  signature: string,
  commitment: "processed" | "confirmed" | "finalized",
  lastValidBlockHeight?: bigint,
  showProgress = false,
): Promise<{
  slot: bigint;
  confirmationStatus: "processed" | "confirmed" | "finalized";
}> {
  let showedProgress = false;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (showProgress && attempt === 0) {
        process.stderr.write("Waiting for transaction confirmation");
        showedProgress = true;
      } else if (showProgress && attempt > 0 && attempt % 4 === 0) {
        process.stderr.write(".");
      }
      const response = await rpcRequest(
        rpc.getSignatureStatuses([signature as never], {
          searchTransactionHistory: true,
        }),
        "transaction confirmation lookup",
      );
      const status = response.value[0];
      if (status?.err)
        throw new ConfirmationError(
          `Transaction failed after broadcast. Signature: ${signature}. Error: ${safeJson(status.err)}`,
          { signature },
        );
      if (
        status?.confirmationStatus &&
        commitmentSatisfied(status.confirmationStatus, commitment)
      )
        return {
          slot: status.slot,
          confirmationStatus: status.confirmationStatus,
        };
      if (lastValidBlockHeight !== undefined && attempt % 5 === 0) {
        const blockHeight = await rpcRequest(
          rpc.getBlockHeight({ commitment }),
          "block height lookup",
        );
        if (BigInt(blockHeight as bigint) > lastValidBlockHeight && !status) {
          // The status may have changed after the first lookup while the
          // block-height request was in flight. Recheck before calling it lost.
          const boundaryStatus = await rpcRequest(
            rpc.getSignatureStatuses([signature as never], {
              searchTransactionHistory: true,
            }),
            "transaction confirmation lookup",
          );
          const included = boundaryStatus.value[0];
          if (included?.err)
            throw new ConfirmationError(
              `Transaction failed after broadcast. Signature: ${signature}. Error: ${safeJson(included.err)}`,
              { signature },
            );
          if (included?.confirmationStatus) {
            if (commitmentSatisfied(included.confirmationStatus, commitment))
              return {
                slot: included.slot,
                confirmationStatus: included.confirmationStatus,
              };
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          throw new ConfirmationError(
            `Transaction blockhash expired before confirmation. Query signature ${signature} before retrying.`,
            { signature },
          );
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new ConfirmationError(
      `Transaction confirmation timed out. Query signature ${signature} before retrying.`,
      { signature },
    );
  } catch (error) {
    if (error instanceof ConfirmationError) throw error;
    const message = error instanceof Error ? error.message : "RPC failure";
    throw new ConfirmationError(
      `Unable to confirm transaction. Query signature ${signature} before retrying. ${message}`,
      { signature, cause: message },
    );
  } finally {
    if (showedProgress) process.stderr.write("\n");
  }
}

/**
 * Keep transaction lifetime valid through the passphrase prompt. The signer
 * calls this after unlocking the key and immediately before creating a
 * signature, so time spent reviewing a preview cannot silently stale it.
 */
export async function assertBlockhashFresh(
  rpc: ReturnType<CommandContext["getClient"]>["rpc"],
  lastValidBlockHeight: bigint,
  commitment: "processed" | "confirmed" | "finalized",
): Promise<void> {
  const height = await rpcRequest(
    rpc.getBlockHeight({ commitment }),
    "transaction lifetime lookup",
  );
  if (BigInt(height as bigint) > lastValidBlockHeight)
    throw new TransactionRejectedError(
      "The transaction preview expired before signing. No transaction was signed or broadcast; run the command again for a fresh preview.",
    );
}

/** Submit once and retain the local signature even if the RPC response is lost. */
export async function broadcastSignedTransaction(
  rpc: ReturnType<CommandContext["getClient"]>["rpc"],
  signed: Parameters<typeof getBase64EncodedWireTransaction>[0],
  commitment: "processed" | "confirmed" | "finalized",
): Promise<string> {
  const signature = String(getSignatureFromTransaction(signed));
  try {
    const returned = await rpcRequest(
      rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        skipPreflight: true,
        preflightCommitment: commitment,
      }),
      "transaction broadcast",
    );
    if (String(returned) !== signature)
      throw new Error(
        "RPC returned a signature different from the signed transaction",
      );
    return signature;
  } catch {
    throw new ConfirmationError(
      `The broadcast response could not be verified. The transaction may have been accepted. Query signature ${signature} before retrying.`,
      { signature, broadcastOutcomeUnknown: true },
    );
  }
}

function commitmentSatisfied(current: string, wanted: string): boolean {
  const rank = { processed: 1, confirmed: 2, finalized: 3 } as Record<
    string,
    number
  >;
  return (rank[current] ?? 0) >= (rank[wanted] ?? 0);
}
