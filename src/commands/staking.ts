import {
  AccountRole,
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
import {
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_RENT_ADDRESS,
  SYSVAR_STAKE_HISTORY_ADDRESS,
} from "@solana/sysvars";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import {
  getDelegateStakeInstruction,
  getDeactivateInstruction,
  getInitializeInstruction,
  getWithdrawInstruction,
  STAKE_PROGRAM_ADDRESS,
} from "@solana-program/stake";
import {
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { stakeRegistryPath } from "../config/config.js";
import {
  InsufficientBalanceError,
  SimulationError,
  StakeAccountError,
  TransactionRejectedError,
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
import { assertRpcCluster } from "../solana/rpc.js";
import { getStakeActivation } from "../integrations/stake-activation.js";

/**
 * Native Stake Program commands.
 *
 * Native staking creates a real Solana stake account and follows epoch-based
 * activation/deactivation rules. This is deliberately kept separate from
 * liquid staking and from Jupiter Lend: those products have different
 * accounts, programs, and withdrawal semantics.
 */
// Solana's canonical StakeStateV2 layout stores Meta.authorized.staker at byte 12
// and Meta.authorized.withdrawer at byte 44 (4-byte enum + 8-byte reserve + pubkeys).
// These are named and tested filters, matching the upstream StakeStateV2 Rust layout;
// they are not used as client-side filtering shortcuts.
export const STAKE_ACCOUNT_SPACE = 200n;
export const STAKE_STAKER_AUTHORITY_OFFSET = 12n;
export const STAKE_WITHDRAW_AUTHORITY_OFFSET = 44n;
const MAX_EPOCH = (1n << 64n) - 1n;
export const STAKE_CONFIG_ADDRESS = address(
  "StakeConfig11111111111111111111111111111111",
);

export function insertReadonlyAccounts(
  instruction: { accounts: readonly unknown[] },
  index: number,
  addresses: readonly ReturnType<typeof address>[],
): any {
  const accounts = [...instruction.accounts];
  accounts.splice(
    index,
    0,
    ...addresses.map((accountAddress) => ({
      address: accountAddress,
      role: AccountRole.READONLY,
    })),
  );
  return { ...instruction, accounts };
}

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
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const validator = await findValidator(
    rpc,
    parseValidatorAddress(validatorValue),
    context.config.commitment,
  );
  if (validator.status === "delinquent")
    throw new ValidatorError(
      "The selected validator is delinquent; choose a current validator explicitly after inspecting it.",
    );
  const requested = parseSol(command.args[0]!);
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
    insertReadonlyAccounts(
      getInitializeInstruction({
        stake: stakeAccount,
        arg0: { staker: owner, withdrawer: owner },
        arg1: {
          unixTimestamp: 0n,
          epoch: 0n,
          custodian: address("11111111111111111111111111111111"),
        },
      }),
      1,
      [SYSVAR_RENT_ADDRESS],
    ),
    insertReadonlyAccounts(
      getDelegateStakeInstruction({
        stake: stakeAccount,
        vote: validator.voteAccount as ReturnType<typeof parseAddress>,
        stakeAuthority: signer,
      }),
      2,
      [
        SYSVAR_CLOCK_ADDRESS,
        SYSVAR_STAKE_HISTORY_ADDRESS,
        STAKE_CONFIG_ADDRESS,
      ],
    ),
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
  context.output.preflight(
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
        context.config.cluster === "mainnet"
          ? "You are about to submit a MAINNET transaction. Proceed?"
          : "Submit this staking transaction?",
      ))
    )
  )
    throw new TransactionRejectedError();
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
    latest.value.lastValidBlockHeight,
  );
  let registrySaved = true;
  try {
    await addRegistryEntry(context, {
      address: stakeAccount,
      validatorVoteAccount: validator.voteAccount,
      createdSignature: String(signature),
      createdAt: new Date().toISOString(),
    });
  } catch {
    registrySaved = false;
  }
  context.output.print(
    {
      ok: true,
      signature: String(signature),
      slot: status.slot,
      status: status.confirmationStatus,
      stakeAccount,
      registrySaved,
    },
    `Stake created and delegated. Signature: ${signature}\nStake account: ${stakeAccount}${registrySaved ? "" : "\nWarning: local stake registry could not be updated."}`,
  );
}

