import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandContext } from "../../src/commands/context.js";
import { executeLine } from "../../src/commands/execute.js";
import { createRegistryEntry } from "../../src/wallet/store.js";
import {
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
  writeKeystoreFileAtomic,
} from "../../src/wallet/keystore.js";
import { TOKEN_PROGRAM_ADDRESS } from "../../src/solana/tokens.js";

const mockedLend = vi.hoisted(() => ({
  fail: false,
  calls: 0,
  position: {
    walletBalance: 2_000_000n,
    supplied: 3_000_000n,
    protocolWithdrawable: 2_500_000n,
    withdrawable: 2_500_000n,
    receiptShares: 3_000_000n,
    receiptMint: "11111111111111111111111111111112",
    receiptTokenAccount: "11111111111111111111111111111113",
    supplyRateRaw: 123n,
    rewardsRateRaw: 456n,
  },
}));

vi.mock("../../src/integrations/jupiter-lend/adapter.js", async (load) => {
  const actual =
    await load<
      typeof import("../../src/integrations/jupiter-lend/adapter.js")
    >();
  return {
    ...actual,
    JupiterLendAdapter: class {
      constructor() {}

      async getPosition() {
        mockedLend.calls += 1;
        if (mockedLend.fail) throw new Error("mock Jupiter read failure");
        return mockedLend.position;
      }
    },
  };
});

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const WRONG_GENESIS = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";
const TOKEN_MINT = "11111111111111111111111111111114";
const TOKEN_ACCOUNT_A = "11111111111111111111111111111115";
const TOKEN_ACCOUNT_B = "11111111111111111111111111111116";

