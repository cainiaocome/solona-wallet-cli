import { AppError } from "../errors/errors.js";

/**
 * Shared command grammar for the REPL and `-c` mode.
 *
 * Tokenization is intentionally small and deterministic: quoted arguments and
 * `--flag=value` are supported, but the input is never passed to a shell. That
 * prevents command text from becoming an accidental operating-system command.
 */
export interface ParsedCommand {
  name: string;
  args: string[];
  flags: Map<string, string | true>;
  raw: string;
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "single" | "double" | undefined;
  let escaped = false;
  let started = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === "\\" && quote !== "single") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote === "single") {
      if (char === "'") quote = undefined;
      else current += char;
      started = true;
      continue;
    }
    if (quote === "double") {
      if (char === '"') quote = undefined;
      else current += char;
      started = true;
      continue;
    }
    if (char === "'") {
      quote = "single";
      started = true;
    } else if (char === '"') {
      quote = "double";
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (escaped)
    throw new AppError("Unterminated escape in command.", "ParseError", 2);
  if (quote)
    throw new AppError("Unterminated quote in command.", "ParseError", 2);
  if (started) tokens.push(current);
  return tokens;
}

export function parseCommand(raw: string): ParsedCommand {
  const tokens = tokenize(raw.trim());
  if (!tokens.length)
    throw new AppError("Enter a command, or type `help`.", "ParseError", 2);
  const [nameValue, ...rest] = tokens;
  const name = nameValue!;
  const args: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    if (!token.startsWith("--") || token === "--") {
      args.push(token);
      continue;
    }
    const withoutPrefix = token.slice(2);
    if (!withoutPrefix)
      throw new AppError(
        "A flag name is required after `--`.",
        "ParseError",
        2,
      );
    const equals = withoutPrefix.indexOf("=");
    if (equals >= 0) {
      const key = withoutPrefix.slice(0, equals);
      const value = withoutPrefix.slice(equals + 1);
      if (!value)
        throw new AppError(`Flag --${key} requires a value.`, "ParseError", 2);
      flags.set(key, value);
    } else {
      const next = rest[index + 1];
      if (next && !next.startsWith("--") && expectsFlagValue(withoutPrefix)) {
        flags.set(withoutPrefix, next);
        index += 1;
      } else {
        flags.set(withoutPrefix, true);
      }
    }
  }
  return { name, args, flags, raw };
}

const valueFlags = new Set([
  "validator",
  "amount",
  "limit",
  "max-commission",
  "rpc-url",
  "cluster",
  "commitment",
  "keypair-file",
]);

function expectsFlagValue(flag: string): boolean {
  return valueFlags.has(flag);
}

export function flagValue(
  command: ParsedCommand,
  name: string,
): string | undefined {
  const value = command.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function hasFlag(command: ParsedCommand, name: string): boolean {
  return command.flags.has(name);
}

export function requireArgs(
  command: ParsedCommand,
  count: number,
  usage: string,
): void {
  if (command.args.length < count)
    throw new AppError(`Usage: ${usage}`, "ParseError", 2);
}

export function rejectExtraArgs(
  command: ParsedCommand,
  count: number,
  usage: string,
): void {
  if (command.args.length !== count)
    throw new AppError(`Usage: ${usage}`, "ParseError", 2);
}
