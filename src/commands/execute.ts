import { address } from "@solana/kit";
import { setSessionCluster } from "../config/config.js";
import { AppError } from "../errors/errors.js";
import { formatSol } from "../solana/amounts.js";
import { assertRpcCluster, rpcRequest } from "../solana/rpc.js";
import { completeLine } from "../shell/completion.js";
import {
  flagValue,
  hasFlag,
  parseCommand,
  rejectExtraArgs,
  requireArgs,
  type ParsedCommand,
} from "../shell/parser.js";
import { helpText } from "../shell/help.js";
import { readHistory } from "../shell/history.js";
import { Output } from "../output/output.js";
import { importWallet } from "./wallet-import.js";
import type { CommandContext } from "./context.js";
import {
  showAddress,
  showBalance,
  showConfig,
  showHistory,
  showTokenBalance,
  showTokenList,
  showValidators,
  showWalletInfo,
} from "./read-only.js";
import { sendSol } from "./send.js";
import { sendToken } from "./token-send.js";
import { lendDeposit, lendStatus, lendWithdraw } from "./lending.js";
import {
  stakeCreate,
  stakeDeactivate,
  stakeList,
  stakeWithdraw,
} from "./staking.js";

/**
 * Central command dispatcher used by both interactive and one-shot commands.
 *
 * Validation belongs before the feature handlers: a handler should receive a
 * well-shaped command and then focus on Solana/protocol behavior. Write
 * handlers still perform their own domain validation, because an argument can
 * be syntactically valid and financially unsafe.
 */
export interface ExecutionResult {
  exit: boolean;
}

const TOP_LEVEL = [
  "help",
  "address",
  "balance",
  "wallet",
  "send",
  "token",
  "validators",
  "stake",
  "jupiter-lend",
  "tx",
  "set",
  "show",
  "history",
  "clear",
  "exit",
  "quit",
];

export async function executeLine(
  context: CommandContext,
  raw: string,
): Promise<ExecutionResult> {
  return executeParsed(context, parseCommand(raw));
}

export async function executeParsed(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  validateFlags(command);
  const previousOutput = context.output;
  context.output = new Output({
    json: previousOutput.json || hasFlag(command, "json"),
    verbose: previousOutput.verbose,
  });
  try {
    const name = command.name.toLowerCase();
    if (name === "q") return { exit: true };
    if (name === "cls") {
      if (context.output.json)
        context.output.print({ ok: true, cleared: true });
      else process.stdout.write("\u001b[2J\u001b[H");
      return { exit: false };
    }
    if (name === "bal")
      return executeParsed(context, { ...command, name: "balance" });
    switch (name) {
      case "help":
        context.output.print(
          { ok: true, help: helpText(command.args.join(" ") || undefined) },
          helpText(command.args.join(" ") || undefined),
        );
        return { exit: false };
      case "address":
        rejectExtraArgs(command, 0, "address");
        await showAddress(context);
        return { exit: false };
      case "balance":
        rejectExtraArgs(command, 0, "balance");
        await showBalance(context);
        return { exit: false };
      case "wallet":
        if (command.args.length === 0) {
          displayTopicHelp(context, "wallet");
          return { exit: false };
        }
        requireArgs(
          command,
          1,
          "wallet import [--keypair-file <path>] | wallet info",
        );
        if (command.args[0] === "import") await importWallet(context, command);
        else if (command.args[0] === "info") await showWalletInfo(context);
        else throw unknownCommand(`${command.name} ${command.args[0]}`);
        return { exit: false };
      case "send":
        rejectExtraArgs(
          command,
          2,
          "send <destination> <amount> [--dry-run] [--yes]",
        );
        await sendSol(
          context,
          command.args[0]!,
          command.args[1]!,
          hasFlag(command, "dry-run") || context.session.dryRun,
          hasFlag(command, "yes") || context.session.yes,
        );
        return { exit: false };
      case "token":
        return executeToken(context, command);
      case "validators":
        rejectExtraArgs(
          command,
          0,
          "validators [--limit <n>] [--current-only] [--max-commission <percent>]",
        );
        await showValidators(context, {
          limit: parseOptionalInteger(flagValue(command, "limit"), "limit", 1),
          currentOnly: hasFlag(command, "current-only"),
          maxCommission: parseOptionalNumber(
            flagValue(command, "max-commission"),
            "max-commission",
          ),
        });
        return { exit: false };
      case "set":
        return executeSet(context, command);
      case "show":
        rejectExtraArgs(command, 1, "show config");
        if (command.args[0] !== "config")
          throw unknownCommand(`show ${command.args[0]}`);
        await showConfig(context);
        return { exit: false };
      case "history":
        rejectExtraArgs(command, 0, "history");
        await showHistory(context);
        return { exit: false };
      case "clear":
        rejectExtraArgs(command, 0, "clear");
        if (context.output.json)
          context.output.print({ ok: true, cleared: true });
        else process.stdout.write("\u001b[2J\u001b[H");
        return { exit: false };
      case "exit":
      case "quit":
        rejectExtraArgs(command, 0, `${name}`);
        return { exit: true };
      case "tx":
        return executeTx(context, command);
      case "stake":
        return executeStake(context, command);
      case "jupiter-lend":
        return executeJupiterLend(context, command);
      default:
        throw unknownCommand(command.name);
    }
  } finally {
    context.output = previousOutput;
  }
}

