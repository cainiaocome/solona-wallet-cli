import { describe, expect, it, vi } from "vitest";
import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { normalizeSecretKey } from "../../src/wallet/keystore.js";
import { ConfirmationError } from "../../src/errors/errors.js";
import {
  broadcastSignedTransaction,
  confirmSignature,
} from "../../src/commands/send.js";

describe("transaction submission safety", () => {
  it("allows longer finalized confirmation and defers history lookups", async () => {
    vi.useFakeTimers();
    try {
      let lookups = 0;
      const options: unknown[] = [];
      const rpc = {
        getSignatureStatuses: (_signatures: unknown, config?: unknown) => {
          lookups += 1;
          options.push(config);
          return { send: async () => ({ value: [null] }) };
        },
      } as never;

      const result = confirmSignature(
        rpc,
        "offline-test-signature",
        "finalized",
      ).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(lookups).toBeGreaterThan(60);
      await vi.advanceTimersByTimeAsync(30_000);

      const outcome = await result;
      expect(outcome.ok).toBe(false);
      expect(lookups).toBe(120);
      expect(options.filter(Boolean)).toEqual([
        { searchTransactionHistory: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains the local transaction signature when the RPC accepts then drops its response", async () => {
    const secret = await normalizeSecretKey(
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const signer = await createKeyPairSignerFromBytes(secret);
    let message = createTransactionMessage({ version: 0 });
    message = setTransactionMessageFeePayer(signer.address, message);
    message = setTransactionMessageLifetimeUsingBlockhash(
      {
        blockhash: "11111111111111111111111111111111" as never,
        lastValidBlockHeight: 100n,
      },
      message,
    );
    message = appendTransactionMessageInstruction(
      getTransferSolInstruction({
        source: signer,
        destination: address("11111111111111111111111111111113"),
        amount: 1n,
      }),
      message,
    );
    const signed = await signTransactionMessageWithSigners(message);
    let attempts = 0;
    const rpc = {
      sendTransaction: () => ({
        send: async () => {
          attempts += 1;
          // Simulates a node accepting/forwarding the bytes while the HTTP
          // response is lost in transit.
          throw new Error("connection closed after request body was sent");
        },
      }),
    } as never;

    let failure: unknown;
    try {
      await broadcastSignedTransaction(rpc, signed, "confirmed");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfirmationError);
    expect((failure as ConfirmationError).details).toMatchObject({
      broadcastOutcomeUnknown: true,
    });
    expect((failure as Error).message).toMatch(/[1-9A-HJ-NP-Za-km-z]{80,90}/);
    expect(attempts).toBe(1);
  });

  it("keeps waiting when a confirmed transaction is past blockhash expiry but not finalized", async () => {
    let lookups = 0;
    const rpc = {
      getSignatureStatuses: () => ({
        send: async () => ({
          value: [
            {
              err: null,
              slot: 42n,
              confirmationStatus: ++lookups === 1 ? "confirmed" : "finalized",
            },
          ],
        }),
      }),
      getBlockHeight: () => ({ send: async () => 101n }),
    } as never;

    const status = await confirmSignature(
      rpc,
      "offline-test-signature",
      "finalized",
      100n,
    );
    expect(status).toEqual({ slot: 42n, confirmationStatus: "finalized" });
    expect(lookups).toBe(2);
  });

  it("rechecks status at the expiry boundary before reporting a missing transaction", async () => {
    let lookups = 0;
    const rpc = {
      getSignatureStatuses: () => ({
        send: async () => ({
          value: [
            ++lookups === 1
              ? null
              : {
                  err: null,
                  slot: 43n,
                  confirmationStatus: "confirmed",
                },
          ],
        }),
      }),
      getBlockHeight: () => ({ send: async () => 101n }),
    } as never;

    const status = await confirmSignature(
      rpc,
      "offline-test-signature",
      "confirmed",
      100n,
    );
    expect(status).toEqual({ slot: 43n, confirmationStatus: "confirmed" });
    expect(lookups).toBe(2);
  });
});