export async function stakeList(context: CommandContext): Promise<void> {
  const owner = await requireWallet(context);
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
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
  const accounts = await Promise.all(
    [...byAddress.entries()].map(([accountAddress, account]) =>
      parseStakeAccount(context, accountAddress, account),
    ),
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
  if (info.state !== "active")
    throw new StakeAccountError(
      `Stake account is already ${info.state}; deactivation is epoch-based and cannot be repeated.`,
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
      insertReadonlyAccounts(
        getDeactivateInstruction({
          stake: stakeAccount,
          stakeAuthority: signer,
        }),
        1,
        [SYSVAR_CLOCK_ADDRESS],
      ),
    ],
    {
      action: "Deactivate stake",
      stakeAccount,
      validatorVoteAccount: info.validatorVoteAccount,
      stakeLamports: info.stakeLamports,
    },
    `Action:        Deactivate stake\nStake account: ${stakeAccount}\nValidator:     ${info.validatorVoteAccount}\nStake:         ${formatSol(info.stakeLamports)} SOL\nDeactivation is epoch-based; funds will not be immediately withdrawable.`,
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
  if (info.locked)
    throw new StakeAccountError(
      "Stake account is still within its lockup; withdrawal is unavailable until the lockup expires or its custodian authorizes it.",
    );
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
      insertReadonlyAccounts(
        getWithdrawInstruction({
          stake: stakeAccount,
          recipient: owner,
          withdrawAuthority: signer,
          args: requested,
        }) as any,
        2,
        [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS],
      ),
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
  await assertRpcCluster(rpc, context.config.cluster);
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
  context.output.preflight(
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
        context.config.cluster === "mainnet"
          ? "You are about to submit a MAINNET transaction. Proceed?"
          : "Submit this transaction?",
      ))
    )
  )
    throw new TransactionRejectedError();
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
    latest.value.lastValidBlockHeight,
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
  locked: boolean;
  state: "active" | "deactivating" | "inactive" | "activating";
}> {
  const rpc = context.getClient().rpc;
  await assertRpcCluster(rpc, context.config.cluster);
  const response = await rpcRequest(
    rpc.getAccountInfo(account, {
      commitment: context.config.commitment,
      encoding: "jsonParsed",
    }),
    "stake account lookup",
  );
  if (!response.value)
    throw new StakeAccountError(`Stake account ${account} was not found.`);
  if (String((response.value as any).owner) !== String(STAKE_PROGRAM_ADDRESS))
    throw new StakeAccountError(
      `Account ${account} is not owned by the Solana Stake Program.`,
    );
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
  const lockup = info.meta.lockup;
  let locked = false;
  if (lockup) {
    const lockupTimestamp = BigInt(lockup.unixTimestamp ?? 0);
    const lockupEpoch = BigInt(lockup.epoch ?? 0);
    if (lockupTimestamp > 0n || lockupEpoch > 0n) {
      const epochInfo = await rpcRequest(
        rpc.getEpochInfo({ commitment: context.config.commitment }),
        "lockup epoch lookup",
      );
      const slot = await rpcRequest(
        rpc.getSlot({ commitment: context.config.commitment }),
        "lockup slot lookup",
      );
      const blockTime = await rpcRequest(
        rpc.getBlockTime(slot as bigint),
        "lockup chain-time lookup",
      );
      if (blockTime === null)
        throw new StakeAccountError(
          "Unable to verify stake lockup expiration from chain time.",
        );
      const wallet = await requireWallet(context);
      locked =
        (lockupEpoch > BigInt(epochInfo.epoch) ||
          lockupTimestamp > BigInt(blockTime)) &&
        String(lockup.custodian) !== String(wallet);
    }
  }
  const activation = delegation
    ? await getStakeActivation(context.config, account)
    : { state: "inactive" as const };
  const state = activation.state;
  const withdrawableLamports = state === "inactive" ? lamports : 0n;
  return {
    delegated,
    validatorVoteAccount: String(delegation?.voterPubkey ?? "unknown"),
    stakeLamports,
    lamports,
    withdrawableLamports,
    rentReserveLamports,
    locked,
    state,
  };
}

function normalizeDeactivationEpoch(value: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const epoch = BigInt(value as string | number | bigint);
  return epoch >= MAX_EPOCH ? undefined : epoch;
}

async function parseStakeAccount(
  context: CommandContext,
  accountAddress: string,
  account: unknown,
): Promise<Record<string, unknown>> {
  const value = (account as any).account;
  const info = value?.data?.parsed?.info;
  const lamports = BigInt(value?.lamports ?? 0);
  const delegation = info?.stake?.delegation;
  const activationEpoch =
    delegation?.activationEpoch === undefined
      ? undefined
      : BigInt(delegation.activationEpoch);
  const deactivationEpoch = normalizeDeactivationEpoch(
    delegation?.deactivationEpoch,
  );
  const state = delegation
    ? (await getStakeActivation(context.config, parseAddress(accountAddress)))
        .state
    : "inactive";
  return {
    address: accountAddress,
    lamports,
    rentReserveLamports: BigInt(info?.meta?.rentExemptReserve ?? 0),
    delegatedStakeLamports: BigInt(delegation?.stake ?? 0),
    validatorVoteAccount: String(delegation?.voterPubkey ?? "unknown"),
    stakerAuthority: String(info?.meta?.authorized?.staker ?? "unknown"),
    withdrawAuthority: String(info?.meta?.authorized?.withdrawer ?? "unknown"),
    activationEpoch: activationEpoch ?? null,
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
  const target = stakeRegistryPath(context.config.configDir);
  const temporaryDirectory = await mkdtemp(
    path.join(path.dirname(target), ".stake-registry-"),
  );
  const temporaryPath = path.join(temporaryDirectory, "stake-accounts.json");
  try {
    await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, target);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
