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
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-repl-"))
        child = self.spawn(pexpect, directory)
        try:
            child.expect(r"sol-wallet \[devnet no-wallet\]>")
            child.send("tok\t")
            child.expect("token")
            child.send(" \t\t")
            child.expect("list")
            child.sendline("help")
            child.expect("wallet import")
            child.sendline("address")
            child.expect("No wallet is imported")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            self.assertEqual(child.exitstatus, 0)
            self.assertTrue((directory / "history").exists())

            second = self.spawn(pexpect, directory)
            try:
                second.expect(r"sol-wallet \[devnet no-wallet\]>")
                second.sendline("history")
                second.expect("help")
                second.sendline("password should not persist")
                second.expect("Unknown command")
                second.sendline("exit")
                second.expect(pexpect.EOF)
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

    @staticmethod
    def spawn(pexpect, directory):
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
                "SOL_WALLET_RPC_URL=http://127.0.0.1:8899",
                "-v",
                f"{directory}:/home/solwallet/.config/sol-wallet",
                IMAGE,
            ],
            encoding="utf-8",
            timeout=20,
        )
