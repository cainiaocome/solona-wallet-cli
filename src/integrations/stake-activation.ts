import { getStakeActivation as calculateStakeActivation } from "@anza-xyz/solana-rpc-get-stake-activation";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AppConfig } from "../config/config.js";
import type { Address } from "@solana/kit";

/**
 * Calculate stake activation locally from the stake account, current epoch, and
 * StakeHistory sysvar. Agave removed its old `getStakeActivation` RPC method;
 * Anza's maintained client-side implementation reproduces that calculation
 * using standard account and epoch RPC methods supported by current providers.
 *
 * The result is safety-critical: callers must allow calculation errors to
 * propagate rather than guessing that a stake account is inactive/withdrawable.
 */
export async function getStakeActivation(
  config: AppConfig,
  account: Address,
): Promise<{
  state: "active" | "deactivating" | "inactive" | "activating";
}> {
  const connection = new Connection(config.rpcUrl, config.commitment);
  const result = await calculateStakeActivation(
    connection,
    new PublicKey(account),
  );
  const validStates = ["active", "deactivating", "inactive", "activating"];
  if (!validStates.includes(result.status))
    throw new Error(`Unexpected stake activation state: ${result.status}`);
  return {
    state: result.status as
      | "active"
      | "deactivating"
      | "inactive"
      | "activating",
  };
}
