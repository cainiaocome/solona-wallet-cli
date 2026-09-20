import type {
  Address,
  SignatureDictionary,
  Transaction,
  TransactionPartialSigner,
  TransactionWithLifetime,
  TransactionWithinSizeLimit,
} from "@solana/kit";
import { address, createKeyPairSignerFromBytes } from "@solana/kit";
import { readKeystore, unlockAndValidate } from "./keystore.js";

/**
 * Lazy signer for the encrypted local wallet.
 *
 * Constructing this object is safe: it stores only the public address. The
 * passphrase is requested and the key is decrypted only when Kit asks the
 * signer to sign a fully prepared transaction.
 */
export type PassphraseReader = () => Promise<string>;

export class EncryptedKeystoreSigner implements TransactionPartialSigner {
  readonly address: Address;

  constructor(
    private readonly configDir: string,
    walletAddress: string,
    private readonly readPassphrase: PassphraseReader,
  ) {
    this.address = address(walletAddress);
  }

  async signTransactions(
    transactions: readonly (Transaction &
      TransactionWithinSizeLimit &
      TransactionWithLifetime)[],
  ): Promise<readonly SignatureDictionary[]> {
    const passphrase = await this.readPassphrase();
    const secret = await unlockAndValidate(this.configDir, passphrase);
    try {
      const signer = await createKeyPairSignerFromBytes(secret);
      return await signer.signTransactions(transactions);
    } finally {
      secret.fill(0);
    }
  }
}

export async function getWalletAddress(
  configDir: string,
): Promise<string | null> {
  const file = await readKeystore(configDir);
  return file?.publicKey ?? null;
}
