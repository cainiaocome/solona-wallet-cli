"""Advance one safe step of a persistent-wallet Devnet stake lifecycle.

Run only from a trusted, scheduled/manual GitHub Actions job with the dedicated
Devnet-only key in SOL_WALLET_DEVNET_LIFECYCLE_KEYPAIR_JSON. Never use a wallet
that has held Mainnet funds.
"""

import json
import os
from pathlib import Path
import secrets
import sys
import tempfile

import run_devnet_e2e as e2e
from devnet_rpc_proxy import DevnetRpcProxy


KEYPAIR_SECRET_NAME = "SOL_WALLET_DEVNET_LIFECYCLE_KEYPAIR_JSON"


def write_secret_keypair(path, raw_value):
    try:
        parsed = json.loads(raw_value)
        if (
            not isinstance(parsed, list)
            or len(parsed) != 64
            or any(type(byte) is not int or not 0 <= byte <= 255 for byte in parsed)
        ):
            raise ValueError
    except (json.JSONDecodeError, ValueError, TypeError):
        raise RuntimeError(
            f"{KEYPAIR_SECRET_NAME} must be a JSON array of 64 bytes."
        ) from None
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(parsed, output)


def fixture_helper(action, *args):
    return e2e.helper(action, *args)


def assert_no_broadcast(proxy, before, command, wallet_dir):
    error = e2e.failure(wallet_dir, e2e.IMAGE, command)
    e2e.require(
        e2e.method_count(proxy, "sendTransaction") == before,
        f"rejected stake command `{command}` broadcast a transaction",
    )
    return error