describe("status portfolio overview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockedLend.fail = false;
    mockedLend.calls = 0;
  });

  it("reports SOL and aggregates non-zero token accounts by mint", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://rpc.example.invalid/?api-key=not-shown",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.id },
      );
      context.getClient = () => ({ rpc: healthyRpc() }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      expect(output).toHaveLength(1);
      const result = JSON.parse(output[0]!);
      expect(result).toMatchObject({
        ok: true,
        health: "healthy",
        rpc: { status: "reachable" },
        wallet: { alias: "daily", address: wallet.address },
        balances: {
          sol: { status: "available", lamports: "1250000000", amount: "1.25" },
          tokens: {
            status: "available",
            assets: [
              {
                mint: TOKEN_MINT,
                program: "spl-token",
                decimals: 6,
                rawAmount: "1750000",
                amount: "1.75",
                accountCount: 2,
              },
            ],
          },
        },
        positions: {
          nativeStake: {
            status: "available",
            accountCount: 0,
            delegatedLamports: "0",
          },
          jupiterLend: {
            status: "available",
            walletBalanceUsdc: "2",
            suppliedUsdc: "3",
            currentlyWithdrawableUsdc: "2.5",
          },
        },
      });
      expect(result.rpcUrl).toBe("https://rpc.example.invalid");
      expect(JSON.stringify(result)).not.toContain("not-shown");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks a failed balance section unavailable without hiding successful reads", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-partial-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.id },
      );
      const rpc = healthyRpc();
      rpc.getBalance = () => ({
        send: async () => Promise.reject(Error("offline")),
      });
      context.getClient = () => ({ rpc }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      const result = JSON.parse(output[0]!);
      expect(result.health).toBe("degraded");
      expect(result.balances.sol).toMatchObject({
        status: "unavailable",
        error: "RpcError",
      });
      expect(result.balances.tokens).toMatchObject({
        status: "available",
        assets: [{ amount: "1.75" }],
      });
      expect(result.balances.sol).not.toHaveProperty("amount", "0");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("isolates an unavailable Jupiter position from liquid balances", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-lend-error-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.id },
      );
      context.getClient = () => ({ rpc: healthyRpc() }) as never;
      mockedLend.fail = true;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      const result = JSON.parse(output[0]!);
      expect(result.health).toBe("degraded");
      expect(result.balances.sol.status).toBe("available");
      expect(result.positions.nativeStake.status).toBe("available");
      expect(result.positions.jupiterLend).toMatchObject({
        status: "unavailable",
        error: "JupiterLendError",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not query balances or mislabel a mismatched RPC network", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-network-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://rpc.example.invalid",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.id },
      );
      const rpc = healthyRpc(WRONG_GENESIS);
      const getBalance = vi.spyOn(rpc, "getBalance");
      const getTokens = vi.spyOn(rpc, "getTokenAccountsByOwner");
      context.getClient = () => ({ rpc }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      const result = JSON.parse(output[0]!);
      expect(result.health).toBe("unavailable");
      expect(result.rpc).toMatchObject({
        status: "unavailable",
        error: "RpcError",
      });
      expect(result.balances.sol.status).toBe("unavailable");
      expect(result.balances.tokens.status).toBe("unavailable");
      expect(getBalance).not.toHaveBeenCalled();
      expect(getTokens).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("explains what to do when no wallet is selected", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-empty-"),
    );
    const output: string[] = [];
    try {
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      context.getClient = () => ({ rpc: healthyRpc() }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      expect(output.join("")).toContain("none selected");
      expect(output.join("")).toContain("Balances: import or select a wallet");
      expect(output.join("")).toContain("MAINNET (real funds)");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["oneshot", "missing"],
    ["interactive", "missing"],
    ["oneshot", "invalid"],
    ["interactive", "invalid"],
  ] as const)(
    "reports selected wallet status with %s selection and a %s default keystore",
    async (executionMode, defaultKeystoreHealth) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "sol-wallet-status-missing-default-"),
      );
      const output: string[] = [];
      try {
        const defaultWallet = await createWallet(directory, "primary", 37);
        const selectedWallet = await createWallet(directory, "savings", 57);
        const defaultKeystorePath = path.join(
          directory,
          "wallets",
          `${defaultWallet.id}.json`,
        );
        if (defaultKeystoreHealth === "missing")
          await unlink(defaultKeystorePath);
        else await writeFile(defaultKeystorePath, "{}");

        const context = createCommandContext(
          {
            configDir: directory,
            cluster: "mainnet",
            rpcUrl: "https://api.mainnet.solana.com",
            commitment: "confirmed",
          },
          { json: true, verbose: false },
          { currentWalletId: selectedWallet.id, executionMode },
        );
        context.getClient = () => ({ rpc: healthyRpc() }) as never;
        vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
          output.push(String(chunk));
          return true;
        });

        await executeLine(context, "status");

        const result = JSON.parse(output[0]!);
        expect(result).toMatchObject({
          ok: true,
          health: "healthy",
          wallet: { id: selectedWallet.id, alias: "savings" },
          defaultWallet: { id: defaultWallet.id, alias: "primary" },
          defaultWalletHealth: defaultKeystoreHealth,
          balances: {
            sol: { status: "available", amount: "1.25" },
            tokens: { status: "available" },
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it("keeps native stake and Jupiter positions separate from liquid balances", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-status-human-positions-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: wallet.id },
      );
      context.getClient = () => ({ rpc: healthyRpc() }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "status");

      const rendered = output.join("");
      expect(rendered).toContain("Positions (not included in liquid balances)");
      expect(rendered).toContain(
        "Native stake: no on-chain stake accounts found",
      );
      expect(rendered).toContain(
        "Jupiter Lend (USDC): 2 in wallet; 3 supplied",
      );
      expect(rendered).toContain("2.5 currently withdrawable");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("shows aggregated token rows by default and account detail on request", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-token-table-"),
    );
    const output: string[] = [];
    try {
      const wallet = await createWallet(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: wallet.id },
      );
      context.getClient = () => ({ rpc: healthyRpc() }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(context, "token list");
      const summary = output.join("");
      expect(summary).toContain("MINT");
      expect(summary).toContain("BALANCE");
      expect(summary).toContain("TOKEN PROGRAM");
      expect(summary).toContain("1.75");
      expect(summary).not.toContain(TOKEN_ACCOUNT_A);

      output.length = 0;
      await executeLine(context, "token list --accounts");
      const details = output.join("");
      expect(details).toContain("TOKEN ACCOUNT");
      expect(details).toContain(TOKEN_ACCOUNT_A);
      expect(details).toContain(TOKEN_ACCOUNT_B);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function healthyRpc(genesis = MAINNET_GENESIS) {
  return {
    getGenesisHash: () => request(genesis),
    getBalance: () => request({ value: 1_250_000_000n }),
    getTokenAccountsByOwner: (_owner: string, filter: { programId: string }) =>
      request({
        value:
          String(filter.programId) === String(TOKEN_PROGRAM_ADDRESS)
            ? [
                tokenAccount(TOKEN_ACCOUNT_A, "500000", "0.5"),
                tokenAccount(TOKEN_ACCOUNT_B, "1250000", "1.25"),
              ]
            : [],
      }),
    getProgramAccounts: () => request([]),
  } as any;
}

function tokenAccount(address: string, amount: string, uiAmountString: string) {
  return {
    pubkey: address,
    account: {
      data: {
        parsed: {
          info: {
            mint: TOKEN_MINT,
            owner: "11111111111111111111111111111112",
            tokenAmount: { amount, decimals: 6, uiAmountString },
          },
        },
      },
    },
  };
}

function request<T>(value: T) {
  return { send: async () => value };
}

async function createWallet(configDir: string, alias = "daily", seed = 37) {
  const secret = await normalizeSecretKey(
    Uint8Array.from({ length: 32 }, (_, index) => index + seed),
  );
  try {
    const walletAddress = await deriveAddress(secret);
    const pathName = path.join(configDir, `fixture-${seed}.json`);
    await writeKeystoreFileAtomic(
      pathName,
      await encryptSecretKey(secret, walletAddress, "fixture-passphrase"),
    );
    const { entry } = await createRegistryEntry(
      configDir,
      alias,
      walletAddress,
      pathName,
    );
    return { id: entry.id, address: walletAddress };
  } finally {
    secret.fill(0);
  }
}
