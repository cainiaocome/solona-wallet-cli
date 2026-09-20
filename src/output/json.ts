import { jsonSafe } from "../solana/amounts.js";

/**
 * JSON serializer for chain values. JavaScript `bigint` is not JSON-native, so
 * integer monetary values become decimal strings instead of losing precision.
 */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(jsonSafe(value), null, 2);
}
