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

  let history = await readHistory(context.config.configDir);
  while (true) {
    const rl = createInterface(context, history);
    await setPrompt(rl, context);
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
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      rl.removeListener("close", onClose);
      resolve(value);
    };
    const onClose = () => finish(null);
    rl.once("close", onClose);
    rl.question(rl.getPrompt(), (line) => finish(line));
  });
}

async function setPrompt(
  rl: readline.Interface,
  context: CommandContext,
): Promise<void> {
  const wallet = await getWalletAddress(context.config.configDir);
  const identity = wallet ? ` ${shortenAddress(wallet)}` : " no-wallet";
  rl.setPrompt(`sol-wallet [${context.config.cluster}${identity}]> `);
}
