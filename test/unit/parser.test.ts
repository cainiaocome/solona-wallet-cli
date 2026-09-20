import { describe, expect, it } from "vitest";
import { completeLine } from "../../src/shell/completion.js";
import { isSafeHistoryLine } from "../../src/shell/history.js";
import { parseCommand, tokenize } from "../../src/shell/parser.js";

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
    });
    expect(topLevel[0]).toContain("token");
    expect(topLevel[1]).toBe("tok");
    expect(
      completeLine("token ", {
        tokenMints: [],
        stakeAccounts: [],
        recentValidators: [],
      })[0],
    ).toEqual(["list", "balance", "send"]);
    expect(
      completeLine("token balance ", {
        tokenMints: ["Mint111"],
        stakeAccounts: [],
        recentValidators: [],
      })[0],
    ).toEqual(["Mint111"]);
    expect(
      completeLine("stake ", {
        tokenMints: [],
        stakeAccounts: [],
        recentValidators: [],
      })[0],
    ).toEqual(["create", "list", "deactivate", "withdraw"]);
  });

  it("filters secret-looking lines from history", () => {
    expect(isSafeHistoryLine("balance")).toBe(true);
    expect(isSafeHistoryLine("wallet import --password nope")).toBe(false);
    expect(isSafeHistoryLine("")).toBe(false);
  });
});
