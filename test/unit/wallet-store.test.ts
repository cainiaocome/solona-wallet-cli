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
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRegistryEntry,
  listOrphanIds,
  readRegistry,
  readRawKeystore,
  registerExistingKeystore,
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

  it("publishes a registry through an intentionally symlinked config root", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "sol-wallet-target-"));
    const configLink = path.join(
      os.tmpdir(),
      `sol-wallet-link-${randomUUID()}`,
    );
    try {
      const key = await makeKey(target, 7);
      await symlink(target, configLink);
      const saved = await createRegistryEntry(
        configLink,
        "daily",
        key.address,
        key.path,
      );
      expect((await readRegistry(configLink)).wallets[0]?.id).toBe(
        saved.entry.id,
      );
      expect(
        await resolveWallet(configLink, saved.entry.id).then(
          (wallet) => wallet.identity.address,
        ),
      ).toBe(key.address);
    } finally {
      await rm(configLink, { force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("recovers a published orphan without replacing its encrypted bytes", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-orphan-"),
    );
    try {
      const key = await makeKey(directory, 8);
      const id = "d8ed414d-2175-4ab6-a0c9-4388514f5952";
      await mkdirWalletDirectory(directory);
      const orphanPath = path.join(directory, "wallets", `${id}.json`);
      const original = await readFile(key.path);
      await writeFile(orphanPath, original, { mode: 0o600 });
      await expect(readRegistry(directory)).rejects.toThrow(/wallet recover/);

      const recovered = await registerExistingKeystore(
        directory,
        id,
        "recovered",
        key.address,
        await readRawKeystore(orphanPath),
      );
      expect(recovered.first).toBe(true);
      expect((await readFile(orphanPath)).equals(original)).toBe(true);
      expect((await readRegistry(directory)).defaultWalletId).toBe(id);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lists an unrelated UUID symlink as an orphan without hiding registered wallets", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-orphan-list-"),
    );
    try {
      const key = await makeKey(directory, 9);
      const saved = await createRegistryEntry(
        directory,
        "daily",
        key.address,
        key.path,
      );
      const unrelated = "a8ed414d-2175-4ab6-a0c9-4388514f5952";
      await symlink(
        key.path,
        path.join(directory, "wallets", `${unrelated}.json`),
      );
      expect(await resolveWallet(directory, saved.entry.id)).toBeDefined();
      expect(
        await listOrphanIds(directory, await readRegistry(directory)),
      ).toEqual([unrelated]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("allows a busy import to be retried without losing either registry entry", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-import-contention-"),
    );
    try {
      const first = await makeKey(directory, 10);
      const second = await makeKey(directory, 11);
      let signalAcquired!: () => void;
      let releaseLock!: () => void;
      const acquired = new Promise<void>((resolve) => {
        signalAcquired = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const holder = withStoreLock(directory, async () => {
        signalAcquired();
        await blocked;
      });
      await acquired;
      try {
        await expect(
          createRegistryEntry(directory, "daily", first.address, first.path),
        ).rejects.toThrow(/Another process is changing wallet data/);
      } finally {
        releaseLock();
      }
      await holder;
      await createRegistryEntry(directory, "daily", first.address, first.path);
      await createRegistryEntry(
        directory,
        "savings",
        second.address,
        second.path,
      );
      expect(
        (await readRegistry(directory)).wallets.map((wallet) => wallet.alias),
      ).toEqual(["daily", "savings"]);
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
