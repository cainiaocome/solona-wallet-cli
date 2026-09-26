# Test fixtures

`disposable-keypair.json` is a deterministic, publicly known Solana keypair used
only as a test fixture. It must never receive funds and is not a developer or
production wallet. Docker E2E tests generate an additional random keypair at
runtime inside their temporary directory rather than committing another key.
Never place real credentials or funded keys in this directory.
