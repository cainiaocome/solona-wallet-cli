import { formatUnits, parseDecimalUnits } from "../../solana/amounts.js";

const PERCENT_PRECISION = 10n ** 12n;
const CALCULATION_PRECISION = 10n ** 24n;
const DAYS_PER_YEAR = 365n;
const MAX_RATE_INPUT = (1n << 128n) - 1n;

export const YIELD_ASSUMPTION =
  "Estimate assumes daily compounding and unchanged rates; excludes fees.";

export type JupiterLendYield =
  | {
      status: "available";
      baseAprPercent: string;
      rewardsAprPercent: string;
      totalAprPercent: string;
      estimatedApyPercent: string;
      compounding: "daily";
      daysPerYear: 365;
      updatedAt: string;
    }
  | {
      status: "unavailable";
      reason: "missing-or-invalid-rates" | "rates-out-of-range";
      updatedAt: string;
    };

/** Read optional SDK BN values without allowing a bad rate to hide balances. */
export function optionalRate(value: unknown): bigint | null {
  try {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
    const text = String(value);
    return /^-?\d+$/.test(text) ? BigInt(text) : null;
  } catch {
    return null;
  }
}

/**
 * Normalize the pinned lend-read SDK's DIFFERENT rate units. supplyRate comes
 * from liquidity in basis points (420 = 4.2%); rewardsRate is percent * 1e12
 * (1e12 = 1%). Supply rates are derived, so may exceed 100%; use the upstream
 * rate-curve u128 range for input validation. SDK rewards are capped at 50%.
 * Preserve exact APR in JSON; express derived APY to twelve decimal places.
 * Monetary projections use the unrounded fixed-point growth factor.
 */
export function calculateLendYield(
  supplyRateRaw: unknown,
  rewardsRateRaw: unknown,
  updatedAt = new Date().toISOString(),
): JupiterLendYield {
  const supply = optionalRate(supplyRateRaw);
  const rewards = optionalRate(rewardsRateRaw);
  if (supply === null || rewards === null)
    return {
      status: "unavailable",
      reason: "missing-or-invalid-rates",
      updatedAt,
    };
  if (
    supply < 0n ||
    supply > MAX_RATE_INPUT ||
    rewards < 0n ||
    rewards > 50n * PERCENT_PRECISION
  )
    return { status: "unavailable", reason: "rates-out-of-range", updatedAt };

  const base = supply * (PERCENT_PRECISION / 100n);
  const total = base + rewards;
  const growth = dailyAnnualGrowth(total);
  return {
    status: "available",
    baseAprPercent: formatUnits(base, 12),
    rewardsAprPercent: formatUnits(rewards, 12),
    totalAprPercent: formatUnits(total, 12),
    estimatedApyPercent: formatUnits(
      (growth * 100n * PERCENT_PRECISION + CALCULATION_PRECISION / 2n) /
        CALCULATION_PRECISION,
      12,
    ),
    compounding: "daily",
    daysPerYear: 365,
    updatedAt,
  };
}

/** Round percentages for people without presenting a small positive rate as 0. */
export function displayYieldPercent(percent: string): string {
  const raw = parseDecimalUnits(percent, 12, "yield percentage");
  const rounded = (raw + 50_000_000n) / 100_000_000n;
  if (raw > 0n && rounded === 0n) return "<0.0001%";
  return `${formatUnits(rounded, 4)}%`;
}

export type AnnualYieldEstimate =
  | {
      status: "available";
      amountUsdc: string;
      amountRaw: bigint;
      belowOneBaseUnit: boolean;
      excludesFees: true;
    }
  | { status: "unavailable" };

/** Project only the proposed deposit, not a user's historical earned interest. */
export function estimateAnnualYield(
  depositRaw: bigint,
  yieldInfo: JupiterLendYield,
): AnnualYieldEstimate {
  if (yieldInfo.status !== "available") return { status: "unavailable" };
  const total = parseDecimalUnits(yieldInfo.totalAprPercent, 12, "total APR");
  const growth = dailyAnnualGrowth(total);
  const amountRaw = (depositRaw * growth) / CALCULATION_PRECISION;
  return {
    status: "available",
    amountRaw,
    amountUsdc: formatUnits(amountRaw, 6),
    belowOneBaseUnit: depositRaw > 0n && growth > 0n && amountRaw === 0n,
    excludesFees: true,
  };
}

/** Fixed-point (1 + APR / 365)^365 - 1; no floating-point money conversion. */
function dailyAnnualGrowth(totalPercentRaw: bigint): bigint {
  const apr =
    totalPercentRaw * (CALCULATION_PRECISION / (100n * PERCENT_PRECISION));
  let factor = CALCULATION_PRECISION + apr / DAYS_PER_YEAR;
  let periods = DAYS_PER_YEAR;
  let result = CALCULATION_PRECISION;
  while (periods > 0n) {
    if (periods % 2n) result = (result * factor) / CALCULATION_PRECISION;
    periods /= 2n;
    if (periods) factor = (factor * factor) / CALCULATION_PRECISION;
  }
  return result - CALCULATION_PRECISION;
}
