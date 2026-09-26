import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from mock_rpc import Handler, start_server
from keypair import write_keypair


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
        write_keypair(cls.directory / "keypair-secondary.json")
        cls.uid = f"{os.getuid()}:{os.getgid()}"
        exit_code, output = cls.run_interactive_wallet(
            "wallet import primary --keypair-file /home/solwallet/.config/sol-wallet/keypair.json",
            "correct horse battery staple",
        )
        if exit_code != 0:
            raise AssertionError(output)
        exit_code, output = cls.run_interactive_wallet(
            "wallet import secondary --keypair-file /home/solwallet/.config/sol-wallet/keypair-secondary.json",
            "secondary test passphrase",
        )
        if exit_code != 0:
            raise AssertionError(output)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.directory, ignore_errors=True)

    @classmethod
    def run_wallet(
        cls,
        command,
        input_text=None,
        json_output=False,
        startup_wallet=None,
        directory=None,
    ):
        config_directory = directory or cls.directory
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
            f"{config_directory}:/home/solwallet/.config/sol-wallet",
            IMAGE,
            *(["--wallet", startup_wallet] if startup_wallet else []),
            "-c",
            command,
        ]
        if json_output:
            args.append("--json")
        return subprocess.run(
            args, input=input_text, text=True, capture_output=True, timeout=30
        )

    @classmethod
    def run_interactive_wallet(
        cls,
        command,
        passphrase,
        directory=None,
        passphrase_prompt="New keystore passphrase:",
        json_output=False,
    ):
        import pexpect

        config_directory = directory or cls.directory
        args = [
            "run",
            "--rm",
            "-it",
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
            f"{config_directory}:/home/solwallet/.config/sol-wallet",
            IMAGE,
            "-c",
            command,
        ]
        if json_output:
            args.append("--json")
        child = pexpect.spawn("docker", args, encoding="utf-8", timeout=30)
        if command.startswith("wallet import"):
            child.expect("Is this the expected wallet address?")
            child.sendline("y")
            child.expect("New keystore passphrase:")
            child.sendline(passphrase)
            child.expect("Confirm passphrase:")
        else:
            child.expect(passphrase_prompt)
        child.sendline(passphrase)
        child.expect(pexpect.EOF)
        output = child.before
        child.close()
        return child.exitstatus, output

    def test_address_persists_and_json_mode_works(self):
        result = self.run_wallet("address", json_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["address"], "FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF"
        )
        self.assertEqual(payload["wallet"]["alias"], "primary")
        self.assertNotIn("correct horse", result.stdout + result.stderr)

    def test_startup_wallet_override_does_not_change_saved_default(self):
        result = self.run_wallet("status", json_output=True, startup_wallet="secondary")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["wallet"]["alias"], "secondary")
        self.assertEqual(payload["defaultWallet"]["alias"], "primary")

    def test_invalid_startup_wallet_fails_without_rpc_fallback(self):
        Handler.state.methods.clear()
        result = self.run_wallet(
            "status", json_output=True, startup_wallet="missing-wallet"
        )
        self.assertEqual(result.returncode, 2)
        error_start = result.stderr.find("{")
        self.assertGreaterEqual(error_start, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stderr[error_start:])["error"], "WalletNotFound"
        )
        self.assertNotIn("getGenesisHash", Handler.state.methods)

    def test_legacy_keystore_migrates_and_is_preserved(self):
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-migrate-"))
        try:
            fixture = Path(__file__).parents[1] / "fixtures" / "disposable-keypair.json"
            shutil.copyfile(fixture, directory / "keypair.json")
            exit_code, output = self.run_interactive_wallet(
                "wallet import source --keypair-file /home/solwallet/.config/sol-wallet/keypair.json",
                "legacy test passphrase",
                directory=directory,
            )
            self.assertEqual(exit_code, 0, output)
            generated = next((directory / "wallets").glob("*.json"))
            encrypted = generated.read_bytes()
            (directory / "keystore.json").write_bytes(encrypted)
            (directory / "keystore.json").chmod(0o600)
            (directory / "wallets.json").unlink()
            shutil.rmtree(directory / "wallets")

            exit_code, output = self.run_interactive_wallet(
                "wallet migrate migrated",
                "legacy test passphrase",
                directory=directory,
                passphrase_prompt="Passphrase for migrated",
            )
            self.assertEqual(exit_code, 0, output)
            self.assertEqual(len(list((directory / "wallets").glob("*.json"))), 1)
            self.assertEqual(
                next((directory / "wallets").glob("*.json")).read_bytes(), encrypted
            )
            self.assertEqual((directory / "keystore.json").read_bytes(), encrypted)
            status = self.run_wallet("status", json_output=True, directory=directory)
            self.assertEqual(status.returncode, 0, status.stderr)
            self.assertEqual(json.loads(status.stdout)["wallet"]["alias"], "migrated")
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def test_private_key_passphrases_require_a_tty(self):
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-no-pipe-secret-"))
        try:
            fixture = Path(__file__).parents[1] / "fixtures" / "disposable-keypair.json"
            shutil.copyfile(fixture, directory / "keypair.json")
            result = self.run_wallet(
                "wallet import piped --keypair-file /home/solwallet/.config/sol-wallet/keypair.json",
                input_text="y\nnot-a-real-secret\nnot-a-real-secret\n",
                directory=directory,
            )
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("interactive terminal", result.stderr)
            self.assertFalse((directory / "wallets.json").exists())
        finally:
            shutil.rmtree(directory, ignore_errors=True)

    def test_read_only_rpc_path(self):
        balance = self.run_wallet("balance", json_output=True)
        self.assertEqual(balance.returncode, 0, balance.stderr)
        self.assertEqual(json.loads(balance.stdout)["lamports"], "10000000000")
        self.assertEqual(json.loads(balance.stdout)["wallet"]["alias"], "primary")
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
        exit_code, output = self.run_interactive_wallet(
            "send 11111111111111111111111111111112 1 --yes",
            "correct horse battery staple",
            passphrase_prompt="Passphrase for primary",
            json_output=True,
        )
        self.assertEqual(exit_code, 0, output)
        self.assertNotIn("correct horse", output)

    def test_show_config_json_reports_the_fixture_endpoint(self):
        result = self.run_wallet("show config", json_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["cluster"], "devnet")
        self.assertEqual(payload["rpcUrl"], f"http://127.0.0.1:{self.port}")

    def test_lend_mainnet_guard_is_present_in_the_runtime_image(self):
        result = self.run_wallet("jupiter-lend status")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("mainnet", result.stderr)
