import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as prompt from "../../src/shell/prompt.js";
import { createCommandContext } from "../../src/commands/context.js";
import { importWallet } from "../../src/commands/wallet-import.js";
import {
  deriveAddress,
  normalizeSecretKey,
} from "../../src/wallet/keystore.js";

describe("wallet import output", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the derived address on stderr and emits one JSON document", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-import-json-"),
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const secret = await normalizeSecretKey(
        Uint8Array.from({ length: 32 }, (_, index) => index + 51),
      );
      const address = await deriveAddress(secret);
      const keypairPath = path.join(configDir, "keypair.json");
      try {
        await writeFile(keypairPath, JSON.stringify([...secret]), {
          mode: 0o600,
        });
      } finally {
        secret.fill(0);
      }
      const expectedNotice = `Derived address for 'daily': ${address}`;
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderr.push(String(chunk));
        return true;
      });
      vi.spyOn(prompt, "confirm").mockImplementation(async () => {
        expect(stderr.join("")).toContain(expectedNotice);
        return true;
      });
      vi.spyOn(prompt, "readSecret").mockResolvedValue("test-passphrase");

      const context = createCommandContext(
        {
          configDir,
          cluster: "mainnet",
          rpcUrl: "https://api.mainnet.solana.com",
          commitment: "confirmed",
        },
        { json: true, verbose: false },
      );
      await importWallet(context, "daily", keypairPath);

      const documents = stdout.join("").trim().split("\n");
      expect(documents).toHaveLength(1);
      expect(JSON.parse(documents[0]!)).toMatchObject({
        ok: true,
        action: "import",
        imported: true,
        wallet: { alias: "daily", address },
      });
      expect(stderr.join("")).toContain(expectedNotice);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
