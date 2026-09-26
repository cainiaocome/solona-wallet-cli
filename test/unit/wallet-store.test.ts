import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRegistryEntry,
  listOrphanIds,
  readRegistry,
  resolveWallet,
  validateAlias,
  withStoreLock,
} from "../../src/wallet/store.js";
import {
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
  writeKeystoreFileAtomic,
} from "../../src/wallet/keystore.js";

describe("multi-wallet store", () => {
  it("registers independent UUID keystores and preserves the first default", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-store-"),
    );
    try {
      const first = await makeKey(directory, 1);
      const second = await makeKey(directory, 2);
      const a = await createRegistryEntry(
        directory,
        "daily",
        first.address,
        first.path,
      );
      const b = await createRegistryEntry(
        directory,
        "savings",
        second.address,
        second.path,
      );
      const registry = await readRegistry(directory);
      expect(a.first).toBe(true);
      expect(b.first).toBe(false);
      expect(registry.defaultWalletId).toBe(a.entry.id);
      expect(registry.wallets).toHaveLength(2);
      expect(path.basename(a.entry.id)).toBe(a.entry.id);
      expect(
        await stat(path.join(directory, "wallets", `${a.entry.id}.json`)).then(
          (info) => info.mode & 0o777,
        ),
      ).toBe(0o600);
      expect(
        (await resolveWallet(directory, b.entry.id)).identity.address,
      ).toBe(second.address);
      expect(await readdir(path.join(directory, "wallets"))).toContain(
        `${b.entry.id}.json`,
      );
      expect(await listOrphanIds(directory, registry)).toEqual([]);
      expect(
        await readFile(path.join(directory, "wallets.json"), "utf8"),
      ).not.toContain("ciphertext");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects aliases, duplicate addresses, and concurrent registry writers safely", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-store-"),
    );
    try {
      expect(() => validateAlias("../wallet")).toThrow(/aliases/);
      const first = await makeKey(directory, 3);
      const second = await makeKey(directory, 4);
      await createRegistryEntry(directory, "daily", first.address, first.path);
      await expect(
        createRegistryEntry(directory, "daily", second.address, second.path),
      ).rejects.toThrow(/already in use/);
      await expect(
        createRegistryEntry(directory, "duplicate", first.address, first.path),
      ).rejects.toThrow(/already registered/);

      const outcomes = await Promise.allSettled([
        withStoreLock(
          directory,
          async () =>
            new Promise((resolve) => setTimeout(() => resolve("first"), 50)),
        ),
        withStoreLock(directory, async () => "second"),
      ]);
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        outcomes
          .filter((outcome) => outcome.status === "rejected")
          .map((outcome) => String(outcome.reason)),
      ).toEqual(
        expect.arrayContaining([expect.stringContaining("WalletStoreBusy")]),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to silently select unregistered UUID files", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-store-"),
    );
    try {
      const orphan = await makeKey(directory, 5);
      const uuid = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
      await mkdirWalletDirectory(directory);
      await writeFile(
        path.join(directory, "wallets", `${uuid}.json`),
        await readFile(orphan.path),
        { mode: 0o600 },
      );
      await expect(readRegistry(directory)).rejects.toThrow(/wallet recover/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects UUID keystore symlinks instead of treating them as missing wallets", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-store-"),
    );
    try {
      const key = await makeKey(directory, 6);
      const uuid = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
      await mkdirWalletDirectory(directory);
      await symlink(key.path, path.join(directory, "wallets", `${uuid}.json`));
      await expect(readRegistry(directory)).rejects.toThrow(
        /not a regular file/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function makeKey(directory: string, seed: number) {
  const secret = await normalizeSecretKey(
    Uint8Array.from({ length: 32 }, (_, i) => i + seed),
  );
  try {
    const address = await deriveAddress(secret);
    const encrypted = await encryptSecretKey(
      secret,
      address,
      `test-passphrase-${seed}`,
    );
    const keyPath = path.join(directory, `input-${seed}.json`);
    await writeKeystoreFileAtomic(keyPath, encrypted);
    return { address, path: keyPath };
  } finally {
    secret.fill(0);
  }
}

async function mkdirWalletDirectory(directory: string) {
  await mkdir(path.join(directory, "wallets"), { mode: 0o700 });
}
