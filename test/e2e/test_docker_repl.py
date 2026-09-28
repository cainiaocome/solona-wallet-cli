import os
import json
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
            self.assertNotRegex(child.before, r"\x1b\[[0-9;]*m")
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

    def test_color_is_enabled_in_tty_and_no_color_can_be_disabled(self):
        try:
            import pexpect
        except ImportError:
            self.skipTest("pexpect is required for PTY E2E")
        server = start_server()
        port = server.server_address[1]
        directory = Path(tempfile.mkdtemp(prefix="sol-wallet-color-"))
        child = self.spawn(pexpect, directory, port, no_color=False)
        try:
            child.expect(r"\x1b\[1;36mSolana Wallet CLI\x1b\[0m")
            child.expect(r"\x1b\[36mdevnet\x1b\[0m")
            child.sendline("help")
            child.expect("wallet list")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
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
        Handler.state.methods.clear()
        Handler.state.transactions.clear()
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
            registry = json.loads((directory / "wallets.json").read_text())
            vault_id = next(
                wallet["id"]
                for wallet in registry["wallets"]
                if wallet["alias"] == "secondary"
            )
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
            child.expect(r"Wallet\s*: vault")
            child.expect("Send 1 SOL from vault")
            child.sendline("y")
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Waiting for transaction confirmation")
            child.expect("SOL transfer confirmed")
            child.expect(r"Explorer\s*: https://explorer.solana.com/tx/")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            child.sendline(
                "token send 11111111111111111111111111111114 "
                "11111111111111111111111111111118 1 --yes"
            )
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Token transfer confirmed")
            child.expect(r"Explorer\s*: https://explorer.solana.com/tx/")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            child.sendline(
                "stake create 1 --validator " "11111111111111111111111111111116 --yes"
            )
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Stake delegation confirmed")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            # Passphrase rotation is local-only. The UUID/address remain stable,
            # the old phrase stops unlocking this keystore, and the new one signs.
            methods_before_rotation = len(Handler.state.methods)
            child.sendline("wallet change-passphrase vault")
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("New passphrase for vault:")
            child.sendline("rotated wallet passphrase")
            child.expect("Confirm new passphrase:")
            child.sendline("rotated wallet passphrase")
            child.expect("Passphrase changed for wallet 'vault'")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")
            self.assertEqual(len(Handler.state.methods), methods_before_rotation)

            child.sendline("send 11111111111111111111111111111112 1 --yes")
            child.expect("Passphrase for vault")
            child.sendline("secondary test passphrase")
            child.expect("Unable to unlock keystore")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")
            self.assertEqual(len(Handler.state.transactions), 3)

            child.sendline("send 11111111111111111111111111111112 1 --yes")
            child.expect("Passphrase for vault")
            child.sendline("rotated wallet passphrase")
            child.expect("SOL transfer confirmed")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            methods_before_cancelled_delete = len(Handler.state.methods)
            child.sendline("wallet delete vault")
            child.expect("Delete local wallet 'vault'")
            child.sendline("n")
            child.expect("Wallet deletion cancelled.")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")
            self.assertEqual(
                len(Handler.state.methods), methods_before_cancelled_delete
            )

            # A saved default cannot be removed while another wallet remains.
            child.sendline("wallet delete primary --yes")
            child.expect("is the saved default")
            child.expect(r"sol-wallet \[devnet \| vault \| [^]]+\]>")

            # Delete the current wallet by explicit automation consent. This is
            # local-only and leaves the chain stake hint intact for recovery.
            methods_before_delete = len(Handler.state.methods)
            child.sendline("wallet delete vault --yes")
            child.expect("Wallet 'vault' removed from this local wallet store")
            child.expect(r"sol-wallet \[devnet \| no-wallet\]>")
            self.assertEqual(len(Handler.state.methods), methods_before_delete)
            child.sendline("wallet list")
            child.expect("primary")
            child.expect(r"sol-wallet \[devnet \| no-wallet\]>")

            child.send("stake ")
            child.send("\t\t")
            child.expect("create")
            child.send("\x15")
            child.sendline("exit")
            child.expect(pexpect.EOF)
            child.close()
            self.assertEqual(child.exitstatus, 0)
            self.assertEqual(len(Handler.state.transactions), 4)
            for encoded_transaction in Handler.state.transactions:
                assert_transaction_signed_by(encoded_transaction, secondary_address)
            final_registry = json.loads((directory / "wallets.json").read_text())
            self.assertEqual(
                [wallet["alias"] for wallet in final_registry["wallets"]],
                ["primary"],
            )
            self.assertEqual(
                final_registry["defaultWalletId"], final_registry["wallets"][0]["id"]
            )
            self.assertFalse((directory / "wallets" / f"{vault_id}.json").exists())
            self.assertTrue(
                (directory / "stake-accounts" / vault_id / "devnet.json").exists()
            )
            history = (directory / "history").read_text()
            self.assertNotIn("secondary test passphrase", history)
            self.assertNotIn("rotated wallet passphrase", history)
        finally:
            if child.isalive():
                child.close(force=True)
        server.shutdown()
        shutil.rmtree(directory, ignore_errors=True)

    @staticmethod
    def spawn(pexpect, directory, port, no_color=True):
        args = [
            "docker",
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
            "-e",
            "TERM=xterm-256color",
        ]
        if no_color:
            args.extend(["-e", "NO_COLOR=1"])
        args.extend(
            [
                "-v",
                f"{directory}:/home/solwallet/.config/sol-wallet",
                IMAGE,
            ]
        )
        return pexpect.spawn(
            args[0],
            args[1:],
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
