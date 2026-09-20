import { createSolanaRpc } from "@solana/kit";
import type { AppConfig } from "../config/config.js";
import { RpcError } from "../errors/errors.js";

/**
 * Small RPC boundary shared by command handlers.
 *
 * The Kit client returns lazy request objects whose `.send()` performs the
 * network call. Converting failures here gives every handler the same typed
 * `RpcError` and prevents raw provider errors from leaking into user output.
 */
export type SolanaRpc = ReturnType<typeof createSolanaRpc>;

export function createRpc(config: AppConfig): SolanaRpc {
  return createSolanaRpc(
    config.rpcUrl as Parameters<typeof createSolanaRpc>[0],
  );
}

export async function rpcRequest<T>(
  request: { send: () => Promise<T> },
  description: string,
): Promise<T> {
  try {
    return await request.send();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown RPC failure";
    throw new RpcError(`${description} failed: ${message}`);
  }
}
