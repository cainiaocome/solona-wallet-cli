import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from mock_rpc import Handler, start_server


IMAGE = os.environ.get("SOL_WALLET_E2E_IMAGE")


@unittest.skipUnless(
    IMAGE and shutil.which("docker"),
    "set SOL_WALLET_E2E_IMAGE and install Docker to run image E2E",
)
class DockerOneShotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = start_server()
        cls.port = cls.server.server_address[1]
        cls.directory = Path(tempfile.mkdtemp(prefix="sol-wallet-e2e-"))
        cls.addClassCleanup(cls.server.shutdown)
        cls.addClassCleanup(lambda: shutil.rmtree(cls.directory, ignore_errors=True))
        fixture = Path(__file__).parents[1] / "fixtures" / "disposable-keypair.json"
        shutil.copyfile(fixture, cls.directory / "keypair.json")
        cls.uid = f"{os.getuid()}:{os.getgid()}"
        result = cls.run_wallet(
            "wallet import --keypair-file /home/solwallet/.config/sol-wallet/keypair.json",
            input_text="y\ncorrect horse battery staple\ncorrect horse battery staple\n",
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.directory, ignore_errors=True)

    @classmethod
    def run_wallet(cls, command, input_text=None, json_output=False):
        args = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--network",
            "host",
            "--user",
            cls.uid,
            "-e",
            "SOL_WALLET_CONFIG_DIR=/home/solwallet/.config/sol-wallet",
            "-e",
            "SOL_WALLET_CLUSTER=devnet",
            "-e",
            f"SOL_WALLET_RPC_URL=http://127.0.0.1:{cls.port}",
            "-v",
            f"{cls.directory}:/home/solwallet/.config/sol-wallet",
            IMAGE,
            "-c",
            command,
        ]
        if json_output:
            args.append("--json")
        return subprocess.run(
            args, input=input_text, text=True, capture_output=True, timeout=30
        )

    def test_address_persists_and_json_mode_works(self):
        result = self.run_wallet("address", json_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["address"], "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"
        )
        self.assertNotIn("correct horse", result.stdout + result.stderr)

    def test_read_only_rpc_path(self):
        balance = self.run_wallet("balance", json_output=True)
        self.assertEqual(balance.returncode, 0, balance.stderr)
        self.assertEqual(json.loads(balance.stdout)["lamports"], "10000000000")
        tokens = self.run_wallet("token list", json_output=True)
        self.assertEqual(tokens.returncode, 0, tokens.stderr)
        self.assertEqual(json.loads(tokens.stdout)["accounts"], [])

    def test_dry_run_simulates_without_broadcast(self):
        Handler.state.methods.clear()
        destination = "11111111111111111111111111111112"
        result = self.run_wallet(f"send {destination} 1 --dry-run", json_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "simulated")
        self.assertIn("preflight", payload)
        self.assertIn("simulateTransaction", Handler.state.methods)
        self.assertNotIn("sendTransaction", Handler.state.methods)

    def test_simulation_failure_blocks_broadcast(self):
        Handler.state.methods.clear()
        Handler.state.fail_simulation = True
        try:
            result = self.run_wallet(
                "send 11111111111111111111111111111112 1 --dry-run", json_output=True
            )
            self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
            self.assertNotIn("sendTransaction", Handler.state.methods)
        finally:
            Handler.state.fail_simulation = False

    def test_signer_unlock_is_inside_packaged_image(self):
        result = self.run_wallet(
            "send 11111111111111111111111111111112 1 --yes",
            input_text="correct horse battery staple\n",
            json_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("correct horse", result.stdout + result.stderr)

    def test_show_config_json_reports_the_fixture_endpoint(self):
        result = self.run_wallet("show config", json_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["cluster"], "devnet")
        self.assertEqual(payload["rpcUrl"], f"http://127.0.0.1:{self.port}")

    def test_lend_mainnet_guard_is_present_in_the_runtime_image(self):
        result = self.run_wallet("lend status", json_output=True)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        error = json.loads(result.stderr)
        self.assertIn("mainnet-beta", error["message"])
