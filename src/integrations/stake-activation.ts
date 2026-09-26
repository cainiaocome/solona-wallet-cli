import { Connection, PublicKey } from "@solana/web3.js";
import type { AppConfig } from "../config/config.js";
import type { Address } from "@solana/kit";

/**
 * Ask the validator RPC for stake activation state instead of inferring it from
 * deactivationEpoch. Stake cooldown may take several epochs under load.
 *
 * The Solana RPC method is deprecated upstream, so errors are allowed to
 * propagate: callers must not guess that funds are inactive when the endpoint
 * cannot provide authoritative activation data.
 */
export async function getStakeActivation(
  config: AppConfig,
  account: Address,
): Promise<{
  state: "active" | "deactivating" | "inactive" | "activating";
}> {
  const connection = new Connection(config.rpcUrl, config.commitment);
  const result = await connection.getStakeActivation(new PublicKey(account));
  return { state: result.state };
}
