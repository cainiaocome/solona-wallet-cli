import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Algorithm, hashRaw } from "@node-rs/argon2";
import bs58 from "bs58";
import {
  createKeyPairFromBytes,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
} from "@solana/kit";
import { z } from "zod";
import { InvalidPrivateKeyError, KeystoreError } from "../errors/errors.js";
import { keystoreFilePath } from "../config/config.js";

export const KDF_DEFAULTS = {
  name: "argon2id" as const,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
};

const keystoreSchema = z.object({
  version: z.literal(1),
  kind: z.literal("solana-private-key"),
  publicKey: z.string().min(32),
  kdf: z.object({
    name: z.literal("argon2id"),
    memoryKiB: z.number().int().positive(),
    iterations: z.number().int().positive(),
    parallelism: z.number().int().positive(),
    salt: z.string().min(1),
  }),
  cipher: z.object({
    name: z.literal("aes-256-gcm"),
    iv: z.string().min(1),
    tag: z.string().min(1),
  }),
  ciphertext: z.string().min(1),
});

export type KeystoreFile = z.infer<typeof keystoreSchema>;

function canonicalAad(
  file: Pick<KeystoreFile, "version" | "kind" | "publicKey" | "kdf" | "cipher">,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: file.version,
      kind: file.kind,
      publicKey: file.publicKey,
      kdf: {
        name: file.kdf.name,
        memoryKiB: file.kdf.memoryKiB,
        iterations: file.kdf.iterations,
        parallelism: file.kdf.parallelism,
      },
      cipher: { name: file.cipher.name },
    }),
  );
}

async function deriveKey(
  passphrase: string,
  salt: Buffer,
  memoryKiB: number,
  iterations: number,
  parallelism: number,
): Promise<Buffer> {
  const password = Buffer.from(passphrase, "utf8");
  try {
    return await hashRaw(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: memoryKiB,
      timeCost: iterations,
      parallelism,
      outputLen: 32,
      salt,
    });
  } finally {
    password.fill(0);
  }
}

async function publicKeyBytes(keyPair: {
  publicKey: CryptoKey;
}): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
}

export async function normalizeSecretKey(input: Uint8Array): Promise<Buffer> {
  try {
    if (input.length === 32) {
      const pair = await createKeyPairFromPrivateKeyBytes(input, true);
      const publicKey = await publicKeyBytes(pair);
      return Buffer.from(new Uint8Array([...input, ...publicKey]));
    }
    if (input.length === 64) {
      const pair = await createKeyPairFromBytes(input, true);
      const publicKey = await publicKeyBytes(pair);
      if (!Buffer.from(input.subarray(32)).equals(Buffer.from(publicKey)))
        throw new Error("public key mismatch");
      return Buffer.from(input);
    }
  } catch {
    throw new InvalidPrivateKeyError();
  }
  throw new InvalidPrivateKeyError(
    "A Solana private key must decode to 32 or 64 bytes.",
  );
}

export async function decodeBase58SecretKey(value: string): Promise<Buffer> {
  try {
    return await normalizeSecretKey(bs58.decode(value));
  } catch (error) {
    if (error instanceof InvalidPrivateKeyError) throw error;
    throw new InvalidPrivateKeyError("The private key is not valid base58.");
  }
}

export async function readKeypairFile(filePath: string): Promise<Buffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new InvalidPrivateKeyError("The keypair file is not valid JSON.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255,
    )
  ) {
    throw new InvalidPrivateKeyError(
      "The keypair file must contain a JSON byte array.",
    );
  }
  return normalizeSecretKey(new Uint8Array(parsed));
}

export async function deriveAddress(secretKey: Uint8Array): Promise<string> {
  const signer = await createKeyPairSignerFromBytes(secretKey);
  return signer.address;
}

export async function encryptSecretKey(
  secretKey: Uint8Array,
  publicKey: string,
  passphrase: string,
): Promise<KeystoreFile> {
  if (!passphrase)
    throw new KeystoreError("The keystore passphrase cannot be empty.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kdf = { ...KDF_DEFAULTS, salt: salt.toString("base64") };
  const fileWithoutCiphertext = {
    version: 1 as const,
    kind: "solana-private-key" as const,
    publicKey,
    kdf,
    cipher: {
      name: "aes-256-gcm" as const,
      iv: iv.toString("base64"),
      tag: "",
    },
  };
  const key = await deriveKey(
    passphrase,
    salt,
    kdf.memoryKiB,
    kdf.iterations,
    kdf.parallelism,
  );
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(canonicalAad(fileWithoutCiphertext));
    const ciphertext = Buffer.concat([
      cipher.update(secretKey),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      ...fileWithoutCiphertext,
      cipher: { ...fileWithoutCiphertext.cipher, tag: tag.toString("base64") },
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptSecretKey(
  file: KeystoreFile,
  passphrase: string,
): Promise<Buffer> {
  const salt = Buffer.from(file.kdf.salt, "base64");
  const iv = Buffer.from(file.cipher.iv, "base64");
  const tag = Buffer.from(file.cipher.tag, "base64");
  const ciphertext = Buffer.from(file.ciphertext, "base64");
  if (
    salt.length < 16 ||
    iv.length !== 12 ||
    tag.length !== 16 ||
    !ciphertext.length
  )
    throw new KeystoreError("Keystore cryptographic fields are malformed.");
  const key = await deriveKey(
    passphrase,
    salt,
    file.kdf.memoryKiB,
    file.kdf.iterations,
    file.kdf.parallelism,
  );
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(canonicalAad(file));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new KeystoreError(
      "Unable to unlock keystore. Check the passphrase or keystore integrity.",
    );
  } finally {
    key.fill(0);
  }
}

export async function readKeystore(
  configDir: string,
): Promise<KeystoreFile | null> {
  try {
    const raw = await readFile(keystoreFilePath(configDir), "utf8");
    const parsed = keystoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new KeystoreError("The keystore file is malformed.");
    return parsed.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof KeystoreError) throw error;
    throw new KeystoreError("Unable to read keystore.");
  }
}

export async function writeKeystoreAtomic(
  configDir: string,
  file: KeystoreFile,
): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const target = keystoreFilePath(configDir);
  try {
    await readFile(target);
    throw new KeystoreError(
      "A keystore already exists. Refusing to replace it.",
    );
  } catch (error) {
    if (error instanceof KeystoreError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new KeystoreError("Unable to inspect the existing keystore.");
  }
  const temp = `${target}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temp, 0o600);
    await rename(temp, target);
    await chmod(target, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    if (error instanceof KeystoreError) throw error;
    throw new KeystoreError("Unable to write keystore atomically.");
  }
}

export async function unlockAndValidate(
  configDir: string,
  passphrase: string,
): Promise<Buffer> {
  const file = await readKeystore(configDir);
  if (!file)
    throw new KeystoreError("No wallet is imported. Run `wallet import`.");
  const secret = await decryptSecretKey(file, passphrase);
  try {
    const derivedAddress = await deriveAddress(secret);
    if (derivedAddress !== file.publicKey)
      throw new KeystoreError(
        "Keystore public address does not match its encrypted key.",
      );
    return secret;
  } catch (error) {
    secret.fill(0);
    if (error instanceof KeystoreError) throw error;
    throw new KeystoreError("The decrypted key is invalid.");
  }
}
