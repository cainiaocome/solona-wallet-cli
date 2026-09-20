import {
  appendTransactionMessageInstruction,
  address,
  compileTransaction,
  createAddressWithSeed,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import {
  getDelegateStakeInstruction,
  getDeactivateInstruction,
  getInitializeInstruction,
  getWithdrawInstruction,
  STAKE_PROGRAM_ADDRESS,
} from "@solana-program/stake";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { stakeRegistryPath } from "../config/config.js";
import {
  ConfirmationError,
  InsufficientBalanceError,
  SimulationError,
  StakeAccountError,
  ValidatorError,
  safeJson,
} from "../errors/errors.js";
import { confirm } from "../shell/prompt.js";
import { flagValue, hasFlag, type ParsedCommand } from "../shell/parser.js";
import { formatSol, parseSol } from "../solana/amounts.js";
import { rpcRequest } from "../solana/rpc.js";
import { findValidator, parseValidatorAddress } from "../solana/validators.js";
import { parseAddress } from "../wallet/address.js";
import { EncryptedKeystoreSigner } from "../wallet/signer.js";
import { requireWallet } from "./read-only.js";
import { confirmSignature } from "./send.js";
import type { CommandContext } from "./context.js";

// Solana's canonical StakeStateV2 layout stores Meta.authorized.staker at byte 12
// and Meta.authorized.withdrawer at byte 44 (4-byte enum + 8-byte reserve + pubkeys).
// These are named and tested filters, matching the upstream StakeStateV2 Rust layout;
// they are not used as client-side filtering shortcuts.
export const STAKE_ACCOUNT_SPACE = 200n;
export const STAKE_STAKER_AUTHORITY_OFFSET = 12n;
export const STAKE_WITHDRAW_AUTHORITY_OFFSET = 44n;

interface StakeRegistryEntry {
  address: string;
  validatorVoteAccount: string;
  createdSignature?: string;
  createdAt: string;
}

interface StakeRegistry {
  version: 1;
  accounts: StakeRegistryEntry[];
}

export async function stakeCreate(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  const owner = await requireWallet(context);
  if (command.args.length !== 1)
    throw new StakeAccountError(
      "Usage: stake create <amount> --validator <vote-account>",
    );
  const validatorValue = flagValue(command, "validator");
  if (!validatorValue)
    throw new ValidatorError(
      "stake create requires --validator <vote-account>.",
    );
  const validator = await findValidator(
    context.getClient().rpc,
    parseValidatorAddress(validatorValue),
    context.config.commitment,
  );
  if (validator.status === "delinquent")
    throw new ValidatorError(
      "The selected validator is delinquent; choose a current validator explicitly after inspecting it.",
    );
  const requested = parseSol(command.args[0]!);
  const rpc = context.getClient().rpc;
  const minimumResponse = await rpcRequest(
    rpc.getStakeMinimumDelegation({ commitment: context.config.commitment }),
    "stake minimum delegation lookup",
  );
  const minimum = BigInt(minimumResponse.value as bigint);
  if (requested < minimum)
    throw new StakeAccountError(
      `Effective stake must be at least ${formatSol(minimum)} SOL on this cluster.`,
    );
  const rentResponse = await rpcRequest(
    rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE, {
      commitment: context.config.commitment,
    }),
    "stake account rent lookup",
  );
  const rentReserve = BigInt(rentResponse as bigint);
  const signer = new EncryptedKeystoreSigner(
    context.config.configDir,
    owner,
    context.readPassphrase,
  );
  const latest = await rpcRequest(
    rpc.getLatestBlockhash({ commitment: context.config.commitment }),
    "recent blockhash lookup",
  );
  const seed = String(latest.value.blockhash).slice(0, 32);
  if (Buffer.byteLength(seed, "utf8") > 32)
    throw new StakeAccountError(
      "Could not construct a valid stake-account seed.",
    );
  const stakeAccount = await createAddressWithSeed({
    baseAddress: owner,
    programAddress: STAKE_PROGRAM_ADDRESS,
    seed,
  });
  const instructions = [
    getCreateAccountWithSeedInstruction({
      payer: signer,
      newAccount: stakeAccount,
      baseAccount: signer,
      base: owner,
      seed,
      amount: requested + rentReserve,
      space: STAKE_ACCOUNT_SPACE,
      programAddress: STAKE_PROGRAM_ADDRESS,
    }),
    getInitializeInstruction({
      stake: stakeAccount,
      arg0: { staker: owner, withdrawer: owner },
      arg1: {
        unixTimestamp: 0n,
        epoch: 0n,
        custodian: address("11111111111111111111111111111111"),
      },
    }),
    getDelegateStakeInstruction({
      stake: stakeAccount,
      vote: validator.voteAccount as ReturnType<typeof parseAddress>,
      stakeAuthority: signer,
    }),
  ];
  let message: any = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayer(owner, message);
  message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
  for (const instruction of instructions)
    message = appendTransactionMessageInstruction(instruction, message);
  const unsigned = compileTransaction(message);
  const feeResponse = await rpcRequest(
    rpc.getFeeForMessage(
      Buffer.from(unsigned.messageBytes).toString("base64") as any,
    ),
    "fee estimation",
  );
  const fee = BigInt(feeResponse.value ?? 0n);
  const balanceResponse = await rpcRequest(
    rpc.getBalance(owner, { commitment: context.config.commitment }),
    "balance lookup",
  );
  const balance = BigInt(balanceResponse.value as bigint);
  const total = requested + rentReserve + fee;
  if (balance < total)
    throw new InsufficientBalanceError(
      `Insufficient balance. Need ${formatSol(total)} SOL including rent and fee; have ${formatSol(balance)} SOL.`,
    );
  const summary = {
    action: "Native SOL stake",
    wallet: owner,
    validatorVoteAccount: validator.voteAccount,
    validatorNode: validator.nodeIdentity,
    validatorCommission: validator.commission,
    effectiveStakeLamports: requested,
    rentReserveLamports: rentReserve,
    totalMovedLamports: requested + rentReserve,
    estimatedFeeLamports: fee,
    stakeAccount,
    cluster: context.config.cluster,
    dryRun: hasFlag(command, "dry-run") || context.session.dryRun,
  };
  context.output.print(
    { ok: true, preflight: summary },
    `Action:              Native SOL stake\nWallet:              ${owner}\nValidator vote acct: ${validator.voteAccount}\nValidator node:      ${validator.nodeIdentity}\nValidator commission: ${validator.commission}%\nEffective stake:     ${formatSol(requested)} SOL\nRent reserve:        ${formatSol(rentReserve)} SOL\nTotal moved:         ${formatSol(requested + rentReserve)} SOL\nNetwork fee:         ~${formatSol(fee)} SOL\nStake account:       ${stakeAccount}\nCluster:             ${context.config.cluster}`,
  );
  const simulation = await rpcRequest(
    rpc.simulateTransaction(getBase64EncodedWireTransaction(unsigned), {
      encoding: "base64",
      sigVerify: false,
      commitment: context.config.commitment,
    }),
    "transaction simulation",
  );
  if (simulation.value.err)
    throw new SimulationError(
      `Transaction simulation failed: ${safeJson(simulation.value.err)}`,
      { logs: simulation.value.logs },
    );
  if (summary.dryRun) {
    context.output.print(
      { ok: true, status: "simulated", dryRun: true, preflight: summary },
      "Dry-run complete. The transaction was simulated and not broadcast.",
    );
    return;
  }
  if (
    !(
      hasFlag(command, "yes") ||
      context.session.yes ||
      (await confirm(
        context.config.cluster === "mainnet-beta"
          ? "You are about to submit a MAINNET transaction. Proceed?"
          : "Submit this staking transaction?",
      ))
    )
  )
    throw new ConfirmationError("Transaction cancelled by user.");
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpcRequest(
    rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      skipPreflight: true,
      preflightCommitment: context.config.commitment,
    }),
    "transaction broadcast",
  );
  const status = await confirmSignature(
    rpc,
    String(signature),
    context.config.commitment,
  );
  await addRegistryEntry(context, {
    address: stakeAccount,
    validatorVoteAccount: validator.voteAccount,
    createdSignature: String(signature),
    createdAt: new Date().toISOString(),
  });
  context.output.print(
    {
      ok: true,
      signature: String(signature),
      slot: status.slot,
      status: status.confirmationStatus,
      stakeAccount,
    },
    `Stake created and delegated. Signature: ${signature}\nStake account: ${stakeAccount}`,
  );
}

