import { describe, expect, it } from "vitest";
import {
  formatSol,
  formatUnits,
  parseDecimalUnits,
  parseSol,
} from "../../src/solana/amounts.js";

describe("exact amount handling", () => {
  it("parses SOL without floating point", () => {
    expect(parseSol("1.25")).toBe(1_250_000_000n);
    expect(formatSol(12_345_678_901n)).toBe("12.345678901");
  });

  it("parses token decimals exactly", () => {
    expect(parseDecimalUnits("12.345678", 6, "USDC")).toBe(12_345_678n);
    expect(formatUnits(12_345_678n, 6)).toBe("12.345678");
    expect(() => parseDecimalUnits("12.3456789", 6, "USDC")).toThrow(
      /decimal places/,
    );
  });

  it.each(["-1", "1e3", "01", "1."])(
    "rejects unsafe decimal input %s",
    (value) => {
      expect(() => parseSol(value)).toThrow();
    },
  );

  it("supports values larger than Number.MAX_SAFE_INTEGER", () => {
    expect(parseDecimalUnits("9007199254740.993", 3, "units")).toBe(
      9_007_199_254_740_993n,
    );
  });
});
