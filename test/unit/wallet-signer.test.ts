import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  address,
  compileTransaction,
  createKeyPairFromBytes,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  deriveAddress,
  encryptSecretKey,
  normalizeSecretKey,
  writeKeystoreFileAtomic,
} from "../../src/wallet/keystore.js";
import { EncryptedKeystoreSigner } from "../../src/wallet/signer.js";

describe("wallet-bound transaction signer", () => {
  it("signs with the selected wallet and refuses a mismatched keystore before prompting", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-signer-"),
    );
    const wallets = path.join(directory, "wallets");
    await mkdir(wallets, { mode: 0o700 });
    const a = await createWallet(wallets, 20, "wallet-a-pass");
    const b = await createWallet(wallets, 80, "wallet-b-pass");
    const selected = {
      identity: {
        id: "d8ed414d-2175-4ab6-a0c9-4388514f5952",
        alias: "savings",
        address: address(b.address),
      },
      keystorePath: b.path,
    };
    let prompted = 0;
    try {
      let message = createTransactionMessage({ version: 0 });
      message = setTransactionMessageFeePayer(
        selected.identity.address,
        message,
      );
      message = setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: "11111111111111111111111111111111" as never,
          lastValidBlockHeight: 1n,
        },
        message,
      );
      const unsigned = compileTransaction(message);
      const signatures = await new EncryptedKeystoreSigner(
        selected,
        async () => {
          prompted += 1;
          return "wallet-b-pass";
        },
      ).signTransactions([unsigned]);
      const signature = signatures[0]![selected.identity.address];
      const secretB = await normalizeSecretKey(
        Uint8Array.from({ length: 32 }, (_, index) => index + 80),
      );
      try {
        const pairB = await createKeyPairFromBytes(secretB, true);
        expect(
          await crypto.subtle.verify(
            "Ed25519",
            pairB.publicKey,
            signature,
            unsigned.messageBytes,
          ),
        ).toBe(true);
      } finally {
        secretB.fill(0);
      }
      expect(prompted).toBe(1);

      const mismatch = new EncryptedKeystoreSigner(
        { ...selected, keystorePath: a.path },
        async () => {
          prompted += 1;
          return "wallet-b-pass";
        },
      );
      await expect(mismatch.signTransactions([unsigned])).rejects.toThrow(
        /changed before signing/,
      );
      expect(prompted).toBe(1);
    } finally {
      a.secret.fill(0);
      b.secret.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function createWallet(
  directory: string,
  seed: number,
  passphrase: string,
) {
  const secret = await normalizeSecretKey(
    Uint8Array.from({ length: 32 }, (_, index) => index + seed),
  );
  const walletAddress = await deriveAddress(secret);
  const encrypted = await encryptSecretKey(secret, walletAddress, passphrase);
  const filePath = path.join(directory, `${seed}.json`);
  await writeKeystoreFileAtomic(filePath, encrypted);
  return { address: walletAddress, path: filePath, secret };
}
