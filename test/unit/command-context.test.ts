import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyPairFromBytes } from "@solana/kit";
import bs58 from "bs58";
import { createCommandContext } from "../../src/commands/context.js";
import { executeLine } from "../../src/commands/execute.js";
import { createRegistryEntry } from "../../src/wallet/store.js";
import {
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
} from "../../src/wallet/keystore.js";

const mockedLend = vi.hoisted(() => ({
  signerAddresses: [] as string[],
  mode: "fail" as "fail" | "sign",
  plan: undefined as unknown,
  position: undefined as unknown,
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

      async buildDeposit(
        owner: string,
        _amount: bigint,
        signer: { address: string },
      ) {
        mockedLend.signerAddresses.push(signer.address);
        if (mockedLend.mode === "fail")
          throw new Error("controlled adapter stop");
        const { AccountRole } = await import("@solana/kit");
        return {
          instructions: [
            {
              programAddress: "11111111111111111111111111111111",
              accounts: [
                {
                  address: signer.address,
                  role: AccountRole.WRITABLE_SIGNER,
                  signer,
                },
              ],
              data: Uint8Array.of(1),
            },
          ],
          sourceTokenAccount: owner,
          destinationTokenAccount: "11111111111111111111111111111112",
          receiptMint: "11111111111111111111111111111113",
          tokenProgram: "11111111111111111111111111111111",
          walletBalance: 2_000_000n,
        };
      }

      async buildWithdraw(
        owner: string,
        amount: bigint,
        signer: { address: string },
      ) {
        return this.buildDeposit(owner, amount, signer);
      }

      async getPosition() {
        return mockedLend.position;
      }
    },
  };
});

