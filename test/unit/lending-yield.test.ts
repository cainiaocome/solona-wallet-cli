import { describe, expect, it } from "vitest";
import {
  calculateLendYield,
  displayYieldPercent,
  estimateAnnualYield,
  optionalRate,
  YIELD_ASSUMPTION,
  type JupiterLendYield,
} from "../../src/integrations/jupiter-lend/yield.js";
import { lendYieldRows } from "../../src/output/lending.js";

const RATES_UPDATED_AT = "2026-09-30T12:34:56.000Z";
const REWARDS_PERCENT_PRECISION = 1_000_000_000_000n;

function availableYield(
  supplyRateRaw: unknown,
  rewardsRateRaw: unknown,
): Extract<JupiterLendYield, { status: "available" }> {
  const result = calculateLendYield(
    supplyRateRaw,
    rewardsRateRaw,
    RATES_UPDATED_AT,
  );
  if (result.status !== "available") {
    throw new Error(`Expected available rates, got ${result.status}`);
  }
  return result;
}

describe("Jupiter Lend yield calculations", () => {
  it("normalizes supply basis points and scaled rewards into separate percentages", () => {
    const result = availableYield(420n, REWARDS_PERCENT_PRECISION);

    expect(result).toMatchObject({
      baseAprPercent: "4.2",
      rewardsAprPercent: "1",
      totalAprPercent: "5.2",
      compounding: "daily",
      daysPerYear: 365,
      updatedAt: RATES_UPDATED_AT,
    });
  });

  it("matches an independent daily-compounding APY and projects a 1,000 USDC deposit", () => {
    const result = availableYield(420n, REWARDS_PERCENT_PRECISION);
    const apyPercent = Math.expm1(365 * Math.log1p(0.052 / 365)) * 100;

    expect(
      Math.abs(Number(result.estimatedApyPercent) - apyPercent),
    ).toBeLessThan(1e-7);
    expect(result.estimatedApyPercent).toBe("5.337184107195");
    const estimate = estimateAnnualYield(1_000_000_000n, result);
    const independentlyProjectedRaw = Math.floor(
      (1_000 * apyPercent * 1_000_000) / 100,
    );

    expect(estimate).toMatchObject({
      status: "available",
      amountUsdc: "53.371841",
      belowOneBaseUnit: false,
      excludesFees: true,
    });
    expect(estimate.status).toBe("available");
    if (estimate.status === "available") {
      expect(estimate.amountRaw).toBe(BigInt(independentlyProjectedRaw));
    }
  });

  it("keeps valid zero rates available as a real zero return", () => {
    const result = availableYield(0n, 0n);
    const estimate = estimateAnnualYield(1_000_000_000n, result);

    expect(result).toMatchObject({
      baseAprPercent: "0",
      rewardsAprPercent: "0",
      totalAprPercent: "0",
      estimatedApyPercent: "0",
    });
    expect(estimate).toMatchObject({
      status: "available",
      amountRaw: 0n,
      amountUsdc: "0",
      belowOneBaseUnit: false,
    });
  });

  it.each([
    ["missing supply rate", undefined, REWARDS_PERCENT_PRECISION],
    ["null rewards rate", 420n, null],
    ["malformed integer", "420.5", REWARDS_PERCENT_PRECISION],
    ["unsafe numeric integer", Number.MAX_SAFE_INTEGER + 1, 0n],
    ["negative supply rate", -1n, 0n],
    ["negative rewards rate", 0n, -1n],
    ["supply above the u128 bound", 1n << 128n, 0n],
    [
      "rewards above the 50 percent bound",
      0n,
      50n * REWARDS_PERCENT_PRECISION + 1n,
    ],
  ])("marks %s unavailable", (_label, supply, rewards) => {
    expect(calculateLendYield(supply, rewards, RATES_UPDATED_AT)).toMatchObject(
      {
        status: "unavailable",
        updatedAt: RATES_UPDATED_AT,
      },
    );
  });

  it("accepts supply rates above 100 percent and beyond u16", () => {
    const highBaseApr = availableYield(10_001n, 0n);
    const ratesBeyondU16 = availableYield(
      65_536n,
      50n * REWARDS_PERCENT_PRECISION,
    );

    expect(highBaseApr).toMatchObject({
      status: "available",
      baseAprPercent: "100.01",
      totalAprPercent: "100.01",
    });
    expect(ratesBeyondU16).toMatchObject({
      baseAprPercent: "655.36",
      rewardsAprPercent: "50",
      totalAprPercent: "705.36",
    });
  });

  it("returns unavailable for malformed optional SDK values without throwing", () => {
    const malformed = {
      toString() {
        throw new Error("malformed SDK value");
      },
    };

    expect(() => optionalRate(malformed)).not.toThrow();
    expect(optionalRate(malformed)).toBeNull();
    expect(calculateLendYield(malformed, 0n, RATES_UPDATED_AT)).toMatchObject({
      status: "unavailable",
      reason: "missing-or-invalid-rates",
    });
  });

  it("serializes normalized rates as strings with the daily APY assumptions", () => {
    const result = availableYield(420n, REWARDS_PERCENT_PRECISION);
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json) as Record<string, unknown>;

    expect(parsed).toEqual(result);
    expect(parsed).toMatchObject({
      baseAprPercent: "4.2",
      rewardsAprPercent: "1",
      totalAprPercent: "5.2",
      compounding: "daily",
      daysPerYear: 365,
      updatedAt: RATES_UPDATED_AT,
    });
    for (const field of [
      "baseAprPercent",
      "rewardsAprPercent",
      "totalAprPercent",
      "estimatedApyPercent",
    ]) {
      expect(typeof parsed[field]).toBe("string");
    }
    expect(YIELD_ASSUMPTION).toMatch(/daily compounding/);
    expect(YIELD_ASSUMPTION).toMatch(/unchanged rates/);
    expect(YIELD_ASSUMPTION).toMatch(/excludes fees/);
  });

  it("projects huge deposits with BigInt precision against an exact rational rate", () => {
    const result = availableYield(420n, REWARDS_PERCENT_PRECISION);
    const depositRaw = 10n ** 24n + 123_456n;
    const estimate = estimateAnnualYield(depositRaw, result);
    if (estimate.status !== "available") {
      throw new Error("Expected a yield estimate for available rates");
    }

    // 5.2% APR / 365 is exactly 13 / 91,250 per day.
    const dailyDenominator = 91_250n;
    const exactAnnualDenominator = dailyDenominator ** 365n;
    const exactAnnualGrowthNumerator = 91_263n ** 365n - exactAnnualDenominator;
    const exactProjectedNumerator = depositRaw * exactAnnualGrowthNumerator;
    const actualProjectedNumerator =
      estimate.amountRaw * exactAnnualDenominator;
    const projectionErrorNumerator =
      exactProjectedNumerator - actualProjectedNumerator;

    expect(depositRaw).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(typeof estimate.amountRaw).toBe("bigint");
    expect(estimate.amountRaw).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(projectionErrorNumerator).toBeGreaterThanOrEqual(0n);
    expect(projectionErrorNumerator * 10n ** 18n).toBeLessThan(
      exactProjectedNumerator,
    );
  });

  it("renders tiny positive rates as nonzero and marks sub-unit projections", () => {
    const result = availableYield(0n, 1n);
    const estimate = estimateAnnualYield(1_000_000n, result);

    expect(displayYieldPercent(result.rewardsAprPercent)).toBe("<0.0001%");
    expect(result.estimatedApyPercent).toBe("0.000000000001");
    expect(lendYieldRows(result)).toContainEqual([
      "Estimated APY",
      "<0.0001%",
      "emphasis",
    ]);
    expect(estimate).toMatchObject({
      status: "available",
      amountRaw: 0n,
      amountUsdc: "0",
      belowOneBaseUnit: true,
    });
  });
});

describe("Jupiter Lend yield output rows", () => {
  it("preserves zero and unavailable states in detailed and brief rows", () => {
    const zero = availableYield(0n, 0n);
    const unavailable = calculateLendYield(undefined, 0n, RATES_UPDATED_AT);

    expect(lendYieldRows(zero)).toEqual([
      ["Base APR", "0%"],
      ["Rewards APR", "0%"],
      ["Total APR", "0%", "emphasis"],
      ["Estimated APY", "0%", "emphasis"],
      ["Rates updated", RATES_UPDATED_AT],
    ]);
    expect(lendYieldRows(zero, false)).toEqual([
      ["Total APR", "0%", "emphasis"],
    ]);
    expect(lendYieldRows(unavailable)).toEqual([
      ["Yield", "Unavailable — missing or invalid rate data", "warning"],
    ]);
    expect(lendYieldRows(unavailable, false)).toEqual([
      ["Yield", "Unavailable — missing or invalid rate data", "warning"],
    ]);
  });
});
