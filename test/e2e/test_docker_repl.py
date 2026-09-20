import os
from pathlib import Path
import shutil
import tempfile
import unittest

from mock_rpc import start_server

IMAGE = os.environ.get("SOL_WALLET_E2E_IMAGE")


@unittest.skipUnless(
    IMAGE and shutil.which("docker"),
    "set SOL_WALLET_E2E_IMAGE and install Docker to run image E2E",
)
class DockerReplTests(unittest.TestCase):
    def test_shell_and_real_tty_completion(self):
        try:
            import pexpect
        except ImportError:
            self.skipTest("pexpect is required for PTY E2E")
        server = start_server()
        port = server.server_address[1]
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-repl-"))
        child = self.spawn(pexpect, directory, port)
        try:
            child.expect(r"sol-wallet \[devnet no-wallet\]>")
            child.send("tok\t")
            child.expect("token")
            child.send(" \t\t")
            child.expect("list")
            child.send("\x15")
            child.sendline("help")
            child.expect("wallet import")
            child.sendline("address")
            child.expect("No wallet is imported")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
            self.assertTrue((directory / "history").exists())

            second = self.spawn(pexpect, directory, port)
            try:
                second.expect(r"sol-wallet \[devnet no-wallet\]>")
                second.sendline("history")
                second.expect("help")
                second.sendline("password should not persist")
                second.expect("Unknown command")
                second.sendline("exit")
                second.expect(pexpect.EOF)
                second.close()
            finally:
                if second.isalive():
                    second.close(force=True)
            self.assertNotIn(
                "password should not persist", (directory / "history").read_text()
            )
        finally:
            if child.isalive():
                child.close(force=True)
            server.shutdown()
            shutil.rmtree(directory, ignore_errors=True)

    def test_import_signer_prompt_and_stake_completion_through_pty(self):
        try:
            import pexpect
        except ImportError:
            self.skipTest("pexpect is required for PTY E2E")
        server = start_server()
        port = server.server_address[1]
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-import-"))
        fixture = Path(__file__).parents[1] / "fixtures" / "disposable-keypair.json"
        shutil.copyfile(fixture, directory / "keypair.json")
        child = self.spawn(pexpect, directory, port)
        passphrase = "correct horse battery staple"
        try:
            child.expect(r"sol-wallet \[devnet no-wallet\]>")
            child.sendline(
                "wallet import --keypair-file "
                "/home/solwallet/.config/sol-wallet/keypair.json"
            )
            child.expect("Derived address:")
            child.sendline("y")
            child.expect("New keystore passphrase:")
            child.sendline(passphrase)
            child.expect("Confirm passphrase:")
            child.sendline(passphrase)
            child.expect("Wallet imported")
            child.expect(r"sol-wallet \[devnet [^]]+\]>")

            keystore = (directory / "keystore.json").read_text()
            self.assertNotIn(passphrase, keystore)
            self.assertNotIn((directory / "keypair.json").read_text(), keystore)

            child.sendline("send 11111111111111111111111111111112 1 --yes")
            child.expect("Keystore passphrase:")
            child.sendline(passphrase)
            child.expect("Transaction confirmed")
            child.expect(r"sol-wallet \[devnet [^]]+\]>")

            child.send("stake ")
            child.send("\t")
            child.expect("create")
            child.send("\x15")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
        finally:
            if child.isalive():
                child.close(force=True)
            server.shutdown()
            shutil.rmtree(directory, ignore_errors=True)

    @staticmethod
    def spawn(pexpect, directory, port):
        return pexpect.spawn(
            "docker",
            [
                "run",
                "--rm",
                "-it",
                "--network",
                "host",
                "--user",
                f"{os.getuid()}:{os.getgid()}",
                "-e",
                "SOL_WALLET_CONFIG_DIR=/home/solwallet/.config/sol-wallet",
                "-e",
                "SOL_WALLET_CLUSTER=devnet",
                "-e",
                f"SOL_WALLET_RPC_URL=http://127.0.0.1:{port}",
                "-v",
                f"{directory}:/home/solwallet/.config/sol-wallet",
                IMAGE,
            ],
            encoding="utf-8",
            timeout=20,
        )
