import readline from "node:readline";
import { asAppError } from "../errors/errors.js";
import { executeLine } from "../commands/execute.js";
import type { CommandContext } from "../commands/context.js";
import { completeLine } from "./completion.js";
import { appendHistory, readHistory } from "./history.js";
import { shortenAddress } from "../output/human.js";
import { getWalletAddress } from "../wallet/signer.js";

export async function runRepl(context: CommandContext): Promise<number> {
  process.stdout.write("Solana Wallet CLI\n");
  process.stdout.write("Type `help` for commands.\n\n");

  if (!process.stdin.isTTY) return runPiped(context);

  let history = await readHistory(context.config.configDir);
  while (true) {
    const prompt = await shellPrompt(context);
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
      context.output.error(asAppError(error));
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
      context.output.error(asAppError(error));
    }
  }
  input.close();
  return 0;
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

async function shellPrompt(context: CommandContext): Promise<string> {
  const wallet = await getWalletAddress(context.config.configDir);
  const identity = wallet ? ` ${shortenAddress(wallet)}` : " no-wallet";
  return `sol-wallet [${context.config.cluster}${identity}]> `;
}