export async function stakeList(context: CommandContext): Promise<void> {
  const owner = await requireWallet(context);
  const rpc = context.getClient().rpc;
  const config = {
    commitment: context.config.commitment,
    encoding: "jsonParsed" as const,
    filters: [
      { dataSize: STAKE_ACCOUNT_SPACE },
      {
        memcmp: {
          offset: STAKE_STAKER_AUTHORITY_OFFSET,
          bytes: owner as any,
          encoding: "base58" as const,
        },
      },
    ],
  };
  const withdrawConfig = {
    commitment: context.config.commitment,
    encoding: "jsonParsed" as const,
    filters: [
      { dataSize: STAKE_ACCOUNT_SPACE },
      {
        memcmp: {
          offset: STAKE_WITHDRAW_AUTHORITY_OFFSET,
          bytes: owner as any,
          encoding: "base58" as const,
        },
      },
    ],
  };
  const [stakerAccounts, withdrawerAccounts, registry] = await Promise.all([
    rpcRequest(
      rpc.getProgramAccounts(STAKE_PROGRAM_ADDRESS, config),
      "stake account lookup",
    ),
    rpcRequest(
      rpc.getProgramAccounts(STAKE_PROGRAM_ADDRESS, withdrawConfig),
      "stake account lookup",
    ),
    readRegistry(context),
  ]);
  const byAddress = new Map<string, unknown>();
  for (const account of [...stakerAccounts, ...withdrawerAccounts])
    byAddress.set(String((account as any).pubkey), account);
  const currentEpoch = BigInt(
    (
      await rpcRequest(
        rpc.getEpochInfo({ commitment: context.config.commitment }),
        "epoch lookup",
      )
    ).epoch,
  );
  const accounts = [...byAddress.entries()].map(([accountAddress, account]) =>
    parseStakeAccount(accountAddress, account, currentEpoch),
  );
  for (const entry of registry.accounts)
    if (!byAddress.has(entry.address))
      accounts.push({
        address: entry.address,
        validatorVoteAccount: entry.validatorVoteAccount,
        state: "unknown",
        source: "local-registry",
      });
  context.completion.stakeAccounts = accounts.map((account) =>
    String(account.address),
  );
  context.output.print(
    { ok: true, owner, accounts },
    accounts.length
      ? accounts
          .map(
            (account) =>
              `${String(account.address)}  ${String(account.state)}  ${"lamports" in account ? formatSol(BigInt(account.lamports as bigint)) + " SOL" : ""}  ${"validatorVoteAccount" in account ? String(account.validatorVoteAccount) : ""}`,
          )
          .join("\n")
      : "No stake accounts found.",
  );
}

