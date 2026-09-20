import type { AppConfig } from "../config/config.js";
import { createClient, type SolanaClient } from "../solana/client.js";
import { Output, type OutputOptions } from "../output/output.js";
import type { CompletionCache } from "../shell/completion.js";
import { readSecret } from "../shell/prompt.js";

/**
 * Dependencies and session state shared by every command handler.
 *
 * A handler receives this object instead of reaching into process globals. In
 * addition to making tests easier, this keeps configuration, output mode, and
 * the passphrase prompt consistent between the REPL and `-c` mode.
 */
export interface CommandContext {
  config: AppConfig;
  output: Output;
  completion: CompletionCache;
  session: { dryRun: boolean; yes: boolean; verbose: boolean };
  getClient(): SolanaClient;
  readPassphrase(): Promise<string>;
}

export function createCommandContext(
  config: AppConfig,
  outputOptions: OutputOptions,
  session = { dryRun: false, yes: false, verbose: outputOptions.verbose },
): CommandContext {
  return {
    config,
    output: new Output(outputOptions),
    completion: { tokenMints: [], stakeAccounts: [], recentValidators: [] },
    session,
    getClient: () => createClient(config),
    readPassphrase: () => readSecret("Keystore passphrase: "),
  };
}