async function executeStake(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  const subcommand = command.args[0];
  if (!subcommand) {
    displayTopicHelp(context, "stake");
    return { exit: false };
  }
  const args = { ...command, args: command.args.slice(1) };
  if (subcommand === "create") await stakeCreate(context, args);
  else if (subcommand === "list") {
    rejectExtraArgs(args, 0, "stake list");
    await stakeList(context);
  } else if (subcommand === "deactivate") await stakeDeactivate(context, args);
  else if (subcommand === "withdraw") await stakeWithdraw(context, args);
  else throw unknownCommand(`stake ${subcommand ?? ""}`.trim());
  return { exit: false };
}

async function executeToken(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  const subcommand = command.args[0];
  if (!subcommand) {
    displayTopicHelp(context, "token");
    return { exit: false };
  }
  const args = { ...command, args: command.args.slice(1) };
  if (subcommand === "list") {
    rejectExtraArgs(args, 0, "token list");
    await showTokenList(context);
  } else if (subcommand === "balance") {
    rejectExtraArgs(args, 1, "token balance <mint>");
    await showTokenBalance(context, args.args[0]!);
  } else if (subcommand === "send") {
    rejectExtraArgs(
      args,
      3,
      "token send <mint> <destination> <amount> [--dry-run] [--yes]",
    );
    await sendToken(
      context,
      args.args[0]!,
      args.args[1]!,
      args.args[2]!,
      hasFlag(command, "dry-run") || context.session.dryRun,
      hasFlag(command, "yes") || context.session.yes,
    );
  } else throw unknownCommand(`token ${subcommand ?? ""}`.trim());
  return { exit: false };
}

async function executeJupiterLend(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  const subcommand = command.args[0];
  if (!subcommand) {
    displayTopicHelp(context, "jupiter-lend");
    return { exit: false };
  }
  const args = { ...command, args: command.args.slice(1) };
  if (subcommand === "status") {
    rejectExtraArgs(args, 0, "jupiter-lend status");
    await lendStatus(context);
  } else if (subcommand === "deposit") {
    rejectExtraArgs(
      args,
      1,
      "jupiter-lend deposit <amount> [--dry-run] [--yes]",
    );
    await lendDeposit(context, args);
  } else if (subcommand === "withdraw") {
    await lendWithdraw(context, args);
  } else throw unknownCommand(`jupiter-lend ${subcommand ?? ""}`.trim());
  return { exit: false };
}

async function executeSet(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  rejectExtraArgs(
    command,
    2,
    "set cluster <mainnet-beta|devnet> | set rpc-url <url> | set commitment <level>",
  );
  const field = command.args[0];
  const value = command.args[1]!;
  if (field === "cluster" && (value === "mainnet-beta" || value === "devnet")) {
    setSessionCluster(context.config, value);
    context.output.print(
      { ok: true, cluster: value, rpcUrl: context.config.rpcUrl },
      `CLUSTER CHANGED TO ${value.toUpperCase()} (session only)\nRPC URL: ${context.config.rpcUrl}`,
    );
  } else if (field === "rpc-url") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new Error("unsupported protocol");
    } catch {
      throw new AppError("RPC URL must use http or https.", "ConfigError", 2);
    }
    context.config.rpcUrl = value;
    context.output.print(
      { ok: true, rpcUrl: value },
      `RPC URL changed for this session: ${value}`,
    );
  } else if (
    field === "commitment" &&
    ["processed", "confirmed", "finalized"].includes(value)
  ) {
    context.config.commitment = value as typeof context.config.commitment;
    context.output.print(
      { ok: true, commitment: value },
      `Commitment changed for this session: ${value}`,
    );
  } else throw new AppError("Invalid session setting.", "ConfigError", 2);
  return { exit: false };
}

