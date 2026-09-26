const HELP: Record<string, string> = {
  "": `Commands:
  wallet import | wallet info
  address | balance
  send <destination> <amount>
  token list | token balance <mint> | token send <mint> <destination> <amount>
  validators [--limit n] [--current-only] [--max-commission percent]
  stake create <amount> --validator <vote-account>
  stake list | stake deactivate <stake-account> | stake withdraw <stake-account> [--amount n]
  jupiter-lend status | jupiter-lend deposit <amount> | jupiter-lend withdraw <amount> | jupiter-lend withdraw --all
  tx inspect <signature>
  set cluster <mainnet-beta|devnet> | set rpc-url <url> | set commitment <level>
  show config | history | clear | help | exit`,
  wallet: "wallet import [--keypair-file <path>]\nwallet info",
  show: "show config",
  address:
    "address\nShows the imported wallet address without unlocking the keystore.",
  balance: "balance\nShows the SOL balance and lamport count.",
  send: "send <destination> <amount> [--dry-run] [--yes] [--json]",
  token:
    "token list\ntoken balance <mint>\ntoken send <mint> <destination> <amount> [--dry-run] [--yes]",
  validators:
    "validators [--limit <n>] [--current-only] [--max-commission <percent>]",
  stake:
    "stake create <amount> --validator <vote-account>\nstake list\nstake deactivate <stake-account>\nstake withdraw <stake-account> [--amount <amount>]",
  "jupiter-lend":
    "jupiter-lend status\njupiter-lend deposit <amount> [--dry-run] [--yes]\njupiter-lend withdraw <amount> [--dry-run] [--yes]\njupiter-lend withdraw --all [--dry-run] [--yes]",
  tx: "tx inspect <signature>",
  set: "set cluster <mainnet-beta|devnet>\nset rpc-url <url>\nset commitment <processed|confirmed|finalized>",
};

export function helpText(topic?: string): string {
  if (!topic) return HELP[""]!;
  return (
    HELP[topic] ?? `No detailed help is available for \`${topic}\`. Try help.`
  );
}
