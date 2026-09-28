import { keyValueRows, networkLabel } from "./human.js";
import { color, type Tone } from "./terminal.js";

export interface TransactionReceiptOptions {
  action: string;
  wallet?: { alias: string; address: string };
  cluster: string;
  confirmation: string;
  slot: bigint | number | string;
  signature: string;
  details?: ReadonlyArray<readonly [string, string]>;
}

/** Render a consistent, copyable human receipt after a confirmed write. */
export function formatTransactionReceipt(
  options: TransactionReceiptOptions,
): string {
  const summary: [string, string, Tone?][] = [
    ["Network", networkLabel(options.cluster)],
    ["Confirmation", options.confirmation, "success"],
    ["Slot", String(options.slot)],
    ...(options.details ?? []).map(([label, value]): [string, string] => [
      label,
      value,
    ]),
  ];
  return [
    color(`${options.action} confirmed`, "success"),
    ...(options.wallet
      ? [
          keyValueRows([
            ["Wallet", `${options.wallet.alias} (${options.wallet.address})`],
          ]),
        ]
      : []),
    keyValueRows(summary),
    keyValueRows([
      ["Signature", options.signature],
      ["Explorer", transactionExplorerUrl(options.signature, options.cluster)],
    ]),
  ].join("\n");
}

export function transactionExplorerUrl(
  signature: string,
  cluster: string,
): string {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return cluster === "devnet" ? `${base}?cluster=devnet` : base;
}
