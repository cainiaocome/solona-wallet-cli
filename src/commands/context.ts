import type { AppConfig } from "../config/config.js";
import { createClient, type SolanaClient } from "../solana/client.js";
import { Output, type OutputOptions } from "../output/output.js";
import type { CompletionCache } from "../shell/completion.js";
import { readSecret } from "../shell/prompt.js";

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
