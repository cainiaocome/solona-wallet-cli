import { createSolanaRpc } from "@solana/kit";
import type { AppConfig } from "../config/config.js";
import { RpcError } from "../errors/errors.js";

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
