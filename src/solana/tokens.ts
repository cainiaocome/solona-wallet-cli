import { address, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS as GENERATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS as GENERATED_TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { RpcError } from "../errors/errors.js";
import { formatUnits } from "./amounts.js";
import { rpcRequest, type SolanaRpc } from "./rpc.js";

/**
 * Token read helpers understand both Solana token programs.
 *
 * A mint address alone is not enough to interpret a token balance: the mint's
 * decimals and owning token program are also required. The parser converts
 * RPC's JSON-shaped data into checked values used by commands and output.
 */
export const TOKEN_PROGRAM_ADDRESS = GENERATED_TOKEN_PROGRAM_ADDRESS;
export const TOKEN_2022_PROGRAM_ADDRESS = GENERATED_TOKEN_2022_PROGRAM_ADDRESS;

export interface TokenAccount {
  address: string;
  mint: string;
  owner: string;
  program: "spl-token" | "token-2022";
  decimals: number;
  rawAmount: bigint;
  uiAmount: string;
}

function tokenProgramName(program: Address): TokenAccount["program"] {
  return program === TOKEN_2022_PROGRAM_ADDRESS ? "token-2022" : "spl-token";
}

function parseAccount(account: unknown, program: Address): TokenAccount {
  if (!account || typeof account !== "object")
    throw new RpcError("RPC returned a malformed token account.");
  const record = account as {
    pubkey?: unknown;
    account?: { data?: { parsed?: { info?: unknown } } };
  };
  const info = record.account?.data?.parsed?.info;
  if (!info || typeof info !== "object")
    throw new RpcError("RPC returned an unparsed token account.");
  const parsed = info as {
    mint?: unknown;
    owner?: unknown;
    tokenAmount?: {
      amount?: unknown;
      decimals?: unknown;
      uiAmountString?: unknown;
    };
  };
  if (
    typeof record.pubkey !== "string" ||
    typeof parsed.mint !== "string" ||
    typeof parsed.owner !== "string" ||
    !parsed.tokenAmount
  ) {
    throw new RpcError("RPC returned an incomplete token account.");
  }
  const amount = parsed.tokenAmount.amount;
  const decimals = parsed.tokenAmount.decimals;
  if (
    typeof amount !== "string" ||
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new RpcError("RPC returned an invalid token amount.");
  let rawAmount: bigint;
  try {
    rawAmount = BigInt(amount);
  } catch {
    throw new RpcError("RPC returned a non-integer token amount.");
  }
  return {
    address: record.pubkey,
    mint: parsed.mint,
    owner: parsed.owner,
    program: tokenProgramName(program),
    decimals,
    rawAmount,
    uiAmount:
      typeof parsed.tokenAmount.uiAmountString === "string"
        ? parsed.tokenAmount.uiAmountString
        : formatUnits(rawAmount, decimals),
  };
}

export async function getTokenAccounts(
  rpc: SolanaRpc,
  owner: Address,
  commitment: AppConfigCommitment,
): Promise<TokenAccount[]> {
  const accounts: TokenAccount[] = [];
  for (const program of [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]) {
    const response = await rpcRequest(
      rpc.getTokenAccountsByOwner(
        owner,
        { programId: program },
        { encoding: "jsonParsed", commitment },
      ),
      `token account lookup for ${owner}`,
    );
    for (const account of response.value)
      accounts.push(parseAccount(account, program));
  }
  return accounts;
}

export type AppConfigCommitment = "processed" | "confirmed" | "finalized";
