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
import { historyFilePath, ensureConfigDir } from "../config/config.js";

const MAX_HISTORY = 1000;
const SECRET_WORD =
  /(?:private[-_ ]?key|secret[-_ ]?key|seed[-_ ]?phrase|mnemonic|password|passphrase)/i;

export function isSafeHistoryLine(line: string): boolean {
  return Boolean(line.trim()) && !SECRET_WORD.test(line);
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
