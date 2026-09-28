import { describe, expect, it } from "vitest";
import { displayWidth, keyValueRows, table } from "../../src/output/human.js";
import {
  color,
  readlineColor,
  terminalColorEnabled,
} from "../../src/output/terminal.js";
import { helpText, styleHelpText } from "../../src/shell/help.js";
import { formatShellPrompt } from "../../src/shell/repl.js";

describe("human terminal presentation", () => {
  it("enables color only for a capable TTY and honors NO_COLOR", () => {
    expect(terminalColorEnabled("stdout", {}, true)).toBe(true);
    expect(terminalColorEnabled("stdout", {}, false)).toBe(false);
    expect(terminalColorEnabled("stdout", { NO_COLOR: "1" }, true)).toBe(false);
    expect(terminalColorEnabled("stderr", { TERM: "dumb" }, true)).toBe(false);
    expect(color("MAINNET", "warning", { enabled: false })).toBe("MAINNET");
    expect(color("MAINNET", "warning", { enabled: true })).toBe(
      "\u001b[1;33mMAINNET\u001b[0m",
    );
  });

  it("marks prompt escapes as nonprinting for readline", () => {
    expect(readlineColor("devnet", "info", false)).toBe("devnet");
    expect(readlineColor("devnet", "info", true)).toBe(
      "\u0001\u001b[36mdevnet\u001b[0m\u0002",
    );
    expect(
      formatShellPrompt(
        "mainnet",
        "savings",
        "FEQGyZ7V1pQHj9nR37cgi9CRdGNhwku6JiSCMNCwjRBK",
      ),
    ).toBe("sol-wallet [mainnet | savings | FEQG…jRBK]> ");
  });

  it("uses aligned columns when they fit and labeled rows when they do not", () => {
    const fullAddress = "11111111111111111111111111111112";
    const headers = ["STATUS", "COMMISSION", "VOTE ACCOUNT"];
    const rows = [["current", "100%", fullAddress]];
    const wide = table(rows, headers, { width: 100 });
    expect(wide).toContain("STATUS   COMMISSION  VOTE ACCOUNT");
    expect(wide).toContain(fullAddress);

    const narrow = table(rows, headers, { width: 32 });
    expect(narrow).toContain(`VOTE ACCOUNT: ${fullAddress}`);
    expect(narrow).toContain("COMMISSION: 100%");
  });

  it("measures ANSI and common wide glyphs as terminal cells", () => {
    expect(displayWidth("\u001b[1;31mMAINNET\u001b[0m")).toBe(7);
    expect(displayWidth("USDC · 現在")).toBe(11);
    expect(
      keyValueRows([["SOL", "1.25 SOL", "emphasis"]], { enabled: true }),
    ).toContain("\u001b[1m1.25 SOL\u001b[0m");
  });

  it("keeps general help concise and topic help detailed", () => {
    const help = helpText();
    expect(help).toContain("wallet recover <uuid> <alias>");
    expect(helpText("status")).toContain("non-zero token balances");
    expect(
      Math.max(...help.split("\n").map((line) => line.length)),
    ).toBeLessThanOrEqual(100);
    expect(styleHelpText(help)).not.toContain("\u001b[");
  });
});
