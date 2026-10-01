import {
  displayYieldPercent,
  type JupiterLendYield,
} from "../integrations/jupiter-lend/yield.js";
import type { Tone } from "./terminal.js";

/** Share percentage labels across portfolio status and transaction previews. */
export function lendYieldRows(
  yieldInfo: JupiterLendYield,
  detailed = true,
): ReadonlyArray<readonly [string, string, Tone?]> {
  if (yieldInfo.status !== "available")
    return [["Yield", "Unavailable — missing or invalid rate data", "warning"]];
  if (!detailed)
    return [
      ["Total APR", displayYieldPercent(yieldInfo.totalAprPercent), "emphasis"],
    ];
  return [
    ["Base APR", displayYieldPercent(yieldInfo.baseAprPercent)],
    ["Rewards APR", displayYieldPercent(yieldInfo.rewardsAprPercent)],
    ["Total APR", displayYieldPercent(yieldInfo.totalAprPercent), "emphasis"],
    [
      "Estimated APY",
      displayYieldPercent(yieldInfo.estimatedApyPercent),
      "emphasis",
    ],
    ["Rates updated", yieldInfo.updatedAt],
  ];
}
