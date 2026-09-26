import { unlink } from "node:fs/promises";
import { confirm, readSecret } from "../shell/prompt.js";
import {
  decryptSecretKey,
  deriveAddress,
  decodeBase58SecretKey,
  encryptSecretKey,
  readKeypairFile,
  readKeystoreFile,
} from "../wallet/keystore.js";
import {
  createRegistryEntry,
  createRegistryEntryFromRecovery,
  ensureWalletDirectory,
  findLegacyKeystore,
  finalizeTempKeystore,
  makeKeystoreTemp,
  readRawKeystore,
  readRegistry,
  registerExistingKeystore,
  readRegistryForRecovery,
  resolveWallet,
  assertAddressAvailable,
  assertAliasAvailable,
  validateAlias,
  validateWalletId,
  writeEncryptedTemp,
} from "../wallet/store.js";
import type { CommandContext } from "./context.js";
import { KeystoreError, WalletStoreError } from "../errors/errors.js";

/** Import, migrate, or explicitly recover an encrypted wallet. */
export async function importWallet(
  context: CommandContext,
  alias: string,
  keypairPath?: string,
): Promise<void> {
  validateAlias(alias);
  await assertAliasAvailable(context.config.configDir, alias);
  const secret = keypairPath
    ? await readKeypairFile(keypairPath)
    : await decodeBase58SecretKey(
        await readSecret("Paste Solana private key: "),
      );
  let temporary: string | undefined;
  try {
    const publicKey = await deriveAddress(secret);
    await assertAddressAvailable(context.config.configDir, publicKey);
    if (!context.output.json)
      context.output.print(
        { ok: true, address: publicKey, alias },
        `Derived address for '${alias}': ${publicKey}`,
      );
    if (!(await confirm("Is this the expected wallet address?")))
      throw new KeystoreError("Wallet import cancelled.");
    const passphrase = await readSecret("New keystore passphrase: ");
    const confirmation = await readSecret("Confirm passphrase: ");
    if (!passphrase || passphrase !== confirmation)
      throw new KeystoreError("Passphrases do not match or are empty.");
    const encrypted = await encryptSecretKey(secret, publicKey, passphrase);
    const verified = await decryptSecretKey(encrypted, passphrase);
    try {
      if ((await deriveAddress(verified)) !== publicKey)
        throw new KeystoreError("Encrypted wallet verification failed.");
    } finally {
      verified.fill(0);
    }
    temporary = await makeKeystoreTemp(context.config.configDir);
    await finalizeTempKeystore(temporary, encrypted);
    const stored = await readKeystoreFile(temporary);
    if (!stored || stored.publicKey !== publicKey)
      throw new KeystoreError("Written wallet could not be verified.");
    const storedSecret = await decryptSecretKey(stored, passphrase);
    try {
      if ((await deriveAddress(storedSecret)) !== publicKey)
        throw new KeystoreError(
          "Written wallet failed its decrypt-and-derive check.",
        );
    } finally {
      storedSecret.fill(0);
    }
    const result = await createRegistryEntry(
      context.config.configDir,
      alias,
      publicKey,
      temporary,
    );
    if (result.first && context.session.currentWalletId === null)
      context.session.currentWalletId = result.entry.id;
    const registry = await readRegistry(context.config.configDir);
    context.output.print(
      {
        ok: true,
        action: "import",
        imported: true,
        wallet: walletView(result.entry),
        currentWalletId: context.session.currentWalletId,
        defaultWalletId: registry.defaultWalletId,
        changed: true,
      },
      `Wallet '${alias}' imported. Address: ${publicKey}${result.first ? "\nIt is now the current and default wallet." : `\nSelect it with: wallet use ${alias}`}`,
    );
  } finally {
    secret.fill(0);
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}

export async function migrateWallet(
  context: CommandContext,
  alias: string,
): Promise<void> {
  validateAlias(alias);
  const legacyPath = await findLegacyKeystore(context.config.configDir);
  if (!legacyPath)
    throw new WalletStoreError(
      "WalletMigrationRequired",
      "No legacy keystore.json was found.",
      2,
    );
  const originalBytes = await readRawKeystore(legacyPath);
  const file = await readKeystoreFile(legacyPath);
  if (!file) throw new KeystoreError("Legacy keystore is malformed.");
  if (!(await readRawKeystore(legacyPath)).equals(originalBytes))
    throw new KeystoreError(
      "Legacy keystore changed while preparing migration; retry.",
    );
  const currentRegistry = await readRegistryForRecovery(
    context.config.configDir,
  );
  const alreadyMigrated = currentRegistry.wallets.find(
    (wallet) => wallet.address === file.publicKey,
  );
  if (alreadyMigrated) {
    if (alreadyMigrated.alias !== alias)
      throw new WalletStoreError(
        "WalletAlreadyExists",
        `Legacy wallet is already registered as '${alreadyMigrated.alias}'. Use wallet rename ${alreadyMigrated.alias} ${alias} if you want that alias.`,
        2,
      );
    context.walletStoreError = undefined;
    context.output.print(
      {
        ok: true,
        action: "migrate",
        wallet: walletView(alreadyMigrated),
        currentWalletId: context.session.currentWalletId,
        defaultWalletId: currentRegistry.defaultWalletId,
        alreadyMigrated: true,
        legacyPreserved: true,
        changed: false,
      },
      `Legacy wallet was already migrated as '${alias}'.`,
    );
    return;
  }
  if (currentRegistry.wallets.length > 0)
    throw new WalletStoreError(
      "WalletAlreadyExists",
      "Migration only adds the legacy wallet to an empty registry. Keep keystore.json as a recovery copy and import the original key through the normal wallet import flow if you need to combine stores.",
      2,
    );
  const passphrase = await readSecret(
    `Passphrase for ${alias} (legacy wallet): `,
  );
  const secret = await decryptSecretKey(file, passphrase);
  try {
    if ((await deriveAddress(secret)) !== file.publicKey)
      throw new KeystoreError("Legacy keystore address verification failed.");
  } finally {
    secret.fill(0);
  }
  let temporary: string | undefined;
  try {
    temporary = await writeEncryptedTemp(
      context.config.configDir,
      originalBytes,
    );
    const stagedBytes = await readRawKeystore(temporary);
    if (!stagedBytes.equals(originalBytes))
      throw new KeystoreError(
        "Staged legacy keystore changed before migration.",
      );
    const result = await createRegistryEntryFromRecovery(
      context.config.configDir,
      alias,
      file.publicKey,
      temporary,
    );
    if (result.first && context.session.currentWalletId === null)
      context.session.currentWalletId = result.entry.id;
    const registry = await readRegistry(context.config.configDir);
    context.output.print(
      {
        ok: true,
        action: "migrate",
        wallet: walletView(result.entry),
        currentWalletId: context.session.currentWalletId,
        defaultWalletId: registry.defaultWalletId,
        legacyPreserved: true,
        changed: true,
      },
      `Legacy wallet migrated as '${alias}'. Address: ${result.entry.address}\nThe original encrypted keystore.json was preserved.`,
    );
  } finally {
    if (temporary) await unlink(temporary).catch(() => undefined);
  }
}

export async function recoverWallet(
  context: CommandContext,
  idValue: string,
  alias: string,
): Promise<void> {
  const id = validateWalletId(idValue);
  validateAlias(alias);
  await ensureWalletDirectory(context.config.configDir);
  const keystorePath = `${context.config.configDir}/wallets/${id}.json`;
  const bytes = await readRawKeystore(keystorePath);
  const file = await readKeystoreFile(keystorePath);
  if (!file) throw new KeystoreError("Encrypted wallet file is malformed.");
  const passphrase = await readSecret(
    `Passphrase for ${alias} (${id.slice(0, 8)}): `,
  );
  const secret = await decryptSecretKey(file, passphrase);
  try {
    if ((await deriveAddress(secret)) !== file.publicKey)
      throw new KeystoreError(
        "Recovered key does not match encrypted wallet metadata.",
      );
  } finally {
    secret.fill(0);
  }
  const result = await registerExistingKeystore(
    context.config.configDir,
    id,
    alias,
    file.publicKey,
    bytes,
  );
  if (result.first && context.session.currentWalletId === null)
    context.session.currentWalletId = result.entry.id;
  const selected = await resolveWallet(
    context.config.configDir,
    result.entry.id,
  );
  const registry = await readRegistry(context.config.configDir);
  context.output.print(
    {
      ok: true,
      action: "recover",
      wallet: walletView(result.entry),
      currentWalletId: context.session.currentWalletId,
      defaultWalletId: registry.defaultWalletId,
      changed: result.changed,
    },
    `Encrypted wallet registered as '${alias}'. Address: ${selected.identity.address}`,
  );
}

function walletView(entry: { id: string; alias: string; address: string }) {
  return { id: entry.id, alias: entry.alias, address: entry.address };
}
