import { address, type Address } from "@solana/kit";
import {
  AppError,
  InsufficientBalanceError,
  RpcError,
} from "../errors/errors.js";
import { formatSol, formatUnits } from "../solana/amounts.js";
import { rpcRequest } from "../solana/rpc.js";
import { getTokenAccounts } from "../solana/tokens.js";
import { listValidators } from "../solana/validators.js";
import { getWalletAddress } from "../wallet/signer.js";
import { readHistory } from "../shell/history.js";
import type { CommandContext } from "./context.js";

export async function requireWallet(context: CommandContext): Promise<Address> {
  const wallet = await getWalletAddress(context.config.configDir);
  if (!wallet)
    throw new AppError(
      "No wallet is imported. Run `wallet import`.",
      "KeystoreError",
      1,
    );
  return address(wallet);
}

export async function showAddress(context: CommandContext): Promise<void> {
  const wallet = await getWalletAddress(context.config.configDir);
  if (!wallet)
    throw new AppError(
      "No wallet is imported. Run `wallet import`.",
      "KeystoreError",
      1,
    );
  context.output.print(
    { ok: true, address: wallet, cluster: context.config.cluster },
    `Address: ${wallet}\nCluster: ${context.config.cluster}`,
  );
}

export async function showBalance(context: CommandContext): Promise<void> {
  const wallet = await requireWallet(context);
  const response = await rpcRequest(
    context
      .getClient()
      .rpc.getBalance(wallet, { commitment: context.config.commitment }),
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
    `Address:  ${wallet}\nCluster:  ${context.config.cluster}\nBalance:  ${formatSol(lamports)} SOL\nLamports: ${lamports}`,
  );
}

export async function showTokenList(context: CommandContext): Promise<void> {
  const wallet = await requireWallet(context);
  const accounts = await getTokenAccounts(
    context.getClient().rpc,
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
  const human = accounts.length
    ? accounts
        .map(
          (account) =>
            `${account.mint}  ${account.program}  ${account.address}  ${account.uiAmount}  decimals=${account.decimals} raw=${account.rawAmount}`,
        )
        .join("\n")
    : "No SPL or Token-2022 accounts found.";
  context.output.print(data, human);
}

export async function showTokenBalance(
  context: CommandContext,
  mint: string,
): Promise<void> {
  const wallet = await requireWallet(context);
  const accounts = await getTokenAccounts(
    context.getClient().rpc,
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
    context.output.print(data, `0 ${mint}`);
    return;
  }
  const rawAmount = matches.reduce(
    (sum, account) => sum + account.rawAmount,
    0n,
  );
  const decimals = matches[0]!.decimals;
  const amount = formatUnits(rawAmount, decimals);
  context.output.print(
    { ok: true, address: wallet, mint, rawAmount, decimals, amount },
    `${amount} ${mint}`,
  );
}

export async function showValidators(
  context: CommandContext,
  options: { limit?: number; currentOnly: boolean; maxCommission?: number },
): Promise<void> {
  const rows = await listValidators(
    context.getClient().rpc,
    context.config.commitment,
    options,
  );
  context.completion.recentValidators = rows.map((row) => row.voteAccount);
  context.output.print(
    {
      ok: true,
      cluster: context.config.cluster,
      sort: "activatedStake descending",
      validators: rows,
    },
    rows.length
      ? rows
          .map(
            (row) =>
              `${row.status.padEnd(10)} ${row.voteAccount}  commission=${row.commission}%  stake=${formatSol(row.activatedStake)} SOL`,
          )
          .join("\n")
      : "No validators matched the filters.",
  );
}

export async function showConfig(context: CommandContext): Promise<void> {
  context.output.print(
    {
      ok: true,
      cluster: context.config.cluster,
      rpcUrl: context.config.rpcUrl,
      commitment: context.config.commitment,
      configDir: context.config.configDir,
    },
    `Cluster: ${context.config.cluster}\nRPC URL: ${context.config.rpcUrl}\nCommitment: ${context.config.commitment}\nConfig directory: ${context.config.configDir}`,
  );
}

export async function showWalletInfo(context: CommandContext): Promise<void> {
  const file = await getWalletAddress(context.config.configDir);
  if (!file)
    throw new AppError(
      "No wallet is imported. Run `wallet import`.",
      "KeystoreError",
      1,
    );
  context.output.print(
    { ok: true, address: file, cluster: context.config.cluster },
    `Address: ${file}\nCluster: ${context.config.cluster}\nPrivate key: encrypted at rest`,
  );
}

export async function showHistory(context: CommandContext): Promise<void> {
  const lines = await readHistory(context.config.configDir);
  context.output.print(
    { ok: true, entries: lines },
    lines.join("\n") || "History is empty.",
  );
}
