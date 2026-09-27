/** Create and inspect tiny disposable assets on explicitly verified Devnet. */
import { readFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  burn,
  closeAccount,
} from "@solana/spl-token";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const endpoint =
  process.env.SOL_WALLET_DEVNET_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(endpoint, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60_000,
});

function safeError(error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  return message.replace(/https?:\/\/[^\s)]+/g, "[RPC endpoint redacted]");
}

async function readKeypair(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error("keypair file has an invalid format");
  }
  return Keypair.fromSecretKey(Uint8Array.from(value));
}

async function requireDevnet() {
  const actual = await connection.getGenesisHash();
  if (actual !== DEVNET_GENESIS) {
    throw new Error(
      "configured RPC endpoint is not the expected Solana Devnet",
    );
  }
}

async function fundShortfall(payer, shortfall) {
  if (shortfall > 2_000_000_000) {
    throw new Error("Devnet faucet shortfall exceeds the 2 SOL test ceiling");
  }
  if (shortfall === 0) return;
  const latest = await connection.getLatestBlockhash("confirmed");
  const signature = await requestAirdropOnce(payer.publicKey, shortfall);
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err)
    throw new Error("Devnet faucet transaction failed");
}

async function requestAirdropOnce(publicKey, lamports) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "requestAirdrop",
        params: [publicKey.toBase58(), lamports],
      }),
    });
  } catch {
    throw new Error(
      "Devnet faucet RPC request failed before returning a signature; no retry was attempted",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Devnet faucet RPC returned HTTP ${response.status}; no retry was attempted`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "Devnet faucet RPC returned an invalid response; no retry was attempted",
    );
  }
  if (payload.error) {
    const code = payload.error.code ?? "unknown";
    throw new Error(
      `Devnet faucet rejected the request with RPC code ${code}; no retry was attempted`,
    );
  }
  if (typeof payload.result !== "string") {
    throw new Error(
      "Devnet faucet RPC returned no transaction signature; no retry was attempted",
    );
  }
  return payload.result;
}

async function prepare(walletPath, recipientPath) {
  await requireDevnet();
  const payer = await readKeypair(walletPath);
  const recipient = await readKeypair(recipientPath);
  const [minimumResponse, stakeRent, balance] = await Promise.all([
    connection.getStakeMinimumDelegation("confirmed"),
    connection.getMinimumBalanceForRentExemption(200),
    connection.getBalance(payer.publicKey, "confirmed"),
  ]);
  const minimumDelegation = minimumResponse.value;
  const target = minimumDelegation + stakeRent + 50_000_000;
  if (balance < target) {
    await fundShortfall(payer, target - balance);
  }

  const mintAndFund = async (programId) => {
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
      undefined,
      { commitment: "confirmed" },
      programId,
    );
    const source = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey,
      false,
      "confirmed",
      { commitment: "confirmed" },
      programId,
    );
    await mintTo(
      connection,
      payer,
      mint,
      source.address,
      payer,
      2_500_000n,
      [],
      { commitment: "confirmed" },
      programId,
    );
    const destination = await getAssociatedTokenAddress(
      mint,
      recipient.publicKey,
      false,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const existingDestination = await connection.getAccountInfo(
      destination,
      "confirmed",
    );
    if (existingDestination) {
      throw new Error(
        "runtime-generated recipient unexpectedly has a token account",
      );
    }
    return {
      mint: mint.toBase58(),
      programId,
      source: source.address.toBase58(),
    };
  };

  const legacy = await mintAndFund(TOKEN_PROGRAM_ID);
  const token2022 = await mintAndFund(TOKEN_2022_PROGRAM_ID);
  return {
    wallet: payer.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(),
    minimumDelegationLamports: String(minimumDelegation),
    legacyMint: legacy.mint,
    legacySource: legacy.source,
    token2022Mint: token2022.mint,
    token2022Source: token2022.source,
  };
}

async function inspectFunding(walletPath, targetLamports = "1050000000") {
  await requireDevnet();
  const payer = await readKeypair(walletPath);
  const [minimumResponse, balance] = await Promise.all([
    connection.getStakeMinimumDelegation("confirmed"),
    connection.getBalance(payer.publicKey, "confirmed"),
  ]);
  const rent = await connection.getMinimumBalanceForRentExemption(200);
  const target = Math.max(
    Number(targetLamports),
    minimumResponse.value + rent + 50_000_000,
  );
  const shortfall = Math.max(0, target - balance);
  if (shortfall > 0) {
    if (shortfall > 2_000_000_000) {
      throw new Error(
        "lifecycle wallet needs more than the 2 SOL faucet request limit",
      );
    }
    await fundShortfall(payer, shortfall);
  }
  return {
    wallet: payer.publicKey.toBase58(),
    balanceLamports: String(
      await connection.getBalance(payer.publicKey, "confirmed"),
    ),
    minimumDelegationLamports: String(minimumResponse.value),
    stakeRentLamports: String(rent),
  };
}

async function balances(walletPath, recipientPath, fixtures) {
  await requireDevnet();
  const wallet = await readKeypair(walletPath);
  const recipient = await readKeypair(recipientPath);
  const readMintBalances = async (mintValue, programId) => {
    const mint = new PublicKey(mintValue);
    const sourceAddress = await getAssociatedTokenAddress(
      mint,
      wallet.publicKey,
      false,
      programId,
    );
    const destinationAddress = await getAssociatedTokenAddress(
      mint,
      recipient.publicKey,
      false,
      programId,
    );
    const [source, destinationInfo] = await Promise.all([
      getAccount(connection, sourceAddress, "confirmed", programId),
      connection.getAccountInfo(destinationAddress, "confirmed"),
    ]);
    const destination = destinationInfo
      ? await getAccount(connection, destinationAddress, "confirmed", programId)
      : undefined;
    return {
      source: String(source.amount),
      destination: String(destination?.amount ?? 0n),
    };
  };
  const [walletLamports, recipientLamports, legacy, token2022] =
    await Promise.all([
      connection.getBalance(wallet.publicKey, "confirmed"),
      connection.getBalance(recipient.publicKey, "confirmed"),
      readMintBalances(fixtures.legacyMint, TOKEN_PROGRAM_ID),
      readMintBalances(fixtures.token2022Mint, TOKEN_2022_PROGRAM_ID),
    ]);
  return {
    walletLamports: String(walletLamports),
    recipientLamports: String(recipientLamports),
    legacy,
    token2022,
  };
}

async function cleanup(walletPath, recipientPath, fixtures) {
  await requireDevnet();
  const payer = await readKeypair(walletPath);
  const recipient = await readKeypair(recipientPath);
  for (const [mintValue, programId] of [
    [fixtures.legacyMint, TOKEN_PROGRAM_ID],
    [fixtures.token2022Mint, TOKEN_2022_PROGRAM_ID],
  ]) {
    const mint = new PublicKey(mintValue);
    const source = await getAssociatedTokenAddress(
      mint,
      payer.publicKey,
      false,
      programId,
    );
    const destination = await getAssociatedTokenAddress(
      mint,
      recipient.publicKey,
      false,
      programId,
    );
    const sourceInfo = await getAccount(
      connection,
      source,
      "confirmed",
      programId,
    );
    const destinationExists = await connection.getAccountInfo(
      destination,
      "confirmed",
    );
    if (sourceInfo.amount > 0n) {
      await burn(
        connection,
        payer,
        source,
        mint,
        payer,
        sourceInfo.amount,
        [],
        { commitment: "confirmed" },
        programId,
      );
    }
    if (destinationExists) {
      const destinationInfo = await getAccount(
        connection,
        destination,
        "confirmed",
        programId,
      );
      if (destinationInfo.amount > 0n) {
        await burn(
          connection,
          payer,
          destination,
          mint,
          recipient,
          destinationInfo.amount,
          [],
          { commitment: "confirmed" },
          programId,
        );
      }
      await closeAccount(
        connection,
        payer,
        destination,
        payer.publicKey,
        recipient,
        [],
        { commitment: "confirmed" },
        programId,
      );
    }
    await closeAccount(
      connection,
      payer,
      source,
      payer.publicKey,
      payer,
      [],
      { commitment: "confirmed" },
      programId,
    );
  }
  return { tokenAccountsClosed: 4 };
}

try {
  const [action, ...args] = process.argv.slice(2);
  let result;
  if (action === "identity") {
    const keypair = await readKeypair(args[0]);
    result = { wallet: keypair.publicKey.toBase58() };
  } else if (action === "prepare") result = await prepare(args[0], args[1]);
  else if (action === "fund") result = await inspectFunding(args[0], args[1]);
  else if (action === "balances")
    result = await balances(args[0], args[1], JSON.parse(args[2]));
  else if (action === "cleanup")
    result = await cleanup(args[0], args[1], JSON.parse(args[2]));
  else throw new Error("unknown fixture operation");
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`Devnet fixture setup failed: ${safeError(error)}\n`);
  process.exitCode = 1;
}
