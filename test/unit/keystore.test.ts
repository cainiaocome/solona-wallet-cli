import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import {
  deriveAddress,
  decodeBase58SecretKey,
  decryptSecretKey,
  encryptSecretKey,
  normalizeSecretKey,
  readKeypairFile,
  readKeystore,
  writeKeystoreAtomic,
} from "../../src/wallet/keystore.js";

describe("encrypted keystore", () => {
  it("round-trips a disposable deterministic key and uses authenticated metadata", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-keystore-"),
    );
    try {
      const secret = await normalizeSecretKey(
        Uint8Array.from({ length: 32 }, (_, index) => index),
      );
      const publicKey = await deriveAddress(secret);
      const file = await encryptSecretKey(
        secret,
        publicKey,
        "unit-test-passphrase",
      );
      await writeKeystoreAtomic(directory, file);
      const stored = await readKeystore(directory);
      expect(stored?.publicKey).toBe(publicKey);
      expect(stored?.ciphertext).not.toContain("unit-test-passphrase");
      const decrypted = await decryptSecretKey(stored!, "unit-test-passphrase");
      expect(await deriveAddress(decrypted)).toBe(publicKey);
      decrypted.fill(0);
      await expect(
        decryptSecretKey(stored!, "wrong-passphrase"),
      ).rejects.toThrow(/unlock/);
      const modified = {
        ...stored!,
        publicKey: "11111111111111111111111111111111",
      };
      await expect(
        decryptSecretKey(modified, "unit-test-passphrase"),
      ).rejects.toThrow(/unlock/);
      await expect(
        decryptSecretKey(
          { ...stored!, ciphertext: `A${stored!.ciphertext.slice(1)}` },
          "unit-test-passphrase",
        ),
      ).rejects.toThrow(/unlock/);
      await expect(
        decryptSecretKey(
          {
            ...stored!,
            cipher: {
              ...stored!.cipher,
              tag: `A${stored!.cipher.tag.slice(1)}`,
            },
          },
          "unit-test-passphrase",
        ),
      ).rejects.toThrow(/unlock/);
      expect(
        (await stat(path.join(directory, "keystore.json"))).mode & 0o777,
      ).toBe(0o600);
      expect(
        JSON.parse(
          await readFile(path.join(directory, "keystore.json"), "utf8"),
        ).privateKey,
      ).toBeUndefined();
      secret.fill(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates base58 and Solana JSON keypair input", async () => {
    const secret = await normalizeSecretKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 7),
    );
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-key-input-"),
    );
    try {
      const encoded = await decodeBase58SecretKey(bs58.encode(secret));
      expect(encoded).toEqual(secret);
      await expect(decodeBase58SecretKey("not base58 !")).rejects.toThrow(
        /base58/,
      );
      await expect(normalizeSecretKey(Uint8Array.of(1, 2, 3))).rejects.toThrow(
        /32 or 64/,
      );
      const file = path.join(directory, "keypair.json");
      await writeFile(file, JSON.stringify([...secret]));
      expect(await readKeypairFile(file)).toEqual(secret);
      await writeFile(file, JSON.stringify([256]));
      await expect(readKeypairFile(file)).rejects.toThrow(/byte array/);
    } finally {
      secret.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses replacement of an existing keystore", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-keystore-"),
    );
    try {
      const secret = await normalizeSecretKey(
        Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      );
      const file = await encryptSecretKey(
        secret,
        await deriveAddress(secret),
        "passphrase",
      );
      await writeKeystoreAtomic(directory, file);
      await expect(writeKeystoreAtomic(directory, file)).rejects.toThrow(
        /already exists/,
      );
      secret.fill(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