export async function stakeDeactivate(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (command.args.length !== 1)
    throw new StakeAccountError("Usage: stake deactivate <stake-account>");
  const owner = await requireWallet(context);
  const stakeAccount = parseAddress(command.args[0]!);
  const info = await getControlledStake(context, stakeAccount, "staker");
  if (!info.delegated)
    throw new StakeAccountError("Stake account is not currently delegated.");
  const signer = new EncryptedKeystoreSigner(
    context.config.configDir,
    owner,
    context.readPassphrase,
  );
  await runStakeInstruction(
    context,
    command,
    [getDeactivateInstruction({ stake: stakeAccount, stakeAuthority: signer })],
    {
      action: "Deactivate stake",
      stakeAccount,
      validatorVoteAccount: info.validatorVoteAccount,
      stakeLamports: info.stakeLamports,
    },
    `Action:        Deactivate stake\nStake account: ${stakeAccount}\nValidator:     ${info.validatorVoteAccount}\nStake:         ${formatSol(info.stakeLamports)} SOL`,
  );
}

export async function stakeWithdraw(
  context: CommandContext,
  command: ParsedCommand,
): Promise<void> {
  if (command.args.length !== 1)
    throw new StakeAccountError(
      "Usage: stake withdraw <stake-account> [--amount <amount>]",
    );
  const owner = await requireWallet(context);
  const stakeAccount = parseAddress(command.args[0]!);
  const info = await getControlledStake(context, stakeAccount, "withdrawer");
  const requested = flagValue(command, "amount")
    ? parseSol(flagValue(command, "amount")!)
    : info.withdrawableLamports;
  if (requested <= 0n || requested > info.withdrawableLamports)
    throw new StakeAccountError(
      `Requested withdrawal is unavailable. Currently withdrawable: ${formatSol(info.withdrawableLamports)} SOL.`,
    );
  if (
    info.lamports - requested > 0n &&
    info.lamports - requested < info.rentReserveLamports
  )
    throw new StakeAccountError(
      "This withdrawal would leave a non-rent-exempt residual stake account.",
    );
  const signer = new EncryptedKeystoreSigner(
    context.config.configDir,
    owner,
    context.readPassphrase,
  );
  await runStakeInstruction(
    context,
    command,
    [
      getWithdrawInstruction({
        stake: stakeAccount,
        recipient: owner,
        withdrawAuthority: signer,
        args: requested,
      }) as any,
    ],
    {
      action: "Withdraw stake",
      stakeAccount,
      amountLamports: requested,
      destination: owner,
      closesAccount: requested === info.lamports,
    },
    `Action:        Withdraw stake\nStake account: ${stakeAccount}\nAmount:        ${formatSol(requested)} SOL\nDestination:   ${owner}\n${requested === info.lamports ? "This closes the stake account." : ""}`,
  );
}

