"""Create disposable Solana keypair input files for image E2E tests."""

import json
import os
from pathlib import Path
import subprocess


_NODE_KEYGEN = r"""
const { generateKeyPairSync } = require('node:crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const address = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
process.stdout.write(JSON.stringify([...seed, ...address]));
"""


def write_keypair(path: Path) -> None:
    """Write a new 0600 Solana JSON keypair file without logging its contents."""
    result = subprocess.run(
        ["node", "--input-type=commonjs", "-e", _NODE_KEYGEN],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    keypair = json.loads(result.stdout)
    if (
        not isinstance(keypair, list)
        or len(keypair) != 64
        or any(type(byte) is not int or not 0 <= byte <= 255 for byte in keypair)
    ):
        raise ValueError("Node produced an invalid Solana keypair.")

    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as key_file:
        json.dump(keypair, key_file)
