import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("startup help", () => {
  it("shows startup options without requiring configuration or a wallet", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: sol-wallet [options]");
    expect(result.stdout).toContain("--wallet <alias>");
    expect(result.stdout).toContain("--json");
  });
});
