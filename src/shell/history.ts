import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import bs58 from "bs58";
import { historyFilePath, ensureConfigDir } from "../config/config.js";

const MAX_HISTORY = 1000;
const SECRET_WORD =
  /(?:private[-_ ]?key|secret[-_ ]?key|seed[-_ ]?phrase|mnemonic|password|passphrase)/i;

export function isSafeHistoryLine(line: string): boolean {
  if (!line.trim() || SECRET_WORD.test(line)) return false;
  // A key pasted by mistake does not contain words like "private key".
  // Drop base58 strings that decode to Solana key sizes, and common raw hex or
  // JSON-byte-array encodings. Signatures also match 64-byte base58 and are
  // conservatively omitted from history for the same reason.
  for (const token of line.split(/\s+/)) {
    if (/^(?:[1-9A-HJ-NP-Za-km-z]{32,90})$/.test(token)) {
      try {
        const length = bs58.decode(token).length;
        if (length === 32 || length === 64) return false;
      } catch {
        // Not valid base58; continue checking other token encodings.
      }
    }
    if (/^(?:0x)?(?:[0-9a-f]{64}|[0-9a-f]{128})$/i.test(token)) return false;
  }
  if (/^\s*\[\s*(?:\d{1,3}\s*,\s*){31,63}\d{1,3}\s*\]\s*$/.test(line))
    return false;
  return true;
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
