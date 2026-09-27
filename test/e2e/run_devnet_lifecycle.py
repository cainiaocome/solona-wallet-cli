"""Advance one safe step of a persistent-wallet Devnet stake lifecycle.

Run only from a trusted, scheduled/manual GitHub Actions job with the dedicated
Devnet-only key in SOL_WALLET_DEVNET_LIFECYCLE_KEYPAIR_JSON. Never use a wallet
that has held Mainnet funds.
"""

import json
import os
from pathlib import Path
import secrets
import stat
import sys
import tempfile

import run_devnet_e2e as e2e
from devnet_rpc_proxy import DevnetRpcProxy


KEYPAIR_SECRET_NAME = "SOL_WALLET_DEVNET_LIFECYCLE_KEYPAIR_JSON"
STATE_FILE_ENV_NAME = "SOL_WALLET_DEVNET_LIFECYCLE_STATE_FILE"


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


def lifecycle_state_file():
    configured_path = os.environ.get(STATE_FILE_ENV_NAME)
    if not configured_path:
        raise RuntimeError(f"{STATE_FILE_ENV_NAME} must name the persisted state file.")
    return Path(configured_path)


def read_lifecycle_state(path, wallet):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise RuntimeError("lifecycle state must be a private regular file")
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise RuntimeError("lifecycle state is unreadable or malformed") from None
    if (
        not isinstance(state, dict)
        or type(state.get("version")) is not int
        or state.get("version") != 1
        or state.get("wallet") != wallet
        or (
            state.get("stakeAccount") is not None
            and (
                not isinstance(state.get("stakeAccount"), str)
                or not state.get("stakeAccount")
            )
        )
        or (
            state.get("createSignature") is not None
            and (
                not isinstance(state.get("createSignature"), str)
                or not state.get("createSignature")
            )
        )
        or (state.get("stakeAccount") is None) != (state.get("createSignature") is None)
    ):
        raise RuntimeError(
            "lifecycle state does not match this wallet or has an invalid identity"
        )
    return state


def write_lifecycle_state(path, wallet, stake_account, create_signature):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    state = {
        "version": 1,
        "wallet": wallet,
        "stakeAccount": stake_account,
        "createSignature": create_signature,
    }
    temporary_path = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output)
            output.write("\n")
        os.replace(temporary_path, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass
    return state


def recorded_stake_account(chain_accounts, state, wallet):
    if state is None or state["stakeAccount"] is None:
        e2e.require(
            not chain_accounts,
            "on-chain stake accounts exist without a persisted lifecycle identity; refusing to choose or modify one",
        )
        return None
    e2e.require(state["wallet"] == wallet, "lifecycle wallet identity changed")
    matches = [
        account
        for account in chain_accounts
        if account.get("address") == state["stakeAccount"]
    ]
    e2e.require(
        len(matches) == 1,
        "persisted lifecycle stake account is missing or ambiguous; no write was submitted",
    )
    return matches[0]


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
        state_path = lifecycle_state_file()
        lifecycle_state = read_lifecycle_state(state_path, address)
        if lifecycle_state is None:
            lifecycle_state = write_lifecycle_state(state_path, address, None, None)
        passphrase = secrets.token_urlsafe(24)
        with DevnetRpcProxy(e2e.RPC_URL) as proxy:
            e2e.PROXY_PORT = proxy.server_address[1]
            e2e.run_import(wallet_dir, e2e.IMAGE, key_path, passphrase)

            listing = e2e.success(wallet_dir, e2e.IMAGE, "stake list")
            accounts = listing.get("accounts", [])
            chain_accounts = [account for account in accounts if "lamports" in account]
            minimum_response = e2e.direct_rpc(
                "getStakeMinimumDelegation", [{"commitment": "confirmed"}]
            )
            minimum = int(minimum_response.get("value", 0))
            e2e.require(minimum > 0, "Devnet returned an invalid stake minimum")

            if (
                lifecycle_state is not None
                and lifecycle_state["stakeAccount"] is not None
                and not any(
                    account.get("address") == lifecycle_state["stakeAccount"]
                    for account in chain_accounts
                )
            ):
                existing = e2e.direct_rpc(
                    "getAccountInfo",
                    [
                        lifecycle_state["stakeAccount"],
                        {"commitment": "confirmed"},
                    ],
                )["value"]
                e2e.require(
                    existing is None,
                    "persisted lifecycle stake account is absent from stake list but still exists on chain",
                )
                lifecycle_state = write_lifecycle_state(state_path, address, None, None)

            account = recorded_stake_account(chain_accounts, lifecycle_state, address)
            before_broadcasts = e2e.method_count(proxy, "sendTransaction")

            if account is None:
                # Only the creation step requests a bounded faucet shortfall.
                # Later epoch-resume runs retain the wallet's fee buffer.
                funding = fixture_helper("fund", key_path)
                e2e.require(
                    funding["wallet"] == address, "lifecycle key identity changed"
                )
                e2e.require(
                    int(funding["minimumDelegationLamports"]) == minimum,
                    "Devnet stake minimum changed while preparing lifecycle creation",
                )
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
                    isinstance(stake_account, str) and bool(stake_account),
                    "stake create returned no stake account",
                )
                signature = created.get("signature")
                e2e.require(
                    isinstance(signature, str) and bool(signature),
                    "stake create returned no transaction signature",
                )
                lifecycle_state = write_lifecycle_state(
                    state_path, address, stake_account, signature
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
                write_lifecycle_state(state_path, address, None, None)
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
