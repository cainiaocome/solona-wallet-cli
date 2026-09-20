#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadConfig, type ConfigOverrides } from "./config/config.js";
import { clusterSchema, commitmentSchema } from "./config/schema.js";
import { asAppError, ConfigError } from "./errors/errors.js";
import { createCommandContext } from "./commands/context.js";
import { executeLine } from "./commands/execute.js";
import { runRepl } from "./shell/repl.js";

interface StartupOptions extends ConfigOverrides {
  command?: string;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): StartupOptions {
  const options: StartupOptions = {
    json: false,
    dryRun: false,
    yes: false,
    verbose: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = () => {
      const value = argv[++index];
      if (!value) throw new ConfigError(`${arg} requires a value.`);
      return value;
    };
    if (arg === "-c" || arg === "--command") options.command = next();
    else if (arg === "--cluster") {
      const value = clusterSchema.safeParse(next());
      if (!value.success)
        throw new ConfigError("--cluster must be mainnet-beta or devnet.");
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
    const config = await loadConfig(options);
    const context = createCommandContext(
      config,
      { json: options.json, verbose: options.verbose },
      { dryRun: options.dryRun, yes: options.yes, verbose: options.verbose },
    );
    if (options.command !== undefined) {
      await executeLine(context, options.command);
      return 0;
    }
    return await runRepl(context);
  } catch (error) {
    const appError = asAppError(error);
    if (parseJsonFlag(argv))
      process.stderr.write(
        `${JSON.stringify({ ok: false, error: appError.code, message: appError.message })}\n`,
      );
    else process.stderr.write(`Error: ${appError.message}\n`);
    return appError.exitCode;
  }
}

function parseJsonFlag(argv: string[]): boolean {
  return argv.includes("--json");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then((code) => (process.exitCode = code));
}
