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
  return [
    `${options.action} confirmed`,
    ...(options.wallet
      ? [`Wallet: ${options.wallet.alias} (${options.wallet.address})`]
      : []),
    `Network: ${options.cluster}`,
    `Confirmation: ${options.confirmation}`,
    `Slot: ${options.slot}`,
    ...(options.details ?? []).map(([label, value]) => `${label}: ${value}`),
    `Signature: ${options.signature}`,
    `Explorer: ${transactionExplorerUrl(options.signature, options.cluster)}`,
  ].join("\n");
}

export function transactionExplorerUrl(
  signature: string,
  cluster: string,
): string {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return cluster === "devnet" ? `${base}?cluster=devnet` : base;
}
