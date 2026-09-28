import { address, type Address } from "@solana/kit";
import { formatSol } from "../solana/amounts.js";
import {
  keyValueRows,
  networkLabel,
  sectionTitle,
  table,
} from "../output/human.js";
import { color } from "../output/terminal.js";
import { assertRpcCluster, rpcRequest } from "../solana/rpc.js";
import { aggregateTokenAccounts, getTokenAccounts } from "../solana/tokens.js";
import { listValidators } from "../solana/validators.js";
import { readHistory } from "../shell/history.js";
import { resolveWallet, type SelectedWallet } from "../wallet/store.js";
import { WalletStoreError } from "../errors/errors.js";
import type { CommandContext } from "./context.js";

/**
 * Public-data command handlers.
 *
 * These functions may use the wallet address from keystore metadata, but they
 * must not unlock the encrypted secret. Keeping reads separate from the signer
 * path makes commands such as `address`, `balance`, and `jupiter-lend status` safe to
 * run while inspecting a new machine or RPC endpoint.
 */
export async function requireWallet(context: CommandContext): Promise<Address> {
  return (await requireSelectedWallet(context)).identity.address;
}

export async function requireSelectedWallet(
  context: CommandContext,
): Promise<SelectedWallet> {
  if (context.commandWallet) return context.commandWallet;
  if (context.walletStoreError) throw context.walletStoreError;
  const id = context.session.currentWalletId;
  if (!id)
    throw new WalletStoreError(
      "WalletNotSelected",
      "No wallet is selected. Import one with `wallet import <alias>` or select one with `sol-wallet --wallet <alias>`.",
      2,
    );
  context.commandWallet = await resolveWallet(context.config.configDir, id);
  return context.commandWallet;
}

export async function showAddress(context: CommandContext): Promise<void> {
  const selected = await requireSelectedWallet(context);
  const wallet = selected.identity.address;
  context.output.print(
    { ok: true, address: wallet, cluster: context.config.cluster },
    keyValueRows([
      ["Wallet", wallet],
      ["Network", networkLabel(context.config.cluster)],
    ]),
  );
}

export async function showBalance(context: CommandContext): Promise<void> {
  const wallet = await requireWallet(context);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const response = await rpcRequest(
    rpc.getBalance(wallet, { commitment: context.config.commitment }),
    "balance lookup",
  );
  const lamports = BigInt(response.value as bigint);
  const data = {
    ok: true,
    address: wallet,
    cluster: context.config.cluster,
    lamports,
    sol: formatSol(lamports),
  };
  context.output.print(
    data,
    [
      sectionTitle("SOL BALANCE"),
      keyValueRows([
        ["Wallet", String(wallet)],
        ["Network", networkLabel(context.config.cluster)],
        ["Balance", `${formatSol(lamports)} SOL`, "emphasis"],
        ...(context.output.verbose
          ? [["Exact lamports", String(lamports)] as const]
          : []),
      ]),
    ].join("\n"),
  );
}

export async function showTokenList(
  context: CommandContext,
  includeAccounts = false,
): Promise<void> {
  const wallet = await requireWallet(context);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const accounts = await getTokenAccounts(
    rpc,
    wallet,
    context.config.commitment,
  );
  context.completion.tokenMints = [
    ...new Set(accounts.map((account) => account.mint)),
  ];
  const data = {
    ok: true,
    address: wallet,
    cluster: context.config.cluster,
    accounts,
  };
  const balances = aggregateTokenAccounts(accounts);
  const tokenRows = balances.length
    ? includeAccounts
      ? table(
          accounts.map((account) => [
            account.mint,
            account.uiAmount,
            account.program,
            account.address,
          ]),
          ["MINT", "ACCOUNT BALANCE", "TOKEN PROGRAM", "TOKEN ACCOUNT"],
        )
      : table(
          balances.map((balance) => [
            balance.mint,
            balance.amount,
            balance.program,
            String(balance.accountCount),
          ]),
          ["MINT", "BALANCE", "TOKEN PROGRAM", "ACCOUNTS"],
        )
    : "No SPL or Token-2022 token accounts found.";
  context.output.print(
    data,
    [
      sectionTitle("TOKEN ACCOUNTS"),
      keyValueRows([["Network", networkLabel(context.config.cluster)]]),
      tokenRows,
    ].join("\n"),
  );
}

