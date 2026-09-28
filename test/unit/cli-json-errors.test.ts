import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringifyJson } from "../../src/output/json.js";
import { parseTransactionSignature } from "../../src/commands/execute.js";
import bs58 from "bs58";

describe("line-oriented JSON and command errors", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("serializes one JSON value on a single line", () => {
    expect(stringifyJson({ ok: true, nested: { value: 1n } })).toBe(
      '{"ok":true,"nested":{"value":"1"}}',
    );
  });

  it.each([
    ["one-shot", ["-c", "wallet info missing --json"], undefined],
    ["piped", [], "wallet info missing --json\nexit\n"],
  ])(
    "reports %s command errors as JSON on stderr",
    async (_mode, args, input) => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "sol-wallet-json-error-"),
      );
      try {
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", "src/cli.ts", ...args],
          {
            cwd: process.cwd(),
            encoding: "utf8",
            input,
            env: { ...process.env, SOL_WALLET_CONFIG_DIR: directory },
            timeout: 15_000,
          },
        );
        expect(result.error).toBeUndefined();
        if (args.length) expect(result.status).toBe(2);
        else expect(result.status).toBe(0);
        const lines = result.stderr
          .trim()
          .split("\n")
          .filter((line) => line.startsWith("{"));
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!).error).toBe("WalletNotFound");
        expect(result.stderr).not.toContain("Error: ");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("transaction signature validation", () => {
  it("accepts a 64-byte base58 signature and rejects malformed input locally", () => {
    const signature = bs58.encode(new Uint8Array(64).fill(7));
    expect(parseTransactionSignature(signature)).toBe(signature);
    expect(() => parseTransactionSignature("not-a-signature")).toThrow(
      "Invalid Solana transaction signature",
    );
  });
});
