"""Offline safety regressions for the resumable Devnet stake lifecycle."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

import run_devnet_lifecycle as lifecycle


WALLET = "wallet-test-address"
RECORDED_STAKE = "stake-created-by-test"
OTHER_STAKE = "pre-existing-wallet-stake"
MINIMUM = 1_000_000_000


class FakeProxy:
    server_address = ("127.0.0.1", 43127)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def snapshot(self):
        return []


class DevnetLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="lifecycle-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state_path = self.root / "private-state" / "state.json"

    def run_with_mocks(self, accounts, state=None):
        if state is not None:
            lifecycle.write_lifecycle_state(
                self.state_path,
                WALLET,
                state.get("stakeAccount"),
                state.get("createSignature"),
            )

        account_commands = []
        failures = []
        helper_calls = []
        self.account_commands = account_commands
        self.failures = failures
        self.helper_calls = helper_calls

        def helper(action, *_args):
            helper_calls.append(action)
            if action == "identity":
                return {"wallet": WALLET}
            raise AssertionError(f"unexpected fixture helper action: {action}")

        def direct_rpc(method, _params=None):
            if method == "getGenesisHash":
                return lifecycle.e2e.DEVNET_GENESIS
            if method == "getStakeMinimumDelegation":
                return {"value": MINIMUM}
            raise AssertionError(f"unexpected direct RPC method: {method}")

        def success(_directory, _image, command, **_kwargs):
            account_commands.append(command)
            if command == "stake list":
                return {"accounts": accounts}
            raise AssertionError(f"unexpected successful CLI command: {command}")

        def failure(_directory, _image, command):
            failures.append(command)
            return {"ok": False}

        proxy = FakeProxy()
        with ExitStack() as stack:
            stack.enter_context(
                patch.dict(
                    os.environ,
                    {
                        lifecycle.KEYPAIR_SECRET_NAME: json.dumps([7] * 64),
                        lifecycle.STATE_FILE_ENV_NAME: str(self.state_path),
                    },
                )
            )
            stack.enter_context(patch.object(lifecycle.e2e, "IMAGE", "test-image"))
            stack.enter_context(patch.object(lifecycle.e2e, "direct_rpc", direct_rpc))
            stack.enter_context(patch.object(lifecycle.e2e, "success", success))
            stack.enter_context(patch.object(lifecycle.e2e, "failure", failure))
            stack.enter_context(patch.object(lifecycle, "fixture_helper", helper))
            stack.enter_context(patch.object(lifecycle.e2e, "run_import"))
            stack.enter_context(
                patch.object(lifecycle, "DevnetRpcProxy", return_value=proxy)
            )
            lifecycle.run()
        return account_commands, failures, helper_calls

    def test_resume_reads_live_minimum_and_uses_persisted_identity(self):
        lifecycle.write_lifecycle_state(
            self.state_path, WALLET, RECORDED_STAKE, "create-transaction-signature"
        )
        accounts = [
            {
                "address": OTHER_STAKE,
                "lamports": str(MINIMUM + 5_000_000),
                "delegatedStakeLamports": str(MINIMUM),
                "stakerAuthority": WALLET,
                "withdrawAuthority": WALLET,
                "state": "active",
            },
            {
                "address": RECORDED_STAKE,
                "lamports": str(MINIMUM + 5_000_000),
                "delegatedStakeLamports": str(MINIMUM),
                "stakerAuthority": WALLET,
                "withdrawAuthority": WALLET,
                "state": "activating",
            },
        ]

        commands, failures, helper_calls = self.run_with_mocks(accounts)

        self.assertEqual(commands, ["stake list"])
        self.assertEqual(failures, [f"stake deactivate {RECORDED_STAKE}"])
        self.assertEqual(helper_calls, ["identity"])

    def test_unrecorded_wallet_stake_is_never_selected_or_modified(self):
        accounts = [
            {
                "address": OTHER_STAKE,
                "lamports": str(MINIMUM + 5_000_000),
                "delegatedStakeLamports": str(MINIMUM),
                "stakerAuthority": WALLET,
                "withdrawAuthority": WALLET,
                "state": "active",
            }
        ]

        with self.assertRaisesRegex(
            AssertionError, "without a persisted lifecycle identity"
        ):
            self.run_with_mocks(accounts)
        self.assertEqual(self.account_commands, ["stake list"])
        self.assertEqual(self.failures, [])
        self.assertEqual(self.helper_calls, ["identity"])

    def test_state_contains_only_public_identity_and_has_private_file_modes(self):
        lifecycle.write_lifecycle_state(
            self.state_path, WALLET, RECORDED_STAKE, "create-transaction-signature"
        )

        self.assertEqual(stat.S_IMODE(self.state_path.parent.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.state_path.stat().st_mode), 0o600)
        state = lifecycle.read_lifecycle_state(self.state_path, WALLET)
        self.assertEqual(state["stakeAccount"], RECORDED_STAKE)
        self.assertEqual(
            set(state), {"version", "wallet", "stakeAccount", "createSignature"}
        )
        self.assertNotIn("privateKey", state)


if __name__ == "__main__":
    unittest.main()
