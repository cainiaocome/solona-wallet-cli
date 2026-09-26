const HELP: Record<string, string> = {
  "": `Commands:
  wallet import <alias> | wallet list | wallet info [alias] | wallet use <alias> | wallet default <alias> | wallet rename <old> <new>
  wallet migrate <alias> | wallet recover <uuid> <alias>
  address | balance
  send <destination> <amount>
  token list [--accounts] | token balance <mint> | token send <mint> <destination> <amount>
  validators [--limit n] [--include-delinquent] [--max-commission percent]
    (current validators only by default)
  stake create <amount> --validator <vote-account>
  stake list | stake deactivate <stake-account> | stake withdraw <stake-account> [--amount n]
  jupiter-lend status | jupiter-lend deposit <amount> | jupiter-lend withdraw <amount> | jupiter-lend withdraw --all
  tx inspect <signature>
  set cluster <mainnet|devnet> | set rpc-url <url> | set commitment <level>
  status | show config | history | clear | help [topic] | exit

Startup: sol-wallet [--wallet <alias>] [--cluster mainnet|devnet] [-c <command>]
Use \`sol-wallet --help\` for startup options.`,
  wallet: `wallet import <alias> [--keypair-file <path>]
wallet list
wallet info [<alias>]
wallet use <alias>                 (current process only)
wallet default <alias>             (future processes)
wallet rename <old> <new>
wallet migrate <alias>             (existing keystore.json)
wallet recover <uuid> <alias>      (orphan UUID keystore)

Use --wallet <alias> at startup to select a wallet for one process.
Aliases are local names; transactions always show and use the full address.`,
  show: "show config",
  address:
    "address\nShows the selected wallet address without unlocking the keystore.",
  balance:
    "balance\nShows the selected wallet's SOL balance. Use --verbose to include lamports.",
  send: "send <destination> <amount> [--dry-run] [--yes] [--json]",
  token:
    "token list [--accounts]\n  Aggregates balances by mint; --accounts shows each token account.\ntoken balance <mint>\ntoken send <mint> <destination> <amount> [--dry-run] [--yes]",
  validators:
    "validators [--limit <n>] [--include-delinquent] [--max-commission <percent>]\nDelinquent validators are excluded by default; use --include-delinquent to include them.",
  stake:
    "stake create <amount> --validator <vote-account>\nstake list\nstake deactivate <stake-account>\nstake withdraw <stake-account> [--amount <amount>]",
  "jupiter-lend":
    "jupiter-lend status\njupiter-lend deposit <amount> [--dry-run] [--yes]\njupiter-lend withdraw <amount> [--dry-run] [--yes]\njupiter-lend withdraw --all [--dry-run] [--yes]",
  tx: "tx inspect <signature>\nShows a human summary; add --json to see the complete RPC response.",
  set: "set cluster <mainnet|devnet>\nset rpc-url <url>\nset commitment <processed|confirmed|finalized>",
  status:
    "status\nChecks the configured RPC/network and shows the selected wallet's SOL and non-zero token balances. Failed balance reads are marked unavailable, never zero. Use show config for local configuration details.",
};

export function helpText(topic?: string): string {
  if (!topic) return HELP[""]!;
  return (
    HELP[topic] ?? `No detailed help is available for \`${topic}\`. Try help.`
  );
}