def run():
    if not e2e.IMAGE:
        raise RuntimeError("SOL_WALLET_E2E_IMAGE must name the built image under test.")
    raw_keypair = os.environ.pop(KEYPAIR_SECRET_NAME, None)
    if not raw_keypair:
        raise RuntimeError(
            f"{KEYPAIR_SECRET_NAME} is required to run the persistent stake lifecycle."
        )
    if e2e.direct_rpc("getGenesisHash") != e2e.DEVNET_GENESIS:
        raise RuntimeError(
            "configured RPC did not identify as Solana Devnet; no lifecycle action taken"
        )

    with tempfile.TemporaryDirectory(
        prefix="sol-wallet-devnet-stake-lifecycle-"
    ) as temporary:
        wallet_dir = Path(temporary)
        wallet_dir.chmod(0o700)
        key_path = wallet_dir / "lifecycle-keypair.json"
        write_secret_keypair(key_path, raw_keypair)
        identity = fixture_helper("identity", key_path)
        address = identity["wallet"]
        passphrase = secrets.token_urlsafe(24)
        with DevnetRpcProxy(e2e.RPC_URL) as proxy:
            e2e.PROXY_PORT = proxy.server_address[1]
            e2e.run_import(wallet_dir, e2e.IMAGE, key_path, passphrase)

            listing = e2e.success(wallet_dir, e2e.IMAGE, "stake list")
            accounts = listing.get("accounts", [])
            chain_accounts = [account for account in accounts if "lamports" in account]
            e2e.require(
                len(chain_accounts) <= 1,
                "lifecycle authority has multiple on-chain stake accounts; refusing to choose ambiguously",
            )
            before_broadcasts = e2e.method_count(proxy, "sendTransaction")

            if not chain_accounts:
                # Only the creation step requests a bounded faucet shortfall.
                # Later epoch-resume runs retain the wallet's fee buffer.
                funding = fixture_helper("fund", key_path)
                e2e.require(
                    funding["wallet"] == address, "lifecycle key identity changed"
                )
                minimum = int(funding["minimumDelegationLamports"])
                amount = e2e.amount_from_lamports(minimum)
                validator_data = e2e.success(
                    wallet_dir,
                    e2e.IMAGE,
                    "validators --limit 20 --max-commission 10",
                )
                validators = validator_data.get("validators", [])
                e2e.require(
                    bool(validators),
                    "no current Devnet validator met the 10% commission ceiling",
                )
                validator = validators[0]["voteAccount"]
                created = e2e.success(
                    wallet_dir,
                    e2e.IMAGE,
                    f"stake create {amount} --validator {validator}",
                    passphrase=passphrase,
                    yes=True,
                )
                stake_account = created.get("stakeAccount")
                e2e.require(
                    isinstance(stake_account, str),
                    "stake create returned no stake account",
                )
                # This immediate second read exercises client-side activation
                # against the real stake account, including the StakeHistory
                # sysvar path that a zero-account smoke test cannot cover.
                after_create = e2e.success(wallet_dir, e2e.IMAGE, "stake list")
                created_record = next(
                    (
                        item
                        for item in after_create.get("accounts", [])
                        if item.get("address") == stake_account
                    ),
                    None,
                )
                e2e.require(
                    created_record is not None,
                    "new stake account was absent from stake list",
                )
                e2e.require(
                    created_record.get("state") in {"activating", "active"},
                    "new stake account had an unexpected activation state",
                )
                e2e.require(
                    e2e.method_count(proxy, "sendTransaction") == before_broadcasts + 1,
                    "stake create did not broadcast exactly one confirmed transaction",
                )
                print(
                    "PASS: created a minimum-sized Devnet stake account and listed its real activation state "
                    f"({created_record['state']}); lifecycle will resume on a later run"
                )
                return

            account = chain_accounts[0]
            stake_account = account["address"]
            state = account.get("state")
            e2e.require(
                account.get("stakerAuthority") == address
                and account.get("withdrawAuthority") == address,
                "managed stake authorities differ from the configured lifecycle wallet",
            )
            e2e.require(
                int(account.get("delegatedStakeLamports", 0)) >= minimum,
                "managed stake amount is below the live Devnet minimum",
            )

            if state == "activating":
                assert_no_broadcast(
                    proxy,
                    before_broadcasts,
                    f"stake deactivate {stake_account}",
                    wallet_dir,
                )
                print("WAIT: stake account is activating; no transaction submitted")
                return
            if state == "deactivating":
                assert_no_broadcast(
                    proxy,
                    before_broadcasts,
                    f"stake deactivate {stake_account}",
                    wallet_dir,
                )
                print("WAIT: stake account is deactivating; no transaction submitted")
                return
            if state == "active":
                assert_no_broadcast(
                    proxy,
                    before_broadcasts,
                    f"stake withdraw {stake_account}",
                    wallet_dir,
                )
                deactivated = e2e.success(
                    wallet_dir,
                    e2e.IMAGE,
                    f"stake deactivate {stake_account}",
                    passphrase=passphrase,
                    yes=True,
                )
                e2e.require(
                    isinstance(deactivated.get("signature"), str),
                    "stake deactivation returned no signature",
                )
                e2e.require(
                    e2e.method_count(proxy, "sendTransaction") == before_broadcasts + 1,
                    "stake deactivation did not broadcast exactly one transaction",
                )
                check = e2e.success(wallet_dir, e2e.IMAGE, "stake list")
                managed = next(
                    item
                    for item in check["accounts"]
                    if item.get("address") == stake_account
                )
                e2e.require(
                    managed.get("state") in {"deactivating", "inactive"},
                    "stake account did not enter its deactivation phase",
                )
                print(
                    f"PASS: active stake deactivated once; observed {managed['state']}"
                )
                return
            if state == "inactive":
                withdrawn = e2e.success(
                    wallet_dir,
                    e2e.IMAGE,
                    f"stake withdraw {stake_account}",
                    passphrase=passphrase,
                    yes=True,
                )
                e2e.require(
                    isinstance(withdrawn.get("signature"), str),
                    "stake withdrawal returned no signature",
                )
                e2e.require(
                    e2e.method_count(proxy, "sendTransaction") == before_broadcasts + 1,
                    "stake withdrawal did not broadcast exactly one transaction",
                )
                remaining = e2e.direct_rpc(
                    "getAccountInfo", [stake_account, {"commitment": "confirmed"}]
                )["value"]
                e2e.require(
                    remaining is None, "withdrawn stake account was not closed on chain"
                )
                print(
                    "PASS: inactive stake withdrawn and its account closure verified on Devnet"
                )
                return
            raise RuntimeError(
                f"managed stake has unexpected state {state!r}; no write was submitted"
            )


def main():
    run()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Devnet stake lifecycle failed: {error}", file=sys.stderr)
        raise SystemExit(1)
