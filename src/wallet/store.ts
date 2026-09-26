/**
 * Public wallet metadata and filesystem transactions.
 *
 * Aliases never become paths. A wallet's stable UUID names its encrypted
 * keystore, while this registry stores only the alias/default relationship.
 */
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  link,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { address } from "@solana/kit";
import { z } from "zod";
import {
  legacyKeystoreFilePath,
  walletDirectoryPath,
  walletKeystorePath,
  walletLockPath,
  walletRegistryPath,
  type AppConfig,
} from "../config/config.js";
import { readKeystoreFile } from "./keystore.js";
import { WalletStoreError } from "../errors/errors.js";

const uuidSchema = z
  .string()
  .uuid()
  .refine((id) => id === id.toLowerCase());
const aliasSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const entrySchema = z
  .object({
    id: uuidSchema,
    alias: aliasSchema,
    address: z.string().min(32).max(44),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((entry, context) => {
    try {
      if (String(address(entry.address)) !== entry.address)
        throw new Error("noncanonical address");
    } catch {
      context.addIssue({ code: "custom", message: "Invalid wallet address." });
    }
  });

export const walletRegistrySchema = z
  .object({
    version: z.literal(1),
    defaultWalletId: uuidSchema.nullable(),
    wallets: z.array(entrySchema),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    const aliases = new Set<string>();
    const addresses = new Set<string>();
    for (const wallet of registry.wallets) {
      for (const [set, value, label] of [
        [ids, wallet.id, "ID"],
        [aliases, wallet.alias, "alias"],
        [addresses, wallet.address, "address"],
      ] as const) {
        if (set.has(value))
          context.addIssue({
            code: "custom",
            message: `Duplicate wallet ${label}: ${value}`,
          });
        set.add(value);
      }
    }
    if ((registry.wallets.length === 0) !== (registry.defaultWalletId === null))
      context.addIssue({
        code: "custom",
        message: "Wallet registry default does not match its entries.",
      });
    if (
      registry.defaultWalletId &&
      !registry.wallets.some((wallet) => wallet.id === registry.defaultWalletId)
    )
      context.addIssue({
        code: "custom",
        message: "Wallet registry default points to a missing wallet.",
      });
  });

export type WalletEntry = z.infer<typeof entrySchema>;
export type WalletRegistry = z.infer<typeof walletRegistrySchema>;
export type WalletIdentity = Readonly<{
  id: string;
  alias: string;
  address: ReturnType<typeof address>;
}>;
export type SelectedWallet = Readonly<{
  identity: WalletIdentity;
  keystorePath: string;
}>;

function storeError(code: string, message: string, exitCode: 1 | 2 = 1): never {
  throw new WalletStoreError(code, message, exitCode);
}

export function validateAlias(alias: string): string {
  if (!aliasSchema.safeParse(alias).success)
    storeError(
      "WalletAliasInvalid",
      "Wallet aliases must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores (up to 32 characters).",
      2,
    );
  return alias;
}

export function validateWalletId(id: string): string {
  if (!uuidSchema.safeParse(id).success)
    storeError("WalletStoreInvalid", "Wallet ID is not a canonical UUID.");
  return id;
}

export async function assertAliasAvailable(
  configDir: string,
  alias: string,
): Promise<void> {
  const registry = await readRegistry(configDir);
  if (registry.wallets.some((wallet) => wallet.alias === alias))
    storeError("WalletAliasExists", `Alias '${alias}' is already in use.`, 2);
}

export async function assertAddressAvailable(
  configDir: string,
  walletAddress: string,
): Promise<void> {
  const registry = await readRegistry(configDir);
  const duplicate = registry.wallets.find(
    (wallet) => wallet.address === walletAddress,
  );
  if (duplicate)
    storeError(
      "WalletAlreadyExists",
      `This address is already registered as '${duplicate.alias}'. Use wallet rename ${duplicate.alias} <new-alias>.`,
      2,
    );
  for (const orphan of await findUnregisteredKeystores(configDir)) {
    const file = await readKeystoreFile(walletKeystorePath(configDir, orphan));
    if (file?.publicKey === walletAddress)
      storeError(
        "WalletRecoveryRequired",
        `This address has an orphan keystore ${orphan}; use wallet recover ${orphan} <alias>.`,
        2,
      );
  }
}

async function ensureManagedDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    storeError("WalletStoreInvalid", `Managed path is not a safe directory.`);
  await chmod(directory, 0o700);
}

async function readJsonFile(filePath: string): Promise<string | null> {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      storeError(
        "WalletStoreInvalid",
        "Wallet metadata path is not a regular file.",
      );
    if ((metadata.mode & 0o077) !== 0)
      storeError(
        "WalletStoreInvalid",
        "Wallet metadata must have mode 0600; run chmod 600 on the file.",
      );
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function findUnregisteredKeystores(configDir: string): Promise<string[]> {
  const directory = walletDirectoryPath(configDir);
  try {
    const metadata = await lstat(directory);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0
    )
      storeError(
        "WalletStoreInvalid",
        "Wallet keystore directory must be a private 0700 directory.",
      );
    const entries = await readdir(directory, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!uuidSchema.safeParse(id).success) continue;
      if (!entry.isFile() || entry.isSymbolicLink())
        storeError(
          "WalletStoreInvalid",
          `Managed keystore ${id} is not a regular file.`,
        );
      ids.push(id);
    }
    return ids.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readRegistry(configDir: string): Promise<WalletRegistry> {
  const raw = await readJsonFile(walletRegistryPath(configDir));
  if (raw === null) {
    const legacy = await readJsonFile(legacyKeystoreFilePath(configDir));
    if (legacy !== null)
      storeError(
        "WalletMigrationRequired",
        "This configuration has a legacy keystore. Run `wallet migrate <alias>` before using wallet commands.",
        2,
      );
    const orphans = await findUnregisteredKeystores(configDir);
    if (orphans.length)
      storeError(
        "WalletRecoveryRequired",
        `Encrypted wallet files need registration. Run wallet recover ${orphans[0]} <alias> after reviewing the recovery guide.`,
        2,
      );
    return { version: 1, defaultWalletId: null, wallets: [] };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    storeError("WalletStoreInvalid", "Wallet registry is not valid JSON.");
  }
  const parsed = walletRegistrySchema.safeParse(parsedJson);
  if (!parsed.success)
    storeError("WalletStoreInvalid", "Wallet registry is malformed.", 1);
  return parsed.data;
}

/** Internal migration/recovery view: tolerate missing registry and orphan files only. */
export async function readRegistryForRecovery(
  configDir: string,
): Promise<WalletRegistry> {
  const raw = await readJsonFile(walletRegistryPath(configDir));
  if (raw === null) return { version: 1, defaultWalletId: null, wallets: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    storeError("WalletStoreInvalid", "Wallet registry is not valid JSON.");
  }
  const parsed = walletRegistrySchema.safeParse(value);
  if (!parsed.success)
    storeError("WalletStoreInvalid", "Wallet registry is malformed.");
  return parsed.data;
}

export async function resolveWallet(
  configDir: string,
  id: string,
  registry?: WalletRegistry,
): Promise<SelectedWallet> {
  validateWalletId(id);
  const current = registry ?? (await readRegistry(configDir));
  const entry = current.wallets.find((wallet) => wallet.id === id);
  if (!entry)
    storeError("WalletNotFound", `Wallet ID ${id} is not registered.`, 2);
  const keystorePath = walletKeystorePath(configDir, id);
  try {
    await ensureManagedDirectory(walletDirectoryPath(configDir));
    const metadata = await lstat(keystorePath);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      storeError(
        "WalletStoreInvalid",
        `Keystore for ${entry.alias} is not a regular file.`,
      );
    if ((metadata.mode & 0o077) !== 0)
      storeError(
        "WalletStoreInvalid",
        `Keystore for ${entry.alias} must have mode 0600; run chmod 600 on its UUID-named file.`,
      );
    const keystore = await readKeystoreFile(keystorePath);
    if (!keystore || keystore.publicKey !== entry.address)
      storeError(
        "WalletStoreInvalid",
        `Keystore address does not match wallet ${entry.alias}.`,
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      storeError(
        "WalletStoreInvalid",
        `Keystore for ${entry.alias} is missing.`,
      );
    throw error;
  }
  return {
    identity: { id, alias: entry.alias, address: address(entry.address) },
    keystorePath,
  };
}

export async function selectWallet(
  config: AppConfig,
  alias: string | undefined,
): Promise<{ registry: WalletRegistry; wallet: SelectedWallet | null }> {
  if (alias !== undefined) validateAlias(alias);
  const registry = await readRegistry(config.configDir);
  const selected = alias
    ? registry.wallets.find((wallet) => wallet.alias === alias)
    : registry.wallets.find((wallet) => wallet.id === registry.defaultWalletId);
  if (alias && !selected)
    storeError("WalletNotFound", `No wallet has alias '${alias}'.`, 2);
  if (!selected) return { registry, wallet: null };
  return {
    registry,
    wallet: await resolveWallet(config.configDir, selected.id, registry),
  };
}

export async function listOrphanIds(
  configDir: string,
  registry: WalletRegistry,
): Promise<string[]> {
  const registered = new Set(registry.wallets.map((wallet) => wallet.id));
  return (await findUnregisteredKeystores(configDir)).filter(
    (id) => !registered.has(id),
  );
}

export async function withStoreLock<T>(
  configDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = walletLockPath(configDir);
  let acquired = false;
  try {
    await mkdir(lockPath, { mode: 0o700 });
    acquired = true;
    await writeFilePrivate(path.join(lockPath, "owner.json"), {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      token: randomBytes(16).toString("hex"),
    });
    return await operation();
  } catch (error) {
    if (!acquired && (error as NodeJS.ErrnoException).code === "EEXIST")
      storeError(
        "WalletStoreBusy",
        "Another process is changing wallet data. Retry after it finishes; stale-lock recovery is documented in docs/multiple-wallets.md.",
      );
    throw error;
  } finally {
    if (acquired) await rm(lockPath, { recursive: true, force: true });
  }
}

async function writeFilePrivate(
  filePath: string,
  value: unknown,
): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeRegistryAtomic(
  configDir: string,
  registry: WalletRegistry,
): Promise<void> {
  const checked = walletRegistrySchema.safeParse(registry);
  if (!checked.success)
    storeError(
      "WalletStoreWriteError",
      "Refusing to write invalid wallet registry.",
    );
  const directory = configDir;
  await ensureManagedDirectory(directory);
  const target = walletRegistryPath(configDir);
  try {
    const existing = await lstat(target);
    if (!existing.isFile() || existing.isSymbolicLink())
      storeError(
        "WalletStoreInvalid",
        "Wallet registry path is not a regular file.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(
    directory,
    `.wallets-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFilePrivate(temporary, checked.data);
    await rename(temporary, target);
    await chmod(target, 0o600);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new WalletStoreError(
      "WalletStoreWriteError",
      "Unable to durably write wallet registry. Inspect `wallet list` before retrying because the registry may already be committed.",
      1,
      error,
    );
  }
}

export async function publishKeystore(
  configDir: string,
  id: string,
  sourcePath: string,
): Promise<string> {
  validateWalletId(id);
  const directory = walletDirectoryPath(configDir);
  await ensureManagedDirectory(directory);
  const target = walletKeystorePath(configDir, id);
  try {
    await link(sourcePath, target);
    await chmod(target, 0o600);
    await syncDirectory(directory);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      storeError(
        "WalletAlreadyExists",
        "Wallet UUID already has a keystore.",
        2,
      );
    throw error;
  }
}

export async function makeKeystoreTemp(configDir: string): Promise<string> {
  const directory = walletDirectoryPath(configDir);
  await ensureManagedDirectory(directory);
  return path.join(
    directory,
    `.import-${process.pid}-${randomBytes(12).toString("hex")}.tmp`,
  );
}

export async function finalizeTempKeystore(
  temporary: string,
  file: import("./keystore.js").KeystoreFile,
): Promise<void> {
  await writeFilePrivate(temporary, file);
}

export async function createRegistryEntry(
  configDir: string,
  alias: string,
  walletAddress: string,
  sourceKeystore: string,
): Promise<{ entry: WalletEntry; first: boolean }> {
  validateAlias(alias);
  return withStoreLock(configDir, async () => {
    const registry = await readRegistry(configDir);
    const id = randomUUID();
    if (registry.wallets.some((item) => item.alias === alias))
      storeError("WalletAliasExists", `Alias '${alias}' is already in use.`, 2);
    const duplicate = registry.wallets.find(
      (item) => item.address === walletAddress,
    );
    if (duplicate)
      storeError(
        "WalletAlreadyExists",
        `This address is already registered as '${duplicate.alias}'. Use wallet rename ${duplicate.alias} <new-alias>.`,
        2,
      );
    const files = await findUnregisteredKeystores(configDir);
    for (const orphan of files) {
      const orphanFile = await readKeystoreFile(
        walletKeystorePath(configDir, orphan),
      );
      if (orphanFile?.publicKey === walletAddress)
        storeError(
          "WalletAlreadyExists",
          `This address has an unregistered encrypted keystore ${orphan}. Use wallet recover ${orphan} <alias>.`,
          2,
        );
    }
    const entry: WalletEntry = {
      id,
      alias,
      address: walletAddress,
      createdAt: new Date().toISOString(),
    };
    try {
      await publishKeystore(configDir, id, sourceKeystore);
      const published = await readKeystoreFile(
        walletKeystorePath(configDir, id),
      );
      if (!published || published.publicKey !== walletAddress)
        storeError(
          "WalletStoreInvalid",
          `Published keystore ${id} failed public-key verification.`,
        );
    } catch (error) {
      if (await scanWalletFile(configDir, id))
        throw new WalletStoreError(
          "WalletStoreWriteError",
          `Encrypted wallet ${id} was published but registry registration failed. Recover it with wallet recover ${id} <alias>.`,
          1,
          error,
        );
      throw error;
    }
    const first = registry.wallets.length === 0;
    const wallets = [...registry.wallets, entry];
    try {
      await writeRegistryAtomic(configDir, {
        version: 1,
        defaultWalletId: first ? id : registry.defaultWalletId,
        wallets,
      });
    } catch (error) {
      throw new WalletStoreError(
        "WalletStoreWriteError",
        `Encrypted wallet ${id} was retained but registry publication failed or is uncertain. Recover it with wallet recover ${id} <alias> after checking wallet list.`,
        1,
        error,
      );
    }
    return { entry, first };
  });
}

export async function createRegistryEntryFromRecovery(
  configDir: string,
  alias: string,
  walletAddress: string,
  sourceKeystore: string,
): Promise<{ entry: WalletEntry; first: boolean }> {
  validateAlias(alias);
  return withStoreLock(configDir, async () => {
    const registry = await readRegistryForRecovery(configDir);
    const orphans = await findUnregisteredKeystores(configDir);
    for (const orphan of orphans) {
      const orphanFile = await readKeystoreFile(
        walletKeystorePath(configDir, orphan),
      );
      if (orphanFile?.publicKey === walletAddress)
        storeError(
          "WalletRecoveryRequired",
          `This address already has an orphan keystore ${orphan}; run wallet recover ${orphan} <alias>.`,
          2,
        );
    }
    if (orphans.length)
      storeError(
        "WalletRecoveryRequired",
        `Migration found other unregistered UUID keystores, starting with ${orphans[0]}. Review the files and recover them before deciding which configuration to migrate.`,
        2,
      );
    const id = randomUUID();
    if (registry.wallets.some((item) => item.alias === alias))
      storeError("WalletAliasExists", `Alias '${alias}' is already in use.`, 2);
    const duplicate = registry.wallets.find(
      (item) => item.address === walletAddress,
    );
    if (duplicate)
      storeError(
        "WalletAlreadyExists",
        `Address is already registered as '${duplicate.alias}'.`,
        2,
      );
    const entry: WalletEntry = {
      id,
      alias,
      address: walletAddress,
      createdAt: new Date().toISOString(),
    };
    try {
      await publishKeystore(configDir, id, sourceKeystore);
      const published = await readKeystoreFile(
        walletKeystorePath(configDir, id),
      );
      if (!published || published.publicKey !== walletAddress)
        storeError(
          "WalletStoreInvalid",
          `Published keystore ${id} failed public-key verification.`,
        );
    } catch (error) {
      if (await scanWalletFile(configDir, id))
        throw new WalletStoreError(
          "WalletStoreWriteError",
          `Encrypted wallet ${id} was published but registry registration failed. Recover it with wallet recover ${id} <alias>.`,
          1,
          error,
        );
      throw error;
    }
    const first = registry.wallets.length === 0;
    try {
      await writeRegistryAtomic(configDir, {
        version: 1,
        defaultWalletId: first ? id : registry.defaultWalletId,
        wallets: [...registry.wallets, entry],
      });
    } catch (error) {
      throw new WalletStoreError(
        "WalletStoreWriteError",
        `Migrated encrypted wallet ${id} was retained but registry publication failed or is uncertain. Recover it with wallet recover ${id} <alias> after checking wallet list.`,
        1,
        error,
      );
    }
    return { entry, first };
  });
}

export async function findLegacyKeystore(
  configDir: string,
): Promise<string | null> {
  try {
    const metadata = await lstat(legacyKeystoreFilePath(configDir));
    if (!metadata.isFile() || metadata.isSymbolicLink())
      storeError(
        "WalletStoreInvalid",
        "Legacy keystore is not a regular file.",
      );
    if ((metadata.mode & 0o077) !== 0)
      storeError(
        "WalletStoreInvalid",
        "Legacy keystore must have mode 0600; run chmod 600 before migration.",
      );
    return legacyKeystoreFilePath(configDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function readRawKeystore(pathname: string): Promise<Buffer> {
  try {
    const metadata = await lstat(pathname);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      storeError("WalletStoreInvalid", "Keystore path is not a regular file.");
    if ((metadata.mode & 0o077) !== 0)
      storeError(
        "WalletStoreInvalid",
        "Encrypted keystore must have mode 0600; run chmod 600 on the file.",
      );
    return await readFile(pathname);
  } catch {
    storeError("WalletStoreInvalid", "Unable to read encrypted keystore.");
  }
}

export async function registerExistingKeystore(
  configDir: string,
  id: string,
  alias: string,
  walletAddress: string,
  expectedBytes: Buffer,
): Promise<{ entry: WalletEntry; first: boolean; changed: boolean }> {
  validateWalletId(id);
  validateAlias(alias);
  return withStoreLock(configDir, async () => {
    const source = walletKeystorePath(configDir, id);
    const currentBytes = await readRawKeystore(source);
    if (!currentBytes.equals(expectedBytes))
      storeError(
        "WalletStoreInvalid",
        "Keystore changed during recovery; retry.",
      );
    await chmod(source, 0o600);
    const registry = await readRegistryForRecovery(configDir);
    const existing = registry.wallets.find((wallet) => wallet.id === id);
    if (existing?.alias === alias && existing.address === walletAddress)
      return { entry: existing, first: false, changed: false };
    if (existing)
      storeError(
        "WalletAlreadyExists",
        `UUID is already registered as '${existing.alias}'.`,
        2,
      );
    if (registry.wallets.some((wallet) => wallet.alias === alias))
      storeError("WalletAliasExists", `Alias '${alias}' is already in use.`, 2);
    const duplicate = registry.wallets.find(
      (wallet) => wallet.address === walletAddress,
    );
    if (duplicate)
      storeError(
        "WalletAlreadyExists",
        `Address is already registered as '${duplicate.alias}'.`,
        2,
      );
    const entry: WalletEntry = {
      id,
      alias,
      address: walletAddress,
      createdAt: new Date().toISOString(),
    };
    const first = registry.wallets.length === 0;
    await writeRegistryAtomic(configDir, {
      version: 1,
      defaultWalletId: first ? id : registry.defaultWalletId,
      wallets: [...registry.wallets, entry],
    });
    return { entry, first, changed: true };
  });
}

export async function mutateRegistry(
  configDir: string,
  operation: (registry: WalletRegistry) => WalletRegistry,
): Promise<WalletRegistry> {
  return withStoreLock(configDir, async () => {
    const current = await readRegistry(configDir);
    const next = operation(current);
    await writeRegistryAtomic(configDir, next);
    return next;
  });
}

export async function scanWalletFile(
  configDir: string,
  id: string,
): Promise<boolean> {
  validateWalletId(id);
  try {
    const metadata = await lstat(walletKeystorePath(configDir, id));
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function walletFileStatus(
  configDir: string,
  entry: WalletEntry,
): Promise<"ok" | "missing" | "invalid"> {
  try {
    const directory = walletDirectoryPath(configDir);
    const directoryMetadata = await lstat(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink())
      return "invalid";
    const target = walletKeystorePath(configDir, entry.id);
    const metadata = await lstat(target);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0
    )
      return "invalid";
    const file = await readKeystoreFile(target);
    return file && file.publicKey === entry.address ? "ok" : "invalid";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "invalid";
  }
}

export async function ensureWalletDirectory(configDir: string): Promise<void> {
  await ensureManagedDirectory(walletDirectoryPath(configDir));
}

export async function assertScopedStakeDirectory(
  configDir: string,
  walletId: string,
): Promise<void> {
  validateWalletId(walletId);
  for (const directory of [
    path.join(configDir, "stake-accounts"),
    path.join(configDir, "stake-accounts", walletId),
  ]) {
    try {
      const metadata = await lstat(directory);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        (metadata.mode & 0o077) !== 0
      )
        storeError(
          "WalletStoreInvalid",
          "Stake registry directories must be private 0700 directories.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function ensureScopedStakeDirectory(
  configDir: string,
  walletId: string,
): Promise<string> {
  validateWalletId(walletId);
  const root = path.join(configDir, "stake-accounts");
  const walletDirectory = path.join(root, walletId);
  for (const directory of [root, walletDirectory]) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      storeError("WalletStoreInvalid", "Stake registry directory is not safe.");
    await chmod(directory, 0o700);
  }
  return walletDirectory;
}

export async function writeEncryptedTemp(
  configDir: string,
  bytes: Uint8Array,
): Promise<string> {
  const directory = walletDirectoryPath(configDir);
  await ensureManagedDirectory(directory);
  const temporary = path.join(
    directory,
    `.recovery-${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}
