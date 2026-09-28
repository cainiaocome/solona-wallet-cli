#!/usr/bin/env node

/**
 * Process entry point.
 *
 * This file intentionally does very little feature work. It translates startup
 * flags into configuration, creates the shared command context, then chooses
 * between one-shot (`-c`) and interactive shell execution. Keeping the top
 * level small makes it harder for a new feature to bypass the normal parser,
 * output, or error handling paths.
 */
import { pathToFileURL } from "node:url";
import type { ConfigOverrides } from "./config/config.js";
import { clusterSchema, commitmentSchema } from "./config/schema.js";
import { asAppError, ConfigError, redact } from "./errors/errors.js";
import { hasFlag, parseCommand } from "./shell/parser.js";
import type { selectWallet as selectWalletType } from "./wallet/store.js";
import { color } from "./output/terminal.js";

interface StartupOptions extends ConfigOverrides {
  command?: string;
  wallet?: string;
  help: boolean;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): StartupOptions {
  const options: StartupOptions = {
    json: false,
    help: false,
    dryRun: false,
    yes: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith("--"))
        throw new ConfigError(`${arg} requires a value.`);
      return value;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "-c" || arg === "--command") options.command = next();
    else if (arg === "--wallet") {
      if (options.wallet !== undefined)
        throw new ConfigError("--wallet may be specified only once.");
      options.wallet = next();
    } else if (arg === "--cluster") {
      const value = clusterSchema.safeParse(next());
      if (!value.success)
        throw new ConfigError("--cluster must be mainnet or devnet.");
      options.cluster = value.data;
    } else if (arg === "--rpc-url") options.rpcUrl = next();
    else if (arg === "--commitment") {
      const value = commitmentSchema.safeParse(next());
      if (!value.success)
        throw new ConfigError(
          "--commitment must be processed, confirmed, or finalized.",
        );
      options.commitment = value.data;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes") options.yes = true;
    else if (arg === "--verbose") options.verbose = true;
    else throw new ConfigError(`Unknown option: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(startupHelpText());
      return 0;
    }
    if (options.json && options.command === undefined)
      throw new ConfigError("--json requires a one-shot command with -c.");
    const [{ loadConfig }, { selectWallet }, { createCommandContext }] =
      await Promise.all([
        import("./config/config.js"),
        import("./wallet/store.js"),
        import("./commands/context.js"),
      ]);
    const config = await loadConfig(options);
    let selected: Awaited<ReturnType<typeof selectWalletType>> | undefined;
    let walletStoreError;
    try {
      selected = await selectWallet(config, options.wallet);
    } catch (error) {
      if (options.wallet !== undefined) throw error;
      const appError = asAppError(error);
      walletStoreError = appError;
      if (process.stdin.isTTY && !options.json)
        process.stderr.write(
          `${color("Wallet store", "warning", { stream: "stderr" })}: ${appError.message}\n`,
        );
    }
    const context = createCommandContext(
      config,
      { json: options.json, verbose: options.verbose },
      {
        dryRun: options.dryRun,
        yes: options.yes,
        verbose: options.verbose,
        currentWalletId: selected?.wallet?.identity.id ?? null,
        executionMode:
          options.command !== undefined
            ? "oneshot"
            : process.stdin.isTTY
              ? "interactive"
              : "piped",
      },
    );
    context.walletStoreError = walletStoreError;
    if (options.command !== undefined) {
      const { executeLine } = await import("./commands/execute.js");
      await executeLine(context, options.command);
      return 0;
    }
    const { runRepl } = await import("./shell/repl.js");
    return await runRepl(context);
  } catch (error) {
    const appError = asAppError(error);
    if (parseJsonFlag(argv)) {
      const { stringifyJson } = await import("./output/json.js");
      process.stderr.write(
        `${stringifyJson({
          ok: false,
          error: appError.code,
          message: appError.message,
          ...(appError.details ? { details: redact(appError.details) } : {}),
        })}\n`,
      );
    } else
      process.stderr.write(
        `${color("Error", "error", { stream: "stderr" })}: ${appError.message}\n`,
      );
    return appError.exitCode;
  }
}

function startupHelpText(): string {
  return `Solana Wallet CLI\n\nUsage: sol-wallet [options]\n\nOptions:\n  -h, --help                 Show this help\n  -c, --command <command>   Run one command and exit\n      --wallet <alias>      Select a wallet for this process\n      --cluster <network>   Select mainnet or devnet\n      --rpc-url <url>       Use a custom RPC endpoint\n      --commitment <level>  processed, confirmed, or finalized\n      --json                Emit machine-readable output (requires -c)\n      --dry-run             Simulate writes without broadcasting\n      --yes                 Skip confirmation after validation and simulation\n      --verbose             Include technical details where available\n\nExamples:\n  sol-wallet\n  sol-wallet --wallet savings\n  sol-wallet -c "status" --json\n\nInside the interactive shell, type help [topic] to see commands.\n`;
}

function parseJsonFlag(argv: string[]): boolean {
  if (argv.includes("--json")) return true;
  let commandHasJson = false;
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] !== "-c" && argv[index] !== "--command") continue;
    try {
      commandHasJson = hasFlag(parseCommand(argv[index + 1]!), "json");
    } catch {
      commandHasJson = false;
    }
  }
  return commandHasJson;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then((code) => (process.exitCode = code));
}
