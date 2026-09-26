import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { ConfigError } from "../errors/errors.js";
import {
  commitmentSchema,
  defaultRpcUrl,
  fileConfigSchema,
  clusterSchema,
  type Cluster,
  type Commitment,
} from "./schema.js";

/**
 * Runtime configuration is deliberately non-secret.
 *
 * This module resolves the network, RPC endpoint, commitment, and local state
 * directory. Private keys and passphrases never belong in this precedence
 * chain; they are handled only by the wallet/keystore modules.
 */
export interface AppConfig {
  cluster: Cluster;
  rpcUrl: string;
  commitment: Commitment;
  configDir: string;
}

export interface ConfigOverrides {
  cluster?: Cluster;
  rpcUrl?: string;
  commitment?: Commitment;
  configDir?: string;
}

export function setSessionCluster(config: AppConfig, cluster: Cluster): void {
  const currentRpcIsDefault = config.rpcUrl === defaultRpcUrl(config.cluster);
  if (!currentRpcIsDefault && cluster !== config.cluster)
    throw new ConfigError(
      "An explicit RPC URL is pinned for this session. Run `set rpc-url` explicitly before switching clusters.",
    );
  config.cluster = cluster;
  if (currentRpcIsDefault) config.rpcUrl = defaultRpcUrl(cluster);
}

export function defaultConfigDir(): string {
  return path.join(os.homedir(), ".config", "sol-wallet");
}

export function configFilePath(configDir: string): string {
  return path.join(configDir, "config.json");
}

/** Legacy v0.2 source path; normal wallet operation never reads this file. */
export function legacyKeystoreFilePath(configDir: string): string {
  return path.join(configDir, "keystore.json");
}

/** Resolve the UUID-named encrypted keystore without using a user alias as a path. */
export function walletKeystorePath(configDir: string, id: string): string {
  return path.join(configDir, "wallets", `${id}.json`);
}

export function walletRegistryPath(configDir: string): string {
  return path.join(configDir, "wallets.json");
}

export function walletDirectoryPath(configDir: string): string {
  return path.join(configDir, "wallets");
}

export function walletLockPath(configDir: string): string {
  return path.join(configDir, ".wallet-store.lock");
}

export function scopedStakeRegistryPath(
  configDir: string,
  walletId: string,
  cluster: Cluster,
): string {
  return path.join(configDir, "stake-accounts", walletId, `${cluster}.json`);
}

export function historyFilePath(configDir: string): string {
  return path.join(configDir, "history");
}

function checkedUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("unsupported protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new ConfigError(`Invalid RPC URL: ${value}`);
  }
}

export async function ensureConfigDir(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);
}

export async function loadConfig(
  overrides: ConfigOverrides = {},
): Promise<AppConfig> {
  dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });
  const configDir =
    overrides.configDir ??
    process.env.SOL_WALLET_CONFIG_DIR ??
    defaultConfigDir();
  await ensureConfigDir(configDir);

  let fileConfig: {
    cluster?: Cluster;
    rpcUrl?: string;
    commitment?: Commitment;
  } = {};
  try {
    const raw = await readFile(configFilePath(configDir), "utf8");
    const parsed = fileConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new ConfigError(`Invalid config file: ${parsed.error.message}`);
    fileConfig = parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const envCluster = process.env.SOL_WALLET_CLUSTER
    ? clusterSchema.safeParse(process.env.SOL_WALLET_CLUSTER)
    : undefined;
  const envCommitment = process.env.SOL_WALLET_COMMITMENT
    ? commitmentSchema.safeParse(process.env.SOL_WALLET_COMMITMENT)
    : undefined;
  if (envCluster && !envCluster.success)
    throw new ConfigError("SOL_WALLET_CLUSTER must be mainnet or devnet.");
  if (envCommitment && !envCommitment.success)
    throw new ConfigError(
      "SOL_WALLET_COMMITMENT must be processed, confirmed, or finalized.",
    );

  const cluster =
    overrides.cluster ?? envCluster?.data ?? fileConfig.cluster ?? "mainnet";
  const rpcUrl = checkedUrl(
    overrides.rpcUrl ??
      process.env.SOL_WALLET_RPC_URL ??
      fileConfig.rpcUrl ??
      defaultRpcUrl(cluster),
  );
  const commitment =
    overrides.commitment ??
    envCommitment?.data ??
    fileConfig.commitment ??
    "confirmed";
  return { cluster, rpcUrl, commitment, configDir };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir(config.configDir);
  const content = `${JSON.stringify({ version: 1, cluster: config.cluster, rpcUrl: config.rpcUrl, commitment: config.commitment }, null, 2)}\n`;
  await writeFile(configFilePath(config.configDir), content, { mode: 0o600 });
  await chmod(configFilePath(config.configDir), 0o600);
}
