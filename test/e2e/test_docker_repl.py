import os
import subprocess
from pathlib import Path
import shutil
import tempfile
import unittest

from mock_rpc import Handler, start_server
from keypair import write_keypair

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
            child.expect(r"sol-wallet \[devnet \| no-wallet\]>")
            child.send("tok\t")
            child.expect("token")
            child.send(" \t\t")
            child.expect("list")
            child.send("\x15")
            child.sendline("help")
            child.expect("wallet import")
            child.sendline("address")
            child.expect("No wallet is selected")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
            self.assertTrue((directory / "history").exists())

            second = self.spawn(pexpect, directory, port)
            try:
                second.expect(r"sol-wallet \[devnet \| no-wallet\]>")
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
        secondary_address = write_keypair(directory / "keypair-secondary.json")
        Handler.state.token_owner = secondary_address
        child = self.spawn(pexpect, directory, port)
        passphrase = "correct horse battery staple"
        try:
            child.expect(r"sol-wallet \[devnet \| no-wallet\]>")
            child.sendline(
                "wallet import primary --keypair-file "
                "/home/solwallet/.config/sol-wallet/keypair.json"
            )
            child.expect("Derived address for 'primary':")
            child.sendline("y")
            child.expect("New keystore passphrase:")
            child.sendline(passphrase)
            child.expect("Confirm passphrase:")
            child.sendline(passphrase)
            child.expect("Wallet 'primary' imported")
            child.expect(r"sol-wallet \[devnet \| primary \| [^]]+\]>")

            keystore = next((directory / "wallets").glob("*.json")).read_text()
            self.assertNotIn(passphrase, keystore)
            self.assertNotIn((directory / "keypair.json").read_text(), keystore)

            child.sendline(
                "wallet import secondary --keypair-file "
                "/home/solwallet/.config/sol-wallet/keypair-secondary.json"
            )
            child.expect("Derived address for 'secondary':")
            child.sendline("y")
            child.expect("New keystore passphrase:")
            child.sendline("secondary test passphrase")
            child.expect("Confirm passphrase:")
            child.sendline("secondary test passphrase")
            child.expect("Wallet 'secondary' imported")
            for wallet_file in (directory / "wallets").glob("*.json"):
                self.assertNotIn("secondary test passphrase", wallet_file.read_text())
            child.sendline("wallet list")
            child.expect("primary")
            child.expect("secondary")
            child.sendline("wallet rename secondary vault")
            child.expect("Wallet renamed: secondary → vault")
            child.sendline("wallet use vault")
            child.expect("Current wallet: vault")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            Handler.state.transactions.clear()
            child.sendline("send 11111111111111111111111111111112 1")
            child.expect("Wallet: vault")
            child.expect("Send 1 SOL from vault")
            child.sendline("y")
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Waiting for transaction confirmation")
            child.expect("SOL transfer confirmed")
            child.expect("Explorer: https://explorer.solana.com/tx/")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            child.sendline(
                "token send 11111111111111111111111111111114 "
                "11111111111111111111111111111118 1 --yes"
            )
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Token transfer confirmed")
            child.expect("Explorer: https://explorer.solana.com/tx/")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            child.sendline(
                "stake create 1 --validator " "11111111111111111111111111111116 --yes"
            )
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Stake delegation confirmed")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            child.send("stake ")
            child.send("\t\t")
            child.expect("create")
            child.send("\x15")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
            self.assertEqual(len(Handler.state.transactions), 3)
            for encoded_transaction in Handler.state.transactions:
                assert_transaction_signed_by(encoded_transaction, secondary_address)
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


def assert_transaction_signed_by(encoded_transaction, expected_address):
    """Verify wallet B is the fee payer and signed the submitted transaction."""
    verifier = r"""
const crypto = require('node:crypto');
const { VersionedTransaction } = require('@solana/web3.js');
const transaction = VersionedTransaction.deserialize(
  Buffer.from(process.argv[2], 'base64'),
);
const feePayer = transaction.message.staticAccountKeys[0];
if (!feePayer || feePayer.toBase58() !== process.argv[1]) process.exit(2);
const prefix = Buffer.from('302a300506032b6570032100', 'hex');
const key = crypto.createPublicKey({
  key: Buffer.concat([prefix, feePayer.toBytes()]),
  format: 'der',
  type: 'spki',
});
const valid = crypto.verify(
  null,
  transaction.message.serialize(),
  key,
  transaction.signatures[0],
);
if (!valid) process.exit(1);
"""
    result = subprocess.run(
        [
            "node",
            "--input-type=commonjs",
            "-e",
            verifier,
            expected_address,
            encoded_transaction,
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode:
        raise AssertionError("Submitted transaction was not signed by wallet B")
