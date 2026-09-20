import { jsonSafe } from "../solana/amounts.js";

export function stringifyJson(value: unknown): string {
  return JSON.stringify(jsonSafe(value), null, 2);
}