async function runStakeInstruction(
  context: CommandContext,
  command: ParsedCommand,
  instructions: readonly any[],
  summary: Record<string, unknown>,
  human: string,
): Promise<void> {
  const owner = await requireWallet(context);
  const rpc = context.getClient().rpc;
  const latest = await rpcRequest(
    rpc.getLatestBlockhash({ commitment: context.config.commitment }),
    "recent blockhash lookup",
  );
  let message: any = createTransactionMessage({ version: 0 });
  message = setTransactionMessageFeePayer(owner, message);
  message = setTransactionMessageLifetimeUsingBlockhash(latest.value, message);
  for (const instruction of instructions)
    message = appendTransactionMessageInstruction(instruction, message);
  const unsigned = compileTransaction(message);
  const fee = BigInt(
    (
      await rpcRequest(
        rpc.getFeeForMessage(
          Buffer.from(unsigned.messageBytes).toString("base64") as any,
        ),
        "fee estimation",
      )
    ).value ?? 0n,
  );
  const preflight = {
    ...summary,
    estimatedFeeLamports: fee,
    cluster: context.config.cluster,
    dryRun: hasFlag(command, "dry-run") || context.session.dryRun,
  };
  context.output.print(
    { ok: true, preflight },
    `${human}\nNetwork fee:  ~${formatSol(fee)} SOL\nCluster:      ${context.config.cluster}`,
  );
  const simulation = await rpcRequest(
    rpc.simulateTransaction(getBase64EncodedWireTransaction(unsigned), {
      encoding: "base64",
      sigVerify: false,
      commitment: context.config.commitment,
    }),
    "transaction simulation",
  );
  if (simulation.value.err)
    throw new SimulationError(
      `Transaction simulation failed: ${safeJson(simulation.value.err)}`,
      { logs: simulation.value.logs },
    );
  if (preflight.dryRun) {
    context.output.print(
      { ok: true, status: "simulated", dryRun: true, preflight },
      "Dry-run complete. The transaction was simulated and not broadcast.",
    );
    return;
  }
  if (
    !(
      hasFlag(command, "yes") ||
      context.session.yes ||
      (await confirm(
        context.config.cluster === "mainnet-beta"
          ? "You are about to submit a MAINNET transaction. Proceed?"
          : "Submit this transaction?",
      ))
    )
  )
    throw new ConfirmationError("Transaction cancelled by user.");
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpcRequest(
    rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      skipPreflight: true,
      preflightCommitment: context.config.commitment,
    }),
    "transaction broadcast",
  );
  const status = await confirmSignature(
    rpc,
    String(signature),
    context.config.commitment,
  );
  context.output.print(
    {
      ok: true,
      signature: String(signature),
      slot: status.slot,
      status: status.confirmationStatus,
      preflight,
    },
    `Transaction confirmed: ${signature}`,
  );
}