describe("command-scoped wallet and output context", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the captured wallet and JSON output active through async token handlers", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-dispatch-"),
    );
    const chunks: string[] = [];
    try {
      const wallet = await registerFixture(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://rpc.example.invalid",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: wallet.id },
      );
      context.getClient = () =>
        ({
          rpc: {
            getGenesisHash: () => request(MAINNET_GENESIS),
            getTokenAccountsByOwner: () => request({ value: [] }),
            getBalance: () => request({ value: 123n }),
          },
        }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });

      await executeLine(context, "token list --json");

      expect(chunks).toHaveLength(1);
      const payload = JSON.parse(chunks[0]!);
      expect(payload.wallet).toMatchObject({ id: wallet.id, alias: "daily" });
      expect(payload.cluster).toBe("mainnet");

      chunks.length = 0;
      await executeLine(context, "bal --json");
      expect(chunks).toHaveLength(1);
      expect(JSON.parse(chunks[0]!).wallet).toMatchObject({ id: wallet.id });
      expect(context.commandWallet).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains the wallet snapshot until an async Jupiter signer is constructed", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-jupiter-dispatch-"),
    );
    try {
      const wallet = await registerFixture(directory);
      mockedLend.mode = "fail";
      mockedLend.signerAddresses.length = 0;
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

      await expect(
        executeLine(context, "jupiter-lend deposit 1 --dry-run"),
      ).rejects.toThrow(/controlled adapter stop/);
      expect(mockedLend.signerAddresses).toEqual([KEYSTORE.publicKey]);
      expect(context.commandWallet).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the selected wallet available through stake simulation", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-stake-dispatch-"),
    );
    try {
      const wallet = await registerFixture(directory);
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "devnet",
          rpcUrl: "https://rpc.example.invalid",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.id },
      );
      const validator = "11111111111111111111111111111112";
      context.getClient = () =>
        ({
          rpc: {
            getGenesisHash: () => request(DEVNET_GENESIS),
            getVoteAccounts: () =>
              request({
                current: [
                  {
                    votePubkey: validator,
                    nodePubkey: "11111111111111111111111111111113",
                    commission: 5,
                    activatedStake: 10_000n,
                    lastVote: 100n,
                    rootSlot: 100n,
                  },
                ],
                delinquent: [],
              }),
            getStakeMinimumDelegation: () => request({ value: 1n }),
            getMinimumBalanceForRentExemption: () => request(2n),
            getLatestBlockhash: () =>
              request({
                value: {
                  blockhash: "11111111111111111111111111111111",
                  lastValidBlockHeight: 200n,
                },
              }),
            getBlockHeight: () => request(100n),
            getFeeForMessage: () => request({ value: 5_000n }),
            getBalance: () => request({ value: 10_000_000_000n }),
            simulateTransaction: () =>
              request({ value: { err: null, logs: [] } }),
          },
        }) as never;
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      await executeLine(
        context,
        `stake create 1 --validator ${validator} --dry-run --json`,
      );

      expect(context.commandWallet).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps Jupiter Lend human status focused on user amounts by default", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-jupiter-status-output-"),
    );
    const output: string[] = [];
    try {
      const wallet = await registerFixture(directory);
      mockedLend.position = {
        walletBalance: 2_000_000n,
        supplied: 3_000_000n,
        protocolWithdrawable: 2_500_000n,
        withdrawable: 2_500_000n,
        receiptShares: 3_000_000n,
        receiptMint: "11111111111111111111111111111112",
        receiptTokenAccount: "11111111111111111111111111111113",
        supplyRateRaw: 123n,
        rewardsRateRaw: 456n,
      };
      const config = {
        configDir: directory,
        cluster: "mainnet" as const,
        rpcUrl: "https://api.mainnet.solana.com",
        commitment: "confirmed" as const,
      };
      const regular = createCommandContext(
        config,
        { json: false, verbose: false },
        { currentWalletId: wallet.id },
      );
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await executeLine(regular, "jupiter-lend status");
      const summary = output.join("");
      expect(summary).toContain("Wallet balance: 2 USDC");
      expect(summary).toContain("Currently withdrawable: 2.5 USDC");
      expect(summary).not.toContain("Protocol supply rate (raw)");

      output.length = 0;
      const verbose = createCommandContext(
        config,
        { json: false, verbose: true },
        { currentWalletId: wallet.id },
      );
      await executeLine(verbose, "jupiter-lend status");
      expect(output.join("")).toContain("Protocol supply rate (raw): 123");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("signs a deterministic Jupiter instruction with the selected wallet", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-jupiter-signing-"),
    );
    const writes: string[] = [];
    let secret: Buffer | undefined;
    try {
      const wallet = await registerEncryptedFixture(directory);
      secret = wallet.secret;
      mockedLend.mode = "sign";
      mockedLend.signerAddresses.length = 0;
      mockedLend.position = {
        walletBalance: 2_000_000n,
        supplied: 2_000_000n,
        protocolWithdrawable: 2_000_000n,
        withdrawable: 2_000_000n,
        receiptShares: 0n,
        receiptMint: "11111111111111111111111111111112",
        receiptTokenAccount: "11111111111111111111111111111113",
        supplyRateRaw: 0n,
        rewardsRateRaw: 0n,
      };
      const context = createCommandContext(
        {
          configDir: directory,
          cluster: "mainnet",
          rpcUrl: "https://rpc.example.invalid",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: wallet.entry.id },
      );
      context.readPassphrase = async () => wallet.passphrase;
      const submitted: string[] = [];
      const accountInfoConfigs: unknown[] = [];
      context.getClient = () =>
        ({
          rpc: {
            getAccountInfo: (_account: string, config: unknown) => {
              accountInfoConfigs.push(config);
              return request({
                value: { owner: "11111111111111111111111111111111" },
              });
            },
            getLatestBlockhash: () =>
              request({
                value: {
                  blockhash: "11111111111111111111111111111111",
                  lastValidBlockHeight: 200n,
                },
              }),
            getBlockHeight: () => request(100n),
            getFeeForMessage: () => request({ value: 5_000n }),
            getBalance: () => request({ value: 10_000_000_000n }),
            simulateTransaction: () =>
              request({ value: { err: null, logs: [] } }),
            sendTransaction: (encoded: string) => {
              submitted.push(encoded);
              const transaction = Buffer.from(encoded, "base64");
              return request(bs58.encode(transaction.subarray(1, 65)));
            },
            getSignatureStatuses: () =>
              request({
                value: [
                  { err: null, confirmationStatus: "confirmed", slot: 101n },
                ],
              }),
          },
        }) as never;
      const signerCapture = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          writes.push(String(chunk));
          return true;
        });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });

      const keyPair = await createKeyPairFromBytes(secret, true);
      for (const action of ["deposit", "withdraw"]) {
        mockedLend.signerAddresses.length = 0;
        submitted.length = 0;
        await executeLine(context, `jupiter-lend ${action} 1 --yes --json`);
        expect(accountInfoConfigs.at(-1)).toEqual({
          commitment: "confirmed",
          encoding: "base64",
        });
        expect(mockedLend.signerAddresses).toEqual([wallet.address]);
        expect(submitted).toHaveLength(1);
        const wire = Buffer.from(submitted[0]!, "base64");
        expect(wire[0]).toBe(1);
        expect(
          await crypto.subtle.verify(
            "Ed25519",
            keyPair.publicKey,
            wire.subarray(1, 65),
            wire.subarray(65),
          ),
        ).toBe(true);
      }
      expect(
        JSON.parse(writes.find((line) => line.startsWith("{"))!).wallet,
      ).toMatchObject({
        id: wallet.entry.id,
        alias: "daily",
      });
      signerCapture.mockRestore();
    } finally {
      secret?.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function registerFixture(configDir: string) {
  const source = path.join(configDir, "input.json");
  await writeFile(source, `${JSON.stringify(KEYSTORE)}\n`, { mode: 0o600 });
  const registered = await createRegistryEntry(
    configDir,
    "daily",
    KEYSTORE.publicKey,
    source,
  );
  return registered.entry;
}

async function registerEncryptedFixture(configDir: string) {
  const secret = await normalizeSecretKey(
    Uint8Array.from({ length: 32 }, (_, index) => index + 101),
  );
  const walletAddress = await deriveAddress(secret);
  const passphrase = "unit-test-jupiter-passphrase";
  const source = path.join(configDir, "encrypted-input.json");
  const keystore = await encryptSecretKey(secret, walletAddress, passphrase);
  await writeFile(source, `${JSON.stringify(keystore)}\n`, { mode: 0o600 });
  const saved = await createRegistryEntry(
    configDir,
    "daily",
    walletAddress,
    source,
  );
  return { entry: saved.entry, address: walletAddress, passphrase, secret };
}

function request<T>(value: T) {
  return { send: async () => value };
}

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

const KEYSTORE = {
  version: 1,
  kind: "solana-private-key",
  publicKey: "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF",
  kdf: {
    name: "argon2id",
    memoryKiB: 65536,
    iterations: 3,
    parallelism: 1,
    salt: "AA==",
  },
  cipher: { name: "aes-256-gcm", iv: "AA==", tag: "AA==" },
  ciphertext: "AA==",
};
