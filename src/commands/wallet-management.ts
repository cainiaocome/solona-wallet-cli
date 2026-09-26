import { formatSol, formatUnits } from "../solana/amounts.js";
import { assertRpcCluster, rpcRequest } from "../solana/rpc.js";
import { aggregateTokenAccounts, getTokenAccounts } from "../solana/tokens.js";
import { table, shortenAddress } from "../output/human.js";
import { asAppError, WalletStoreError } from "../errors/errors.js";
import { readLendPosition } from "./lending.js";
import { readStakeAccounts } from "./staking.js";
import { JUPITER_LEND_USDC_DECIMALS } from "../integrations/jupiter-lend/adapter.js";
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
      ? `${formatWalletTable(wallets)}${orphanIds.length ? `\n\nUnregistered UUID-named wallet paths (review before recovery):\n${orphanIds.join("\n")}` : ""}`
      : orphanIds.length
        ? `No wallets registered. Run \`wallet recover <uuid> <alias>\` for an unregistered key.\nUnregistered UUID-named wallet paths (review before recovery):\n${orphanIds.join("\n")}`
        : "No wallets registered. Run `wallet import <alias>`.",
  );
}

function formatWalletTable(
  wallets: Array<{
    current: boolean;
    default: boolean;
    alias: string;
    address: string;
    health: string;
  }>,
): string {
  const headers = ["CURRENT", "DEFAULT", "ALIAS", "ADDRESS", "HEALTH"];
  const widths = [
    headers[0]!.length,
    headers[1]!.length,
    Math.max(
      headers[2]!.length,
      ...wallets.map((wallet) => wallet.alias.length),
    ),
    Math.max(
      headers[3]!.length,
      ...wallets.map((wallet) => wallet.address.length),
    ),
    Math.max(
      headers[4]!.length,
      ...wallets.map((wallet) => wallet.health.length),
    ),
  ];
  const rows = wallets.map((wallet) =>
    [
      wallet.current ? "*" : "",
      wallet.default ? "*" : "",
      wallet.alias,
      wallet.address,
      wallet.health,
    ]
      .map((value, index) => value.padEnd(widths[index]!))
      .join(" "),
  );
  return (
    [
      headers.map((value, index) => value.padEnd(widths[index]!)).join(" "),
      widths.map((width) => "-".repeat(width)).join(" "),
      ...rows,
    ].join("\n") + "\n* marks the current or saved-default wallet."
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
  const details = [
    ["Alias", entry.alias],
    ["Address", selected.identity.address],
    ["Cluster", context.config.cluster],
    ["Private key", "encrypted at rest"],
    ["Current", String(context.session.currentWalletId === entry.id)],
    ["Default", String(registry.defaultWalletId === entry.id)],
  ] as const;
  const labelWidth = Math.max(...details.map(([label]) => label.length));
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
    details
      .map(([label, value]) => `${label.padEnd(labelWidth)}: ${value}`)
      .join("\n"),
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

/**
 * Refresh public chain balances without unlocking the key. RPC health and each
 * balance section are independent so a failed read is never rendered as zero.
 */
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
  const selected = currentEntry
    ? await resolveWallet(context.config.configDir, currentEntry.id, registry)
    : null;
  if (selected) context.commandWallet = selected;
  const current = selected ? identity(selected.identity) : null;
  const defaultWallet = defaultEntry ? identity(defaultEntry) : null;
  const rpcUrl = displayRpcUrl(context.config.rpcUrl);
  let rpcState:
    | { status: "reachable" }
    | { status: "unavailable"; error: string };
  let solBalance:
    | { status: "available"; lamports: bigint; amount: string }
    | { status: "unavailable"; error: string }
    | null = null;
  let tokenBalances:
    | {
        status: "available";
        assets: ReturnType<typeof aggregateTokenAccounts>;
      }
    | { status: "unavailable"; error: string }
    | null = null;
  let stakePosition:
    | {
        status: "available";
        accountCount: number;
        delegatedLamports: bigint;
        stateCounts: Record<string, number>;
        localHints: number;
      }
    | { status: "unavailable"; error: string }
    | null = null;
  let jupiterPosition:
    | {
        status: "available";
        walletBalance: bigint;
        walletBalanceUsdc: string;
        supplied: bigint;
        suppliedUsdc: string;
        currentlyWithdrawable: bigint;
        currentlyWithdrawableUsdc: string;
      }
    | { status: "unavailable"; error: string }
    | { status: "not_supported"; reason: "mainnet-only" }
    | null = null;
  const showProgress = !context.output.json && Boolean(process.stderr.isTTY);

  if (showProgress) process.stderr.write("Refreshing wallet status…");
  try {
    const rpc = context.getClient().rpc;
    await assertRpcCluster(rpc, context.config.cluster);
    rpcState = { status: "reachable" };
    if (selected) {
      const [solResult, tokenResult, stakeResult, jupiterResult] =
        await Promise.allSettled([
          rpcRequest(
            rpc.getBalance(selected.identity.address, {
              commitment: context.config.commitment,
            }),
            "SOL balance lookup",
          ),
          getTokenAccounts(
            rpc,
            selected.identity.address,
            context.config.commitment,
          ),
          readStakeAccounts(context, selected.identity.address, true),
          ...(context.config.cluster === "mainnet"
            ? [readLendPosition(context, selected.identity.address)]
            : []),
        ]);
      if (solResult.status === "fulfilled") {
        const lamports = BigInt(solResult.value.value as bigint);
        solBalance = {
          status: "available",
          lamports,
          amount: formatSol(lamports),
        };
      } else {
        solBalance = {
          status: "unavailable",
          error: asAppError(solResult.reason).code,
        };
      }
      if (tokenResult.status === "fulfilled") {
        try {
          context.completion.tokenMints = [
            ...new Set(tokenResult.value.map((account) => account.mint)),
          ];
          tokenBalances = {
            status: "available",
            assets: aggregateTokenAccounts(tokenResult.value).filter(
              (asset) => asset.rawAmount > 0n,
            ),
          };
        } catch (error) {
          tokenBalances = {
            status: "unavailable",
            error: asAppError(error).code,
          };
        }
      } else {
        tokenBalances = {
          status: "unavailable",
          error: asAppError(tokenResult.reason).code,
        };
      }
      if (stakeResult.status === "fulfilled") {
        const chainAccounts = stakeResult.value.filter((account) =>
          Object.hasOwn(account, "lamports"),
        );
        const stateCounts: Record<string, number> = {};
        let delegatedLamports = 0n;
        for (const account of chainAccounts) {
          const state = String(account.state ?? "unknown");
          stateCounts[state] = (stateCounts[state] ?? 0) + 1;
          if (typeof account.delegatedStakeLamports === "bigint")
            delegatedLamports += account.delegatedStakeLamports;
        }
        stakePosition = {
          status: "available",
          accountCount: chainAccounts.length,
          delegatedLamports,
          stateCounts,
          localHints: stakeResult.value.length - chainAccounts.length,
        };
      } else {
        stakePosition = {
          status: "unavailable",
          error: asAppError(stakeResult.reason).code,
        };
      }
      if (context.config.cluster === "mainnet") {
        if (jupiterResult?.status === "fulfilled") {
          const position = jupiterResult.value;
          jupiterPosition = {
            status: "available",
            walletBalance: position.walletBalance,
            walletBalanceUsdc: formatUnits(
              position.walletBalance,
              JUPITER_LEND_USDC_DECIMALS,
            ),
            supplied: position.supplied,
            suppliedUsdc: formatUnits(
              position.supplied,
              JUPITER_LEND_USDC_DECIMALS,
            ),
            currentlyWithdrawable: position.withdrawable,
            currentlyWithdrawableUsdc: formatUnits(
              position.withdrawable,
              JUPITER_LEND_USDC_DECIMALS,
            ),
          };
        } else {
          jupiterPosition = {
            status: "unavailable",
            error:
              jupiterResult?.status === "rejected"
                ? asAppError(jupiterResult.reason).code
                : "JupiterLendError",
          };
        }
      } else {
        jupiterPosition = { status: "not_supported", reason: "mainnet-only" };
      }
    }
  } catch (error) {
    const code = asAppError(error).code;
    rpcState = { status: "unavailable", error: code };
    if (selected) {
      solBalance = { status: "unavailable", error: code };
      tokenBalances = { status: "unavailable", error: code };
      stakePosition = { status: "unavailable", error: code };
      jupiterPosition =
        context.config.cluster === "mainnet"
          ? { status: "unavailable", error: code }
          : { status: "not_supported", reason: "mainnet-only" };
    }
  } finally {
    if (showProgress) process.stderr.write("\n");
  }

  const requiredSections = [
    solBalance,
    tokenBalances,
    stakePosition,
    ...(context.config.cluster === "mainnet" ? [jupiterPosition] : []),
  ];
  const hasUnavailableSection = requiredSections.some(
    (section) => section?.status === "unavailable",
  );
  const health =
    rpcState.status === "unavailable"
      ? "unavailable"
      : selected && hasUnavailableSection
        ? "degraded"
        : "healthy";
  const updatedAt = new Date().toISOString();
  const balances = selected ? { sol: solBalance, tokens: tokenBalances } : null;
  const positions = selected
    ? { nativeStake: stakePosition, jupiterLend: jupiterPosition }
    : null;
  const tokenTable =
    tokenBalances?.status === "available" && tokenBalances.assets.length
      ? table(
          tokenBalances.assets.map((asset) => [
            context.output.verbose ? asset.mint : shortenAddress(asset.mint),
            `${asset.amount}`,
            asset.program,
            String(asset.accountCount),
          ]),
          ["MINT", "BALANCE", "TOKEN PROGRAM", "ACCOUNTS"],
        )
      : "No non-zero token balances.";
  const defaultLabel = defaultWallet
    ? current?.id === defaultWallet.id
      ? `${defaultWallet.alias} (same as current)`
      : `${defaultWallet.alias} (${defaultWallet.address})`
    : "none";
  const positionLines = selected
    ? [
        "Positions (not included in liquid balances):",
        stakePosition?.status === "available"
          ? `Native stake: ${stakePosition.accountCount ? `${formatSol(stakePosition.delegatedLamports)} SOL delegated across ${stakePosition.accountCount} account(s)` : "no on-chain stake accounts found"}${
              Object.keys(stakePosition.stateCounts).length
                ? `; states: ${Object.entries(stakePosition.stateCounts)
                    .map(([state, count]) => `${state} ${count}`)
                    .join(", ")}`
                : ""
            }${stakePosition.localHints ? `; local recovery hints: ${stakePosition.localHints}` : ""}`
          : "Native stake: unavailable; check RPC and retry status.",
        jupiterPosition?.status === "available"
          ? `Jupiter Lend (USDC): ${jupiterPosition.walletBalanceUsdc} in wallet; ${jupiterPosition.suppliedUsdc} supplied; ${jupiterPosition.currentlyWithdrawableUsdc} currently withdrawable`
          : jupiterPosition?.status === "not_supported"
            ? "Jupiter Lend: mainnet only (not queried on devnet)"
            : "Jupiter Lend: unavailable; check RPC/protocol access and retry status.",
      ]
    : [];
  const human = [
    `Wallet: ${current ? `${current.alias} (${current.address})` : "none selected"}`,
    `Default wallet: ${defaultLabel}`,
    `Network: ${context.config.cluster.toUpperCase()}${context.config.cluster === "mainnet" ? " (real funds)" : ""}`,
    `RPC: ${rpcState.status === "reachable" ? "reachable; network verified" : "unavailable or on the wrong network"} (${rpcUrl})`,
    `Commitment: ${context.config.commitment}`,
    ...(selected
      ? [
          `SOL balance: ${solBalance?.status === "available" ? `${solBalance.amount} SOL` : "unavailable"}`,
          "Token balances:",
          tokenBalances?.status === "unavailable"
            ? "Unavailable; check the RPC endpoint and retry status."
            : tokenTable,
        ]
      : ["Balances: import or select a wallet to view its balances."]),
    ...positionLines,
    ...(health === "degraded"
      ? selected
        ? ["Some balance data could not be loaded; unavailable is not zero."]
        : []
      : health === "unavailable"
        ? [
            selected
              ? "Balances were not loaded because the RPC could not be verified."
              : "Resolve the RPC/network issue before requesting chain data.",
          ]
        : []),
    `Updated: ${updatedAt}`,
  ].join("\n");
  context.output.print(
    {
      ok: true,
      wallet: current,
      defaultWallet,
      cluster: context.config.cluster,
      rpcUrl,
      commitment: context.config.commitment,
      health,
      rpc: rpcState,
      balances,
      positions,
      updatedAt,
    },
    human,
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
