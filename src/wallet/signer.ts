import type {
  Address,
  SignatureDictionary,
  Transaction,
  TransactionPartialSigner,
  TransactionWithLifetime,
  TransactionWithinSizeLimit,
} from "@solana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readKeystoreFile, unlockFileAndValidate } from "./keystore.js";
import type { SelectedWallet } from "./store.js";
import { KeystoreError } from "../errors/errors.js";

/**
 * Lazy signer for the encrypted local wallet.
 *
 * Constructing this object is safe: it captures the selected UUID, alias,
 * address, and exact keystore path, but no secret key. It never re-reads a
 * default or resolves an alias while signing. The passphrase is requested and
 * the key is decrypted only when Kit asks the signer to sign a prepared
 * transaction.
 */
export type PassphraseReader = () => Promise<string>;

export class EncryptedKeystoreSigner implements TransactionPartialSigner {
  readonly address: Address;
  private beforeSign?: () => Promise<void>;

  constructor(
    private readonly selectedWallet: SelectedWallet,
    private readonly readPassphrase: PassphraseReader,
  ) {
    this.address = selectedWallet.identity.address;
  }

  /** Run transaction lifetime checks after passphrase entry and before signing. */
  setBeforeSign(check: () => Promise<void>): void {
    this.beforeSign = check;
  }

  async signTransactions(
    transactions: readonly (Transaction &
      TransactionWithinSizeLimit &
      TransactionWithLifetime)[],
  ): Promise<readonly SignatureDictionary[]> {
    const file = await readKeystoreFile(this.selectedWallet.keystorePath);
    if (!file || file.publicKey !== this.selectedWallet.identity.address)
      throw new KeystoreError(
        "Selected wallet keystore changed before signing.",
      );
    const passphrase = await this.readPassphrase();
    const secret = await unlockFileAndValidate(file, passphrase);
    try {
      await this.beforeSign?.();
      const signer = await createKeyPairSignerFromBytes(secret);
      if (signer.address !== this.selectedWallet.identity.address)
        throw new KeystoreError("Selected wallet signer identity mismatch.");
      return await signer.signTransactions(transactions);
    } finally {
      secret.fill(0);
    }
  }
}
