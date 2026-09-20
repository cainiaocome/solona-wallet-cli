import type { AppConfig } from "../config/config.js";
import { createRpc, type SolanaRpc } from "./rpc.js";

export interface SolanaClient {
  readonly config: AppConfig;
  readonly rpc: SolanaRpc;
}

export function createClient(config: AppConfig): SolanaClient {
  return { config, rpc: createRpc(config) };
}
