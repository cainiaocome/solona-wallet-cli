import { scopedStakeRegistryPath } from "../config/config.js";
import { WalletStoreError } from "../errors/errors.js";
import {
  listOrphanIds,
  mutateRegistry,
  readRegistry,
  resolveWallet,
  validateAlias,
  walletFileStatus,
  type WalletEntry,
} from "../wallet/store.js";
import type { CommandContext } from "./context.js";

/**
 * Commands for local wallet metadata and session selection.
 *
 * These operations do not unlock keys. A selection stores a stable UUID in
 * process state; the saved default is a separate registry field for new runs.
 */
export async function walletList(context: CommandContext): Promise<void> {
  const registry = await readRegistry(context.config.configDir);
  context.completion.walletAliases = registry.wallets.map(
    (wallet) => wallet.alias,
  );
  const wallets = await Promise.all(
    [...registry.wallets]
      .sort((left, right) => left.alias.localeCompare(right.alias))
      .map(async (wallet) => ({
        ...identity(wallet),
        createdAt: wallet.createdAt,
        current: context.session.currentWalletId === wallet.id,
        default: registry.defaultWalletId === wallet.id,
        health: await walletFileStatus(context.config.configDir, wallet),
      })),
  );
  const orphanIds = await listOrphanIds(context.config.configDir, registry);
  context.output.print(
    {
      ok: true,
      currentWalletId: context.session.currentWalletId,
      defaultWalletId: registry.defaultWalletId,
      wallets,
      orphanIds,
    },
    wallets.length
      ? `CURRENT DEFAULT ALIAS                            ADDRESS                                      HEALTH\n------- ------- -------------------------------- -------------------------------------------- -------\n${wallets
          .map(
            (wallet) =>
              `${wallet.current ? "*" : " "} ${wallet.default ? "*" : " "} ${wallet.alias.padEnd(32)} ${wallet.address} ${wallet.health}`,
          )
          .join("\n")}`
      : "No wallets registered. Run `wallet import <alias>`.",
  );
}

export async function walletInfo(
  context: CommandContext,
  alias?: string,
): Promise<void> {
  const registry = await readRegistry(context.config.configDir);
  const entry = alias
    ? registry.wallets.find((wallet) => wallet.alias === alias)
    : registry.wallets.find(
        (wallet) => wallet.id === context.session.currentWalletId,
      );
  if (!entry)
    throw new WalletStoreError(
      alias ? "WalletNotFound" : "WalletNotSelected",
      alias
        ? `No wallet has alias '${alias}'.`
        : "No wallet is selected; use `wallet info <alias>`.",
      2,
    );
  const selected = await resolveWallet(
    context.config.configDir,
    entry.id,
    registry,
  );
  context.output.print(
    {
      ok: true,
      wallet: identity(entry),
      cluster: context.config.cluster,
      createdAt: entry.createdAt,
      current: context.session.currentWalletId === entry.id,
      default: registry.defaultWalletId === entry.id,
      encrypted: true,
    },
    `Alias: ${entry.alias}\nAddress: ${selected.identity.address}\nCluster: ${context.config.cluster}\nPrivate key: encrypted at rest\nCurrent: ${context.session.currentWalletId === entry.id}\nDefault: ${registry.defaultWalletId === entry.id}`,
  );
}

export async function walletUse(
  context: CommandContext,
  alias: string,
): Promise<void> {
  if (context.session.executionMode === "oneshot")
    throw new WalletStoreError(
      "ParseError",
      "Use startup `--wallet <alias>` with a one-shot command.",
      2,
    );
  validateAlias(alias);
  const registry = await readRegistry(context.config.configDir);
  const entry = registry.wallets.find((wallet) => wallet.alias === alias);
  if (!entry)
    throw new WalletStoreError(
      "WalletNotFound",
      `No wallet has alias '${alias}'.`,
      2,
    );
  const selected = await resolveWallet(
    context.config.configDir,
    entry.id,
    registry,
  );
  context.walletStoreError = undefined;
  const changed = context.session.currentWalletId !== entry.id;
  context.session.currentWalletId = entry.id;
  context.commandWallet = selected;
  clearWalletCaches(context);
  context.output.print(
    {
      ok: true,
      action: "use",
      wallet: identity(entry),
      currentWalletId: entry.id,
      defaultWalletId: registry.defaultWalletId,
      changed,
    },
    `Current wallet: ${alias} (${selected.identity.address})${registry.defaultWalletId === entry.id ? "\nThis is also the saved default." : ""}`,
  );
}

