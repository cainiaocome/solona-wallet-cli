"""Safety checks for the Devnet recording proxy used by live E2E runs."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from urllib.request import Request, urlopen
import unittest

from devnet_rpc_proxy import DevnetRpcProxy
from keypair import write_keypair


class UpstreamHandler(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_args):
        return

    def do_POST(self):
        size = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(size))
        type(self).requests.append(payload)
        response = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": {"ok": True},
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


class FaucetRateLimitHandler(BaseHTTPRequestHandler):
    methods = []

    def log_message(self, *_args):
        return

    def do_POST(self):
        size = int(self.headers.get("content-length", "0"))
        request = json.loads(self.rfile.read(size))
        method = request["method"]
        type(self).methods.append(method)
        if method == "requestAirdrop":
            status = 429
            result = {"error": {"code": 429, "message": "rate limited"}}
        else:
            status = 200
            values = {
                "getGenesisHash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
                "getStakeMinimumDelegation": {
                    "context": {"slot": 1},
                    "value": 1_000_000_000,
                },
                "getBalance": {"context": {"slot": 1}, "value": 0},
                "getMinimumBalanceForRentExemption": 1_666_240,
                "getLatestBlockhash": {
                    "context": {"slot": 1},
                    "value": {
                        "blockhash": "11111111111111111111111111111111",
                        "lastValidBlockHeight": 100,
                    },
                },
            }
            result = {"result": values[method]}
        body = json.dumps({"jsonrpc": "2.0", "id": request["id"], **result}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class DevnetProxyTests(unittest.TestCase):
    def test_proxy_forwards_body_but_only_retains_method_and_status(self):
        UpstreamHandler.requests = []
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), UpstreamHandler)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(upstream.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(upstream.shutdown)

        upstream_url = f"http://127.0.0.1:{upstream.server_port}"
        signed_transaction = "signed-payload-must-not-be-retained"
        request_body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 9,
                "method": "sendTransaction",
                "params": [signed_transaction],
            }
        ).encode()
        with DevnetRpcProxy(upstream_url) as proxy:
            request = Request(
                f"http://127.0.0.1:{proxy.server_port}",
                data=request_body,
                headers={"Content-Type": "application/json"},
            )
            with urlopen(request, timeout=5) as response:
                result = json.loads(response.read())
            self.assertEqual(result["result"], {"ok": True})
            self.assertEqual(
                proxy.snapshot(), [{"method": "sendTransaction", "status": 200}]
            )
        self.assertEqual(UpstreamHandler.requests[0]["params"], [signed_transaction])

    def test_airdrop_429_is_not_retried_by_the_fixture_runner(self):
        FaucetRateLimitHandler.methods = []
        faucet = ThreadingHTTPServer(("127.0.0.1", 0), FaucetRateLimitHandler)
        thread = threading.Thread(target=faucet.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(faucet.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(faucet.shutdown)

        with tempfile.TemporaryDirectory(prefix="sol-wallet-faucet-test-") as path:
            keypair_path = Path(path) / "keypair.json"
            write_keypair(keypair_path)
            environment = os.environ.copy()
            environment["SOL_WALLET_DEVNET_RPC_URL"] = (
                f"http://127.0.0.1:{faucet.server_port}"
            )
            result = subprocess.run(
                ["node", "test/e2e/devnet_fixtures.mjs", "fund", str(keypair_path)],
                capture_output=True,
                text=True,
                timeout=30,
                env=environment,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("HTTP 429; no retry was attempted", result.stderr)
        self.assertEqual(FaucetRateLimitHandler.methods.count("requestAirdrop"), 1)


if __name__ == "__main__":
    unittest.main()
