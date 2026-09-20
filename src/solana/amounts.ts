import { InvalidAmountError } from "../errors/errors.js";

/**
 * Amounts in this module are integer base units, never floating-point values.
 *
 * Solana stores SOL as lamports and tokens as mint-specific base units. Parsing
 * the user's decimal string once at the boundary prevents rounding errors from
 * leaking into transaction instructions or balance comparisons.
 */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function parseDecimalUnits(
  input: string,
  decimals: number,
  label = "amount",
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new InvalidAmountError(`Invalid decimal precision for ${label}.`);
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input)) {
    throw new InvalidAmountError(
      `${label} must be a non-negative decimal string without exponent notation.`,
    );
  }
  const [wholeValue, fraction = ""] = input.split(".");
  const whole = wholeValue ?? "0";
  if (fraction.length > decimals) {
    throw new InvalidAmountError(
      `${label} has more than ${decimals} decimal places.`,
    );
  }
  const paddedFraction = fraction.padEnd(decimals, "0");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0")
  );
}

export function parseSol(input: string): bigint {
  const value = parseDecimalUnits(input, 9, "SOL amount");
  if (value <= 0n)
    throw new InvalidAmountError("SOL amount must be greater than zero.");
  return value;
}

export function formatUnits(
  value: bigint,
  decimals: number,
  trim = true,
): string {
  if (value < 0n) throw new InvalidAmountError("Amount cannot be negative.");
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0");
  if (!decimals) return whole.toString();
  const displayedFraction = trim ? fraction.replace(/0+$/, "") : fraction;
  return displayedFraction ? `${whole}.${displayedFraction}` : whole.toString();
}

export function formatSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]),
    );
  }
  return value;
}
