import { z } from "zod";

export const clusterSchema = z.enum(["mainnet", "devnet"]);
export const commitmentSchema = z.enum(["processed", "confirmed", "finalized"]);

export const fileConfigSchema = z.object({
  version: z.literal(1).default(1),
  cluster: clusterSchema.optional(),
  rpcUrl: z.string().url().optional(),
  commitment: commitmentSchema.optional(),
});

export type Cluster = z.infer<typeof clusterSchema>;
export type Commitment = z.infer<typeof commitmentSchema>;
export type FileConfig = z.infer<typeof fileConfigSchema>;

export const DEFAULT_CLUSTER: Cluster = "mainnet";
export const DEFAULT_COMMITMENT: Commitment = "confirmed";

export function defaultRpcUrl(cluster: Cluster): string {
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet.solana.com";
}
