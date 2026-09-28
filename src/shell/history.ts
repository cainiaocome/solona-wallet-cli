import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createPrivateKey, createPublicKey } from "node:crypto";
import path from "node:path";
import bs58 from "bs58";
import { historyFilePath, ensureConfigDir } from "../config/config.js";
import { parseCommand, tokenize } from "./parser.js";

const MAX_HISTORY = 1000;
const SECRET_WORD =
  /(?:private[-_ ]?key|secret[-_ ]?key|seed[-_ ]?phrase|mnemonic|password|passphrase)/i;
const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export function isSafeHistoryLine(line: string): boolean {
  if (!line.trim() || SECRET_WORD.test(line)) return false;
  // A key pasted by mistake does not contain words like "private key". Keep
  // raw hex and JSON-byte-array encodings out of history, and reject base58
  // values unless they occupy a public-address or signature argument.
  if (/\[\s*(?:\d{1,3}\s*,\s*){31,63}\d{1,3}\s*\]/.test(line)) return false;
  let command: ReturnType<typeof parseCommand> | undefined;
  let tokens: string[];
  try {
    tokens = tokenize(line);
    command = parseCommand(line);
  } catch {
    // Malformed input cannot establish that a base58 value is public data.
    tokens = line
      .split(/\s+/)
      .map((token) => token.replace(/^["']|["']$/g, ""));
  }
  for (const token of tokens.flatMap((value) => {
    const equals = value.startsWith("--") ? value.indexOf("=") : -1;
    return equals >= 0 ? [value.slice(equals + 1)] : [value];
  })) {
    if (/^(?:[1-9A-HJ-NP-Za-km-z]{32,90})$/.test(token)) {
      try {
        const decoded = bs58.decode(token);
        if (isEd25519KeypairSecret(decoded)) return false;
        if (
          (decoded.length === 32 || decoded.length === 64) &&
          !isKnownPublicArgument(command, token, decoded.length)
        )
          return false;
      } catch {
        // Not valid base58; continue checking other token encodings.
      }
    }
    if (/^(?:0x)?(?:[0-9a-f]{64}|[0-9a-f]{128})$/i.test(token)) return false;
  }
  return true;
}

function isKnownPublicArgument(
  command: ReturnType<typeof parseCommand> | undefined,
  token: string,
  byteLength: number,
): boolean {
  if (!command) return false;
  const { name, args, flags } = command;
  if (byteLength === 64)
    return name === "tx" && args[0] === "inspect" && args[1] === token;
  if (name === "send") return args[0] === token;
  if (name === "token") {
    if (args[0] === "balance") return args[1] === token;
    if (args[0] === "send") return args[1] === token || args[2] === token;
  }
  if (name === "stake") {
    if (args[0] === "create") return flags.get("validator") === token;
    if (args[0] === "deactivate" || args[0] === "withdraw")
      return args[1] === token;
  }
  return false;
}

function isEd25519KeypairSecret(value: Uint8Array): boolean {
  if (value.length !== 64) return false;
  try {
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        ED25519_PKCS8_PREFIX,
        Buffer.from(value.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey(privateKey).export({
      format: "der",
      type: "spki",
    });
    return Buffer.from(publicKey)
      .subarray(-32)
      .equals(Buffer.from(value.subarray(32)));
  } catch {
    return false;
  }
}

export async function readHistory(configDir: string): Promise<string[]> {
  try {
    const content = await readFile(historyFilePath(configDir), "utf8");
    return content.split("\n").filter(isSafeHistoryLine).slice(-MAX_HISTORY);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function appendHistory(
  configDir: string,
  line: string,
): Promise<void> {
  if (!isSafeHistoryLine(line)) return;
  await ensureConfigDir(configDir);
  const target = historyFilePath(configDir);
  await appendFile(target, `${line.trim()}\n`, {
    mode: 0o600,
  });
  await chmod(target, 0o600);
  const lines = (await readFile(target, "utf8"))
    .split("\n")
    .filter(isSafeHistoryLine);
  if (lines.length <= MAX_HISTORY) return;

  const temporaryDirectory = await mkdtemp(path.join(configDir, ".history-"));
  const temporaryPath = path.join(temporaryDirectory, "history");
  try {
    await writeFile(
      temporaryPath,
      `${lines.slice(-MAX_HISTORY).join("\n")}\n`,
      {
        mode: 0o600,
      },
    );
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, target);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