async function getControlledStake(
  context: CommandContext,
  account: ReturnType<typeof parseAddress>,
  authority: "staker" | "withdrawer",
): Promise<{
  delegated: boolean;
  validatorVoteAccount: string;
  stakeLamports: bigint;
  lamports: bigint;
  withdrawableLamports: bigint;
  rentReserveLamports: bigint;
}> {
  const rpc = context.getClient().rpc;
  const response = await rpcRequest(
    rpc.getAccountInfo(account, {
      commitment: context.config.commitment,
      encoding: "jsonParsed",
    }),
    "stake account lookup",
  );
  if (!response.value)
    throw new StakeAccountError(`Stake account ${account} was not found.`);
  const info = (response.value as any).data?.parsed?.info;
  const authorized = info?.meta?.authorized;
  if (
    !authorized ||
    String(authorized[authority]) !== String(await requireWallet(context))
  )
    throw new StakeAccountError(
      `Wallet is not the ${authority} authority for ${account}.`,
    );
  const lamports = BigInt((response.value as any).lamports);
  const rentReserveLamports = BigInt(info.meta.rentExemptReserve ?? 0);
  const delegation = info.stake?.delegation;
  const stakeLamports = BigInt(delegation?.stake ?? 0);
  const delegated = Boolean(delegation);
  const state = delegation
    ? await currentStakeState(context, delegation.deactivationEpoch)
    : "inactive";
  const withdrawableLamports = state === "inactive" ? lamports : 0n;
  return {
    delegated,
    validatorVoteAccount: String(delegation?.voterPubkey ?? "unknown"),
    stakeLamports,
    lamports,
    withdrawableLamports,
    rentReserveLamports,
  };
}

async function currentStakeState(
  context: CommandContext,
  deactivationEpoch: unknown,
): Promise<"active" | "deactivating" | "inactive"> {
  if (deactivationEpoch === undefined || deactivationEpoch === null)
    return "active";
  const epoch = BigInt(
    (
      await rpcRequest(
        context
          .getClient()
          .rpc.getEpochInfo({ commitment: context.config.commitment }),
        "epoch lookup",
      )
    ).epoch,
  );
  return BigInt(deactivationEpoch as string | number | bigint) <= epoch
    ? "inactive"
    : "deactivating";
}

function parseStakeAccount(
  accountAddress: string,
  account: unknown,
  currentEpoch: bigint,
): Record<string, unknown> {
  const value = (account as any).account;
  const info = value?.data?.parsed?.info;
  const lamports = BigInt(value?.lamports ?? 0);
  const delegation = info?.stake?.delegation;
  const deactivationEpoch =
    delegation?.deactivationEpoch === undefined
      ? undefined
      : BigInt(delegation.deactivationEpoch);
  const state = !delegation
    ? "inactive"
    : deactivationEpoch !== undefined && deactivationEpoch <= currentEpoch
      ? "inactive"
      : deactivationEpoch !== undefined
        ? "deactivating"
        : "active";
  return {
    address: accountAddress,
    lamports,
    rentReserveLamports: BigInt(info?.meta?.rentExemptReserve ?? 0),
    delegatedStakeLamports: BigInt(delegation?.stake ?? 0),
    validatorVoteAccount: String(delegation?.voterPubkey ?? "unknown"),
    stakerAuthority: String(info?.meta?.authorized?.staker ?? "unknown"),
    withdrawAuthority: String(info?.meta?.authorized?.withdrawer ?? "unknown"),
    activationEpoch:
      delegation?.activationEpoch === undefined
        ? null
        : BigInt(delegation.activationEpoch),
    deactivationEpoch: deactivationEpoch ?? null,
    state,
  };
}

async function readRegistry(context: CommandContext): Promise<StakeRegistry> {
  try {
    const parsed = JSON.parse(
      await readFile(stakeRegistryPath(context.config.configDir), "utf8"),
    ) as Partial<StakeRegistry>;
    return {
      version: 1,
      accounts: Array.isArray(parsed.accounts)
        ? parsed.accounts.filter(
            (entry) =>
              entry &&
              typeof entry.address === "string" &&
              typeof entry.validatorVoteAccount === "string" &&
              typeof entry.createdAt === "string",
          )
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, accounts: [] };
    throw new StakeAccountError("Stake registry is malformed.");
  }
}

async function addRegistryEntry(
  context: CommandContext,
  entry: StakeRegistryEntry,
): Promise<void> {
  const registry = await readRegistry(context);
  registry.accounts = [
    ...registry.accounts.filter(
      (existing) => existing.address !== entry.address,
    ),
    entry,
  ];
  await writeFile(
    stakeRegistryPath(context.config.configDir),
    `${JSON.stringify(registry, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(stakeRegistryPath(context.config.configDir), 0o600);
}
