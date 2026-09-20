import { unlink } from "node:fs/promises";
import { flagValue, hasFlag, type ParsedCommand } from "../shell/parser.js";
import { readLine, readSecret, confirm } from "../shell/prompt.js";
import {
  deriveAddress,
  decodeBase58SecretKey,
  encryptSecretKey,
  readKeypairFile,
  readKeystore,
  decryptSecretKey,
  writeKeystoreAtomic,
} from "../wallet/keystore.js";
import type { CommandContext } from "./context.js";
import { KeystoreError } from "../errors/errors.js";

export async function importWallet(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (await readKeystore(context.config.configDir))
    throw new KeystoreError(
      "A wallet is already imported. Replacement is not supported in v0.1.",
    );
  const keypairPath = flagValue(command, "keypair-file");
  const secret = keypairPath
    ? await readKeypairFile(keypairPath)
    : await decodeBase58SecretKey(
        await readSecret("Paste Solana private key: "),
      );
  let created = false;
  try {
    const publicKey = await deriveAddress(secret);
    context.output.print(
      { ok: true, address: publicKey },
      `Derived address: ${publicKey}`,
    );
    if (!(await confirm("Is this the expected wallet address?")))
      throw new KeystoreError("Wallet import cancelled.");
    const passphrase = await readSecret("New keystore passphrase: ");
    const confirmation = await readSecret("Confirm passphrase: ");
    if (!passphrase || passphrase !== confirmation)
      throw new KeystoreError("Passphrases do not match or are empty.");
    const encrypted = await encryptSecretKey(secret, publicKey, passphrase);
    await writeKeystoreAtomic(context.config.configDir, encrypted);
    created = true;
    const written = await readKeystore(context.config.configDir);
    if (!written)
      throw new KeystoreError("Keystore disappeared after writing.");
    const roundTrip = await decryptSecretKey(written, passphrase);
    try {
      if ((await deriveAddress(roundTrip)) !== publicKey)
        throw new KeystoreError("Post-write keystore validation failed.");
    } finally {
      roundTrip.fill(0);
    }
    context.output.print(
      { ok: true, address: publicKey, imported: true },
      `Wallet imported. Address: ${publicKey}`,
    );
  } catch (error) {
    if (created)
      await unlink(`${context.config.configDir}/keystore.json`).catch(
        () => undefined,
      );
    throw error;
  } finally {
    secret.fill(0);
  }
}