async function executeTx(
  context: CommandContext,
  command: ParsedCommand,
): Promise<ExecutionResult> {
  if (command.args.length === 0) {
    displayTopicHelp(context, "tx");
    return { exit: false };
  }
  rejectExtraArgs(command, 2, "tx inspect <signature>");
  if (command.args[0] !== "inspect")
    throw unknownCommand(`tx ${command.args[0]}`);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const response = await rpcRequest(
    rpc.getTransaction(command.args[1]! as never, {
      commitment: context.config.commitment,
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    }),
    "transaction lookup",
  );
  context.output.print(
    { ok: true, signature: command.args[1], transaction: response },
    response
      ? JSON.stringify(
          response,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        )
      : "Transaction not found.",
  );
  return { exit: false };
}

function displayTopicHelp(context: CommandContext, topic: string): void {
  const help = helpText(topic);
  context.output.print({ ok: true, help }, help);
}

function parseOptionalInteger(
  value: string | undefined,
  label: string,
  minimum = 0,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value))
    throw new AppError(
      `${label} must be a non-negative integer.`,
      "ParseError",
      2,
    );
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new AppError(`${label} is too large.`, "ParseError", 2);
  if (parsed < minimum)
    throw new AppError(
      `${label} must be at least ${minimum}.`,
      "ParseError",
      2,
    );
  return parsed;
}

function parseOptionalNumber(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
    throw new AppError(`${label} must be between 0 and 100.`, "ParseError", 2);
  return parsed;
}

function unknownCommand(value: string): AppError {
  const suggestion = [...TOP_LEVEL].sort(
    (a, b) => levenshtein(value, a) - levenshtein(value, b),
  )[0];
  const suffix =
    suggestion && levenshtein(value, suggestion) <= 3
      ? `\nDid you mean: ${suggestion}?`
      : "";
  return new AppError(`Unknown command: ${value}${suffix}`, "ParseError", 2);
}

function validateFlags(command: ParsedCommand): void {
  const name = command.name.toLowerCase();
  const subcommand = command.args[0]?.toLowerCase();
  const allowed = new Set(["json"]);
  if (name === "send") {
    allowed.add("dry-run");
    allowed.add("yes");
  } else if (name === "validators") {
    allowed.add("limit");
    allowed.add("current-only");
    allowed.add("max-commission");
  } else if (name === "wallet" && subcommand === "import") {
    allowed.add("keypair-file");
  } else if (name === "token" && subcommand === "send") {
    allowed.add("dry-run");
    allowed.add("yes");
  } else if (name === "jupiter-lend") {
    if (subcommand === "deposit" || subcommand === "withdraw") {
      allowed.add("dry-run");
      allowed.add("yes");
    }
    if (subcommand === "withdraw") allowed.add("all");
  } else if (name === "stake") {
    if (subcommand === "create") allowed.add("validator");
    if (subcommand === "withdraw") allowed.add("amount");
    if (["create", "deactivate", "withdraw"].includes(subcommand ?? "")) {
      allowed.add("dry-run");
      allowed.add("yes");
    }
  }
  for (const flag of command.flags.keys())
    if (!allowed.has(flag))
      throw new AppError(`Unknown flag: --${flag}`, "ParseError", 2);

  const booleanFlags = new Set([
    "json",
    "dry-run",
    "yes",
    "current-only",
    "all",
  ]);
  const valueFlags = new Set([
    "limit",
    "max-commission",
    "keypair-file",
    "validator",
    "amount",
  ]);
  for (const [flag, value] of command.flags) {
    if (booleanFlags.has(flag) && value !== true)
      throw new AppError(`--${flag} does not accept a value.`, "ParseError", 2);
    if (valueFlags.has(flag) && value === true)
      throw new AppError(`--${flag} requires a value.`, "ParseError", 2);
  }
}

function levenshtein(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[right.length]!;
}
