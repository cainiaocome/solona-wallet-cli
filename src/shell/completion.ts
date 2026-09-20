import { tokenize } from "./parser.js";

export interface CompletionCache {
  tokenMints: string[];
  stakeAccounts: string[];
  recentValidators: string[];
}

const topLevel = [
  "help",
  "address",
  "balance",
  "wallet",
  "send",
  "token",
  "validators",
  "stake",
  "tx",
  "set",
  "show",
  "history",
  "clear",
  "exit",
  "quit",
];
const nested: Record<string, string[]> = {
  wallet: ["import", "info"],
  token: ["list", "balance", "send"],
  stake: ["create", "list", "deactivate", "withdraw"],
  tx: ["inspect"],
  set: ["cluster", "rpc-url", "commitment"],
  show: ["config"],
};
const flags: Record<string, string[]> = {
  validators: ["--limit", "--current-only", "--max-commission", "--json"],
  send: ["--dry-run", "--yes", "--json"],
  "token send": ["--dry-run", "--yes", "--json"],
  "stake create": ["--validator", "--dry-run", "--yes", "--json"],
  "stake deactivate": ["--dry-run", "--yes", "--json"],
  "stake withdraw": ["--amount", "--dry-run", "--yes", "--json"],
};

export function completeLine(
  line: string,
  cache: CompletionCache,
): [string[], string] {
  const trailingSpace = /\s$/.test(line);
  const parts = tokenizeForCompletion(line);
  const partial = trailingSpace ? "" : (parts.pop() ?? "");
  const path = parts.join(" ");
  let candidates: string[] = [];
  if (!parts.length) candidates = topLevel;
  else if (parts.length === 1 && nested[parts[0]!] !== undefined)
    candidates = nested[parts[0]!]!;
  else {
    const command = parts.slice(0, 2).join(" ");
    if (partial.startsWith("--") || path.includes("--"))
      candidates = flags[command] ??
        flags[parts[0]!] ?? ["--json", "--dry-run", "--yes"];
    else if (command === "token balance" || command === "token send")
      candidates = cache.tokenMints;
    else if (command === "stake deactivate" || command === "stake withdraw")
      candidates = cache.stakeAccounts;
    else if (command === "stake create" && parts.includes("--validator"))
      candidates = cache.recentValidators;
  }
  const hits = candidates.filter((candidate) => candidate.startsWith(partial));
  return [hits, partial];
}

function tokenizeForCompletion(input: string): string[] {
  try {
    return tokenize(input);
  } catch {
    return input.trim().split(/\s+/).filter(Boolean);
  }
}
