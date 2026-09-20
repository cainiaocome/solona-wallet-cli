import { address, type Address } from "@solana/kit";
import { ValidatorError } from "../errors/errors.js";
import { rpcRequest, type SolanaRpc } from "./rpc.js";

export interface ValidatorInfo {
  voteAccount: string;
  nodeIdentity: string;
  commission: number;
  activatedStake: bigint;
  lastVote: bigint;
  rootSlot: bigint;
  status: "current" | "delinquent";
}

export async function listValidators(
  rpc: SolanaRpc,
  commitment: "processed" | "confirmed" | "finalized",
  options: { currentOnly: boolean; maxCommission?: number; limit?: number },
): Promise<ValidatorInfo[]> {
  const response = await rpcRequest(
    rpc.getVoteAccounts({ commitment }),
    "validator lookup",
  );
  const rows: ValidatorInfo[] = [];
  const add = (
    status: ValidatorInfo["status"],
    validators: readonly {
      votePubkey: Address;
      nodePubkey: Address;
      commission: number;
      activatedStake: bigint;
      lastVote: bigint;
      rootSlot: bigint;
    }[],
  ) => {
    for (const validator of validators) {
      if (
        options.maxCommission !== undefined &&
        validator.commission > options.maxCommission
      )
        continue;
      rows.push({
        voteAccount: validator.votePubkey,
        nodeIdentity: validator.nodePubkey,
        commission: validator.commission,
        activatedStake: validator.activatedStake,
        lastVote: validator.lastVote,
        rootSlot: validator.rootSlot,
        status,
      });
    }
  };
  add("current", response.current);
  if (!options.currentOnly) add("delinquent", response.delinquent);
  rows.sort((a, b) =>
    a.activatedStake === b.activatedStake
      ? a.voteAccount.localeCompare(b.voteAccount)
      : a.activatedStake > b.activatedStake
        ? -1
        : 1,
  );
  return options.limit === undefined ? rows : rows.slice(0, options.limit);
}

export async function findValidator(
  rpc: SolanaRpc,
  voteAccount: Address,
  commitment: "processed" | "confirmed" | "finalized",
): Promise<ValidatorInfo> {
  const response = await rpcRequest(
    rpc.getVoteAccounts({ commitment, votePubkey: voteAccount }),
    "validator lookup",
  );
  const current = response.current[0];
  if (current)
    return {
      voteAccount: current.votePubkey,
      nodeIdentity: current.nodePubkey,
      commission: current.commission,
      activatedStake: current.activatedStake,
      lastVote: current.lastVote,
      rootSlot: current.rootSlot,
      status: "current",
    };
  const delinquent = response.delinquent[0];
  if (delinquent)
    return {
      voteAccount: delinquent.votePubkey,
      nodeIdentity: delinquent.nodePubkey,
      commission: delinquent.commission,
      activatedStake: delinquent.activatedStake,
      lastVote: delinquent.lastVote,
      rootSlot: delinquent.rootSlot,
      status: "delinquent",
    };
  throw new ValidatorError(
    `Validator vote account ${voteAccount} was not found.`,
  );
}

export function parseValidatorAddress(value: string): Address {
  try {
    return address(value);
  } catch {
    throw new ValidatorError(`Invalid validator vote account: ${value}`);
  }
}
