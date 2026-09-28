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
import { afterEach, describe, expect, it, vi } from "vitest";
import * as prompt from "../../src/shell/prompt.js";
import { createCommandContext } from "../../src/commands/context.js";
import { executeLine } from "../../src/commands/execute.js";
import { Output } from "../../src/output/output.js";
import {
  walletChangePassphrase,
  walletDefault,
  walletDelete,
  walletInfo,
  walletList,
  walletRename,
  walletUse,
} from "../../src/commands/wallet-management.js";
import {
  createRegistryEntry,
  readRawKeystore,
  readRegistry,
} from "../../src/wallet/store.js";
import {
  decryptSecretKey,
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
  parseKeystoreFile,
  unlockFileAndValidate,
  writeKeystoreFileAtomic,
} from "../../src/wallet/keystore.js";
import { walletKeystorePath } from "../../src/config/config.js";

describe("wallet management commands", () => {
  afterEach(() => vi.restoreAllMocks());

  it("aligns wallet-info labels and values", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-info-columns-"),
    );
    const output: string[] = [];
    try {
      const key = await createFixture(configDir, 21);
      await createRegistryEntry(configDir, "demo", key.address, key.path);
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await walletInfo(context, "demo");

      const labels = output
        .join("")
        .trimEnd()
        .split("\n")
        .map((line) => line.indexOf(":"));
      expect(new Set(labels).size).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("aligns wallet-list values under their headings for long aliases and addresses", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-list-columns-"),
    );
    const output: string[] = [];
    try {
      const firstKey = await createFixture(configDir, 22);
      const secondKey = await createFixture(configDir, 62);
      const first = await createRegistryEntry(
        configDir,
        "demo",
        firstKey.address,
        firstKey.path,
      );
      await createRegistryEntry(
        configDir,
        "longer_alias",
        secondKey.address,
        secondKey.path,
      );
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: first.entry.id },
      );
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await walletList(context);

      const [header, , firstRow, secondRow] = output
        .join("")
        .trimEnd()
        .split("\n");
      expect(firstRow!.indexOf("demo")).toBe(header!.indexOf("ALIAS"));
      expect(firstRow!.indexOf(firstKey.address)).toBe(
        header!.indexOf("ADDRESS"),
      );
      expect(secondRow!.indexOf("longer_alias")).toBe(header!.indexOf("ALIAS"));
      expect(secondRow!.indexOf(secondKey.address)).toBe(
        header!.indexOf("ADDRESS"),
      );
      expect(firstRow!.indexOf("*", 1)).toBe(header!.indexOf("DEFAULT"));
    } finally {
      vi.restoreAllMocks();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("shows orphan UUID files in human wallet-list output", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-list-orphan-"),
    );
    const output: string[] = [];
    try {
      const key = await createFixture(configDir, 14);
      await createRegistryEntry(configDir, "daily", key.address, key.path);
      const orphanId = randomUUID();
      await symlink(
        key.path,
        path.join(configDir, "wallets", `${orphanId}.json`),
      );
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });

      await walletList(context);

      expect(output.join("")).toContain(orphanId);
      expect(output.join("")).toContain("daily");
    } finally {
      vi.restoreAllMocks();
      await rm(configDir, { recursive: true, force: true });
    }
  });

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

  it("deletes the selected local wallet without changing chain or recovery data", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-delete-current-"),
    );
    try {
      const firstKey = await createFixture(configDir, 71);
      const secondKey = await createFixture(configDir, 72);
      const primary = await createRegistryEntry(
        configDir,
        "primary",
        firstKey.address,
        firstKey.path,
      );
      const savings = await createRegistryEntry(
        configDir,
        "savings",
        secondKey.address,
        secondKey.path,
      );
      const hintPath = path.join(
        configDir,
        "stake-accounts",
        savings.entry.id,
        "devnet.json",
      );
      const hint = Buffer.from("public stake recovery metadata");
      const legacyPath = path.join(configDir, "keystore.json");
      const legacyBackup = await readFile(secondKey.path);
      await mkdir(path.dirname(hintPath), { recursive: true, mode: 0o700 });
      await writeFile(hintPath, hint, { mode: 0o600 });
      await writeFile(legacyPath, legacyBackup, { mode: 0o600 });

      const context = createCommandContext(
        {
          configDir,
          cluster: "devnet",
          rpcUrl: "https://api.devnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: savings.entry.id, yes: true },
      );
      context.output = new SilentOutput();
      context.getClient = () => {
        throw new Error("wallet deletion must not make an RPC request");
      };

      await walletDelete(context, "savings");

      const registry = await readRegistry(configDir);
      expect(registry.wallets.map((wallet) => wallet.alias)).toEqual([
        "primary",
      ]);
      expect(registry.defaultWalletId).toBe(primary.entry.id);
      expect(context.session.currentWalletId).toBeNull();
      expect(context.completion.walletAliases).toEqual(["primary"]);
      await expect(
        readFile(walletKeystorePath(configDir, savings.entry.id)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(hintPath)).toEqual(hint);
      expect(await readFile(legacyPath)).toEqual(legacyBackup);

      await walletDelete(context, "primary", true);
      const emptyRegistry = await readRegistry(configDir);
      expect(emptyRegistry).toEqual({
        version: 1,
        defaultWalletId: null,
        wallets: [],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("requires changing the saved default before deleting it", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-delete-default-"),
    );
    try {
      const first = await createFixture(configDir, 73);
      const second = await createFixture(configDir, 74);
      await createRegistryEntry(
        configDir,
        "primary",
        first.address,
        first.path,
      );
      const secondary = await createRegistryEntry(
        configDir,
        "secondary",
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
        { yes: true },
      );
      context.output = new SilentOutput();

      await expect(walletDelete(context, "primary")).rejects.toThrow(
        /wallet default <another-alias>/,
      );
      expect((await readRegistry(configDir)).wallets).toHaveLength(2);
      expect(
        await readRawKeystore(
          walletKeystorePath(configDir, secondary.entry.id),
        ),
      ).toBeInstanceOf(Buffer);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("refuses non-interactive deletion unless --yes is explicitly enabled", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-delete-non-tty-"),
    );
    try {
      const fixture = await createFixture(configDir, 75);
      await createRegistryEntry(
        configDir,
        "daily",
        fixture.address,
        fixture.path,
      );
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      context.output = new SilentOutput();

      await expect(walletDelete(context, "daily")).rejects.toThrow(
        /requires an interactive terminal/,
      );
      expect((await readRegistry(configDir)).wallets).toHaveLength(1);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("deletes through the command dispatcher and emits one JSON result", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-delete-json-"),
    );
    try {
      const fixture = await createFixture(configDir, 79);
      const saved = await createRegistryEntry(
        configDir,
        "daily",
        fixture.address,
        fixture.path,
      );
      const context = createCommandContext(
        {
          configDir,
          cluster: "devnet",
          rpcUrl: "https://api.devnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
        { currentWalletId: saved.entry.id },
      );
      context.getClient = () => {
        throw new Error("wallet deletion must not make an RPC request");
      };
      const stdout: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });

      await executeLine(context, "wallet delete daily --yes --json");

      expect(stdout).toHaveLength(1);
      expect(JSON.parse(stdout.join("").trim())).toMatchObject({
        ok: true,
        action: "delete",
        deleted: true,
        wallet: {
          id: saved.entry.id,
          alias: "daily",
          address: fixture.address,
        },
        currentWalletId: null,
        defaultWalletId: null,
        keystore: "removed",
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("validates wallet lifecycle arguments and flags before prompting or storage", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-lifecycle-parse-"),
    );
    try {
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      context.output = new SilentOutput();
      context.readPassphrase = vi.fn(() => {
        throw new Error("must not prompt");
      });

      await expect(
        executeLine(context, "wallet change-passphrase daily --yes"),
      ).rejects.toThrow(/Unknown flag: --yes/);
      await expect(
        executeLine(context, "wallet delete daily extra --yes"),
      ).rejects.toThrow(/Usage: wallet delete/);
      await expect(
        executeLine(context, "wallet delete daily --yes=true"),
      ).rejects.toThrow(/--yes does not accept a value/);
      expect(context.readPassphrase).not.toHaveBeenCalled();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rotates a passphrase without changing the wallet identity or selection", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-passphrase-rotate-"),
    );
    try {
      const fixture = await createFixture(configDir, 76);
      const saved = await createRegistryEntry(
        configDir,
        "daily",
        fixture.address,
        fixture.path,
      );
      const target = walletKeystorePath(configDir, saved.entry.id);
      const before = await readRawKeystore(target);
      const registryBefore = await readRegistry(configDir);
      const context = createCommandContext(
        {
          configDir,
          cluster: "devnet",
          rpcUrl: "https://api.devnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
        { currentWalletId: saved.entry.id },
      );
      context.readPassphrase = vi.fn().mockResolvedValue("test-wallet-76");
      context.getClient = () => {
        throw new Error("passphrase rotation must not make an RPC request");
      };
      const stdout: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
      vi.spyOn(prompt, "readSecret")
        .mockResolvedValueOnce("new-private-passphrase")
        .mockResolvedValueOnce("new-private-passphrase");

      await walletChangePassphrase(context, "daily");

      const after = await readRawKeystore(target);
      expect(after).not.toEqual(before);
      expect((await stat(target)).mode & 0o777).toBe(0o600);
      expect(
        (await readdir(path.dirname(target))).some((name) =>
          name.startsWith(".passphrase-"),
        ),
      ).toBe(false);
      expect(context.session.currentWalletId).toBe(saved.entry.id);
      expect(context.commandWallet).toBeUndefined();
      expect(await readRegistry(configDir)).toEqual(registryBefore);
      const backupSecret = await unlockFileAndValidate(
        parseKeystoreFile(await readFile(fixture.path)),
        "test-wallet-76",
      );
      expect(backupSecret).toBeInstanceOf(Buffer);
      backupSecret.fill(0);
      expect(stdout).toHaveLength(1);
      expect(stdout.join("")).not.toContain("test-wallet-76");
      expect(stdout.join("")).not.toContain("new-private-passphrase");
      expect(JSON.parse(stdout.join("").trim())).toMatchObject({
        ok: true,
        action: "change-passphrase",
        changed: true,
        wallet: { alias: "daily", address: fixture.address },
      });
      const changedFile = parseKeystoreFile(after);
      expect(changedFile.publicKey).toBe(fixture.address);
      const newSecret = await unlockFileAndValidate(
        changedFile,
        "new-private-passphrase",
      );
      newSecret.fill(0);
      await expect(
        decryptSecretKey(changedFile, "test-wallet-76"),
      ).rejects.toThrow(/unlock/);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite a keystore changed while passphrase prompts are open", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-passphrase-race-"),
    );
    try {
      const fixture = await createFixture(configDir, 78);
      const saved = await createRegistryEntry(
        configDir,
        "daily",
        fixture.address,
        fixture.path,
      );
      const target = walletKeystorePath(configDir, saved.entry.id);
      const initial = await readRawKeystore(target);
      const externallyChanged = Buffer.concat([initial, Buffer.from(" ")]);
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      context.output = new SilentOutput();
      context.readPassphrase = async () => {
        await writeFile(target, externallyChanged, { mode: 0o600 });
        return "test-wallet-78";
      };
      vi.spyOn(prompt, "readSecret")
        .mockResolvedValueOnce("new-private-passphrase")
        .mockResolvedValueOnce("new-private-passphrase");

      await expect(walletChangePassphrase(context, "daily")).rejects.toThrow(
        /keystore changed while its passphrase was being updated/,
      );
      expect(await readRawKeystore(target)).toEqual(externallyChanged);
      expect(
        (await readdir(path.dirname(target))).some((name) =>
          name.startsWith(".passphrase-"),
        ),
      ).toBe(false);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("leaves the original keystore untouched after a bad old or mismatched new passphrase", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-passphrase-failure-"),
    );
    try {
      const fixture = await createFixture(configDir, 77);
      const saved = await createRegistryEntry(
        configDir,
        "daily",
        fixture.address,
        fixture.path,
      );
      const target = walletKeystorePath(configDir, saved.entry.id);
      const original = await readRawKeystore(target);
      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: false, verbose: false },
      );
      context.output = new SilentOutput();
      context.readPassphrase = vi
        .fn()
        .mockResolvedValue("wrong-old-passphrase");
      const newPassphrasePrompt = vi.spyOn(prompt, "readSecret");

      await expect(walletChangePassphrase(context, "daily")).rejects.toThrow(
        /Unable to unlock/,
      );
      expect(newPassphrasePrompt).not.toHaveBeenCalled();
      expect(await readRawKeystore(target)).toEqual(original);

      context.readPassphrase = vi.fn().mockResolvedValue("test-wallet-77");
      newPassphrasePrompt
        .mockResolvedValueOnce("test-wallet-77")
        .mockResolvedValueOnce("test-wallet-77");
      await expect(walletChangePassphrase(context, "daily")).rejects.toThrow(
        /different passphrase/,
      );
      expect(await readRawKeystore(target)).toEqual(original);

      newPassphrasePrompt
        .mockResolvedValueOnce("new-private-passphrase")
        .mockResolvedValueOnce("different-confirmation");
      await expect(walletChangePassphrase(context, "daily")).rejects.toThrow(
        /do not match/,
      );
      expect(await readRawKeystore(target)).toEqual(original);

      newPassphrasePrompt.mockResolvedValueOnce("").mockResolvedValueOnce("");
      await expect(walletChangePassphrase(context, "daily")).rejects.toThrow(
        /empty/,
      );
      expect(await readRawKeystore(target)).toEqual(original);
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