export async function showTokenBalance(
  context: CommandContext,
  mint: string,
): Promise<void> {
  const wallet = await requireWallet(context);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const accounts = await getTokenAccounts(
    rpc,
    wallet,
    context.config.commitment,
  );
  const matches = accounts.filter((account) => account.mint === mint);
  context.completion.tokenMints = [
    ...new Set(accounts.map((account) => account.mint)),
  ];
  if (!matches.length) {
    const data = {
      ok: true,
      address: wallet,
      mint,
      rawAmount: "0",
      decimals: null,
      amount: "0",
    };
    context.output.print(
      data,
      [
        sectionTitle("TOKEN BALANCE"),
        keyValueRows([
          ["Network", networkLabel(context.config.cluster)],
          ["Mint", mint],
          ["Balance", "0", "emphasis"],
          ["Account", "No token account found for this mint."],
        ]),
      ].join("\n"),
    );
    return;
  }
  const balance = aggregateTokenAccounts(matches)[0]!;
  context.output.print(
    {
      ok: true,
      address: wallet,
      mint,
      rawAmount: balance.rawAmount,
      decimals: balance.decimals,
      amount: balance.amount,
      accountCount: balance.accountCount,
    },
    [
      sectionTitle("TOKEN BALANCE"),
      keyValueRows([
        ["Network", networkLabel(context.config.cluster)],
        ["Mint", mint],
        ["Balance", balance.amount, "emphasis"],
        ["Token accounts", String(balance.accountCount)],
        ...(context.output.verbose
          ? [["Raw amount", String(balance.rawAmount)] as const]
          : []),
      ]),
    ].join("\n"),
  );
}

export async function showValidators(
  context: CommandContext,
  options: { limit?: number; currentOnly: boolean; maxCommission?: number },
): Promise<void> {
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const rows = await listValidators(rpc, context.config.commitment, options);
  context.completion.recentValidators = rows.map((row) => row.voteAccount);
  context.output.print(
    {
      ok: true,
      cluster: context.config.cluster,
      sort: "activatedStake descending",
      validators: rows,
    },
    `${keyValueRows([["Network", networkLabel(context.config.cluster)]])}\n` +
      `${sectionTitle("VALIDATORS · SORTED BY ACTIVATED STAKE")}\n` +
      (rows.length
        ? table(
            rows.map((row) => [
              color(
                row.status,
                row.status === "current" ? "success" : "warning",
              ),
              color(
                `${row.commission}%`,
                row.commission === 100 ? "warning" : "emphasis",
              ),
              `${formatSol(row.activatedStake)} SOL`,
              row.voteAccount,
            ]),
            ["STATUS", "COMMISSION", "ACTIVATED STAKE", "VOTE ACCOUNT"],
          ) +
          "\nVote-account addresses are shown in full for use with stake create."
        : "No validators matched the filters."),
  );
}

export async function showConfig(context: CommandContext): Promise<void> {
  const rpcUrl = safeDisplayRpcUrl(context.config.rpcUrl);
  context.output.print(
    {
      ok: true,
      cluster: context.config.cluster,
      rpcUrl,
      commitment: context.config.commitment,
      configDir: context.config.configDir,
    },
    keyValueRows([
      ["Network", networkLabel(context.config.cluster)],
      ["RPC URL", rpcUrl],
      ["Commitment", context.config.commitment],
      ["Config directory", context.config.configDir],
    ]),
  );
}

function safeDisplayRpcUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname !== "/") return `${parsed.origin}/[REDACTED]`;
    return parsed.origin;
  } catch {
    return "[REDACTED]";
  }
}

export async function showHistory(context: CommandContext): Promise<void> {
  const lines = await readHistory(context.config.configDir);
  context.output.print(
    { ok: true, entries: lines },
    lines.join("\n") || "History is empty.",
  );
}