export async function walletDefault(
  context: CommandContext,
  alias: string,
): Promise<void> {
  validateAlias(alias);
  const before = await readRegistry(context.config.configDir);
  const target = before.wallets.find((wallet) => wallet.alias === alias);
  if (!target)
    throw new WalletStoreError(
      "WalletNotFound",
      `No wallet has alias '${alias}'.`,
      2,
    );
  const selected = await resolveWallet(
    context.config.configDir,
    target.id,
    before,
  );
  let changed = false;
  const registry = await mutateRegistry(context.config.configDir, (current) => {
    const entry = current.wallets.find((wallet) => wallet.alias === alias);
    if (!entry || entry.id !== target.id)
      throw new WalletStoreError(
        "WalletNotFound",
        `Wallet '${alias}' changed while updating the default; retry.`,
        2,
      );
    changed = current.defaultWalletId !== entry.id;
    return { ...current, defaultWalletId: entry.id };
  });
  const entry = registry.wallets.find((wallet) => wallet.alias === alias)!;
  context.walletStoreError = undefined;
  context.output.print(
    {
      ok: true,
      action: "default",
      wallet: identity(entry),
      currentWalletId: context.session.currentWalletId,
      defaultWalletId: entry.id,
      changed,
    },
    `Saved default wallet: ${alias} (${selected.identity.address})${context.session.currentWalletId === entry.id ? "\nIt is also the current wallet." : "\nThe current session wallet was not changed."}`,
  );
}

export async function walletRename(
  context: CommandContext,
  oldAlias: string,
  newAlias: string,
): Promise<void> {
  validateAlias(oldAlias);
  validateAlias(newAlias);
  let changed = false;
  const registry = await mutateRegistry(context.config.configDir, (current) => {
    const entry = current.wallets.find((wallet) => wallet.alias === oldAlias);
    if (!entry)
      throw new WalletStoreError(
        "WalletNotFound",
        `No wallet has alias '${oldAlias}'.`,
        2,
      );
    if (oldAlias === newAlias) return current;
    if (current.wallets.some((wallet) => wallet.alias === newAlias))
      throw new WalletStoreError(
        "WalletAliasExists",
        `Alias '${newAlias}' is already in use.`,
        2,
      );
    changed = true;
    return {
      ...current,
      wallets: current.wallets.map((wallet) =>
        wallet.id === entry.id ? { ...wallet, alias: newAlias } : wallet,
      ),
    };
  });
  const entry = registry.wallets.find((wallet) => wallet.alias === newAlias)!;
  context.completion.walletAliases = registry.wallets.map(
    (wallet) => wallet.alias,
  );
  context.output.print(
    {
      ok: true,
      action: "rename",
      wallet: identity(entry),
      currentWalletId: context.session.currentWalletId,
      defaultWalletId: registry.defaultWalletId,
      changed,
    },
    changed
      ? `Wallet renamed: ${oldAlias} → ${newAlias} (${entry.address})`
      : `Wallet alias is already '${newAlias}'.`,
  );
}

export async function status(context: CommandContext): Promise<void> {
  if (context.walletStoreError) throw context.walletStoreError;
  const registry = await readRegistry(context.config.configDir);
  const currentEntry = registry.wallets.find(
    (wallet) => wallet.id === context.session.currentWalletId,
  );
  if (context.session.currentWalletId && !currentEntry)
    throw new WalletStoreError(
      "WalletStoreInvalid",
      "The current wallet is no longer registered. Select a registered wallet with `wallet use <alias>`.",
    );
  const defaultEntry = registry.wallets.find(
    (wallet) => wallet.id === registry.defaultWalletId,
  );
  if (
    defaultEntry &&
    (await walletFileStatus(context.config.configDir, defaultEntry)) !== "ok"
  )
    throw new WalletStoreError(
      "WalletStoreInvalid",
      `Saved default wallet '${defaultEntry.alias}' has a missing or invalid keystore.`,
    );
  const current = currentEntry
    ? identity(
        (
          await resolveWallet(
            context.config.configDir,
            currentEntry.id,
            registry,
          )
        ).identity,
      )
    : null;
  const defaultWallet = defaultEntry ? identity(defaultEntry) : null;
  const rpcUrl = displayRpcUrl(context.config.rpcUrl);
  context.output.print(
    {
      ok: true,
      wallet: current,
      defaultWallet,
      cluster: context.config.cluster,
      rpcUrl,
      commitment: context.config.commitment,
    },
    `Wallet: ${current ? `${current.alias} (${current.address})` : "none selected"}\nDefault wallet: ${defaultWallet ? `${defaultWallet.alias} (${defaultWallet.address})` : "none"}\nNetwork: ${context.config.cluster}\nRPC URL: ${rpcUrl}\nCommitment: ${context.config.commitment}${current ? `\nStake records: ${scopedStakeRegistryPath(context.config.configDir, current.id, context.config.cluster)}` : ""}`,
  );
}

export function clearWalletCaches(context: CommandContext): void {
  context.completion.tokenMints = [];
  context.completion.stakeAccounts = [];
}

export function displayRpcUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = "/[REDACTED]";
    return parsed
      .toString()
      .replace(/\/$/, parsed.pathname === "/" ? "" : "/[REDACTED]");
  } catch {
    return "[REDACTED]";
  }
}

function identity(entry: { id: string; alias: string; address: string }) {
  return { id: entry.id, alias: entry.alias, address: entry.address };
}
