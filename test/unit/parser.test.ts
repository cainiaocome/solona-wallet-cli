import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeLine } from "../../src/shell/completion.js";
import {
  appendHistory,
  isSafeHistoryLine,
  readHistory,
} from "../../src/shell/history.js";
import { parseCommand, tokenize } from "../../src/shell/parser.js";
import { helpText } from "../../src/shell/help.js";

describe("wallet shell parser and completion", () => {
  it("supports quotes, escaped whitespace, and flag=value", () => {
    expect(tokenize('send "destination value" 1.25')).toEqual([
      "send",
      "destination value",
      "1.25",
    ]);
    const command = parseCommand("validators --limit=10 --current-only");
    expect(command.args).toEqual([]);
    expect(command.flags.get("limit")).toBe("10");
    expect(command.flags.get("current-only")).toBe(true);
  });

  it("completes nested commands and cached public values", () => {
    const topLevel = completeLine("tok", {
      tokenMints: [],
      stakeAccounts: [],
      recentValidators: [],
      walletAliases: [],
    });
    expect(topLevel[0]).toContain("token");
    expect(topLevel[1]).toBe("tok");
    expect(
      completeLine("token ", {
        tokenMints: [],
        stakeAccounts: [],
        recentValidators: [],
        walletAliases: [],
      })[0],
    ).toEqual(["list", "balance", "send"]);
    expect(
      completeLine("token balance ", {
        tokenMints: ["Mint111"],
        stakeAccounts: [],
        recentValidators: [],
        walletAliases: [],
      })[0],
    ).toEqual(["Mint111"]);
    expect(
      completeLine("stake ", {
        tokenMints: [],
        stakeAccounts: [],
        recentValidators: [],
        walletAliases: [],
      })[0],
    ).toEqual(["create", "list", "deactivate", "withdraw"]);
    expect(
      completeLine("jupiter-lend ", {
        tokenMints: [],
        stakeAccounts: [],
        recentValidators: [],
        walletAliases: [],
      })[0],
    ).toEqual(["status", "deposit", "withdraw"]);
  });

  it("completes supported validators and token-list flags", () => {
    const cache = {
      tokenMints: [],
      stakeAccounts: [],
      recentValidators: [],
      walletAliases: [],
    };
    expect(completeLine("validators --inc", cache)[0]).toContain(
      "--include-delinquent",
    );
    expect(completeLine("token list --acc", cache)[0]).toEqual(["--accounts"]);
  });

  it("keeps general and topic help aligned with the wallet and status commands", () => {
    expect(helpText()).toContain("wallet recover <uuid> <alias>");
    expect(helpText("wallet")).toContain("wallet migrate <alias>");
    expect(helpText("status")).toContain("non-zero token balances");
    expect(helpText("token")).toContain("--accounts");
  });

  it("filters secret-looking lines from history", () => {
    expect(isSafeHistoryLine("balance")).toBe(true);
    expect(isSafeHistoryLine("wallet import --password nope")).toBe(false);
    expect(isSafeHistoryLine("")).toBe(false);
  });

  it("caps persisted history at the newest 1,000 safe entries", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "sol-wallet-history-"),
    );
    try {
      for (let index = 0; index < 1_005; index += 1)
        await appendHistory(directory, `command-${index}`);
      const entries = await readHistory(directory);
      expect(entries).toHaveLength(1_000);
      expect(entries[0]).toBe("command-5");
      expect(entries.at(-1)).toBe("command-1004");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
