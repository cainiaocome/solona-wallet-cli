import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../src/commands/context.js";
import { Output } from "../../src/output/output.js";
import {
  walletDefault,
  walletRename,
  walletUse,
} from "../../src/commands/wallet-management.js";
import { readRegistry, createRegistryEntry } from "../../src/wallet/store.js";
import {
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
  writeKeystoreFileAtomic,
} from "../../src/wallet/keystore.js";

describe("wallet management commands", () => {
  it("keeps current selection separate from saved default and preserves UUID on rename", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-manage-"),
    );
    try {
      const first = await createFixture(configDir, 15);
      const second = await createFixture(configDir, 45);
      const primary = await createRegistryEntry(
        configDir,
        "primary",
        first.address,
        first.path,
      );
      const savings = await createRegistryEntry(
        configDir,
        "savings",
        second.address,
        second.path,
      );
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: primary.entry.id, executionMode: "interactive" },
      );
      context.output = new SilentOutput();

      await walletUse(context, "savings");
      expect(context.session.currentWalletId).toBe(savings.entry.id);
      expect((await readRegistry(configDir)).defaultWalletId).toBe(
        primary.entry.id,
      );

      await walletDefault(context, "primary");
      expect(context.session.currentWalletId).toBe(savings.entry.id);
      expect((await readRegistry(configDir)).defaultWalletId).toBe(
        primary.entry.id,
      );

      await walletRename(context, "savings", "vault");
      const registry = await readRegistry(configDir);
      expect(context.session.currentWalletId).toBe(savings.entry.id);
      expect(
        registry.wallets.find((wallet) => wallet.id === savings.entry.id),
      ).toMatchObject({
        alias: "vault",
        address: second.address,
      });
      expect((await readRegistry(configDir)).defaultWalletId).toBe(
        primary.entry.id,
      );

      context.session.executionMode = "oneshot";
      await expect(walletUse(context, "primary")).rejects.toThrow(
        /startup `--wallet/,
      );
      expect(context.session.currentWalletId).toBe(savings.entry.id);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

class SilentOutput extends Output {
  constructor() {
    super({ json: false, verbose: false });
  }

  override print(): void {}
}

async function createFixture(configDir: string, seed: number) {
  const secret = await normalizeSecretKey(
    Uint8Array.from({ length: 32 }, (_, index) => index + seed),
  );
  try {
    const address = await deriveAddress(secret);
    const encrypted = await encryptSecretKey(
      secret,
      address,
      `test-wallet-${seed}`,
    );
    const filePath = path.join(configDir, `input-${seed}.json`);
    await writeKeystoreFileAtomic(filePath, encrypted);
    return { address, path: filePath };
  } finally {
    secret.fill(0);
  }
}
