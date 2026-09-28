import readline from "node:readline";
import { asAppError } from "../errors/errors.js";
import { executeLine } from "../commands/execute.js";
import type { CommandContext } from "../commands/context.js";
import { completeLine } from "./completion.js";
import { appendHistory, readHistory } from "./history.js";
import { shortenAddress } from "../output/human.js";
import { color, readlineColor } from "../output/terminal.js";
import { readRegistry, resolveWallet } from "../wallet/store.js";
import { hasFlag, parseCommand } from "./parser.js";
import { Output } from "../output/output.js";

/**
 * Interactive shell and piped-command runner.
 *
 * The readline interface is closed before a handler asks for a hidden secret
 * or confirmation. This avoids two readers competing for the same terminal.
 */
export async function runRepl(context: CommandContext): Promise<number> {
  if (!process.stdin.isTTY) return runPiped(context);

  if (!context.output.json) {
    process.stdout.write(`${color("Solana Wallet CLI", "heading")}\n`);
    try {
      const selected = context.session.currentWalletId
        ? await resolveWallet(
            context.config.configDir,
            context.session.currentWalletId,
          )
        : null;
      const registry = await readRegistry(context.config.configDir);
      const defaultWallet = registry.wallets.find(
        (wallet) => wallet.id === registry.defaultWalletId,
      );
      process.stdout.write(
        `${color("Wallet", "muted")}: ${selected ? `${color(selected.identity.alias, "success")} (${shortenAddress(selected.identity.address)})` : color("none selected", "warning")}\n`,
      );
      if (defaultWallet && defaultWallet.id !== selected?.identity.id)
        process.stdout.write(
          `${color("Default wallet", "muted")}: ${defaultWallet.alias} (${shortenAddress(defaultWallet.address)})\n`,
        );
      if (!selected)
        process.stdout.write(
          "No wallet selected. Start with `wallet import <alias>`, or run `wallet list` to choose an existing wallet.\n",
        );
    } catch {
      process.stdout.write(
        "Wallet: wallet store needs attention; use wallet migrate/recover or read docs/multiple-wallets.md\n",
      );
    }
    process.stdout.write(
      `${color("Network", "muted")}: ${color(context.config.cluster.toUpperCase(), context.config.cluster === "mainnet" ? "warning" : "info")}${context.config.cluster === "mainnet" ? color(" · REAL FUNDS", "warning") : ""}\nType \`help\` for commands, or \`status\` to refresh wallet balances.\n\n`,
    );
  }

  let history = await readHistory(context.config.configDir);
  while (true) {
    const prompt = await shellPrompt(context);
    try {
      const registry = await readRegistry(context.config.configDir);
      context.completion.walletAliases = registry.wallets.map(
        (wallet) => wallet.alias,
      );
    } catch {
      context.completion.walletAliases = [];
    }
    const rl = createInterface(context, history);
    rl.setPrompt(prompt);
    const line = await readInput(rl);
    if (line === null) {
      rl.close();
      return 0;
    }

    await appendHistory(context.config.configDir, line);
    // The command interface must not remain attached while a handler reads a
    // hidden passphrase or confirmation from the same TTY.
    rl.pause();
    rl.close();
    try {
      const result = await executeLine(context, line);
      if (result.exit) return 0;
    } catch (error) {
      reportCommandError(context, line, error);
    }
    history = await readHistory(context.config.configDir);
  }
}

async function runPiped(context: CommandContext): Promise<number> {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    await appendHistory(context.config.configDir, String(line));
    try {
      const result = await executeLine(context, String(line));
      if (result.exit) break;
    } catch (error) {
      reportCommandError(context, String(line), error);
    }
  }
  input.close();
  return 0;
}

function reportCommandError(
  context: CommandContext,
  line: string,
  error: unknown,
): void {
  let json = context.output.json;
  try {
    json ||= hasFlag(parseCommand(line), "json");
  } catch {
    // Preserve the parser error as the useful command diagnostic.
  }
  new Output({ json, verbose: context.output.verbose }).error(
    asAppError(error),
  );
}

function createInterface(
  context: CommandContext,
  history: string[],
): readline.Interface & { history: string[] } {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    historySize: 1000,
    completer: (line, callback) =>
      callback(null, completeLine(line, context.completion)),
  }) as readline.Interface & { history: string[] };
  rl.history = history;
  rl.on("SIGINT", () => {
    if (rl.line.length) {
      const editable = rl as readline.Interface & {
        line: string;
        cursor: number;
      };
      editable.line = "";
      editable.cursor = 0;
      process.stdout.write("\n");
      rl.prompt();
    } else {
      process.stdout.write("\n");
      rl.close();
    }
  });
  return rl;
}

function readInput(rl: readline.Interface): Promise<string | null> {
  if ((rl as readline.Interface & { closed?: boolean }).closed)
    return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      rl.removeListener("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(null);
    rl.once("close", onClose);
    try {
      rl.question(rl.getPrompt(), (line) => finish(line));
    } catch (error) {
      if (error instanceof Error && /readline was closed/i.test(error.message))
        finish(null);
      else reject(error);
    }
  });
}

export async function shellPrompt(context: CommandContext): Promise<string> {
  if (context.walletStoreError)
    return formatShellPrompt(context.config.cluster, "wallet-error");
  try {
    const selected = context.session.currentWalletId
      ? await resolveWallet(
          context.config.configDir,
          context.session.currentWalletId,
        )
      : null;
    if (!selected)
      return formatShellPrompt(context.config.cluster, "no-wallet");
    return formatShellPrompt(
      context.config.cluster,
      selected.identity.alias,
      selected.identity.address,
    );
  } catch {
    return formatShellPrompt(context.config.cluster, "wallet-error");
  }
}

/** Keep the selected cluster and wallet visible in every interactive prompt. */
export function formatShellPrompt(
  cluster: string,
  wallet: string,
  address?: string,
): string {
  const clusterTone = cluster === "mainnet" ? "warning" : "info";
  const walletTone =
    wallet === "no-wallet" || wallet === "wallet-error" ? "warning" : "success";
  return `sol-wallet [${readlineColor(cluster, clusterTone)} | ${readlineColor(wallet, walletTone)}${address ? ` | ${readlineColor(shortenAddress(address), "muted")}` : ""}]> `;
}
