import base64
import json
from urllib.request import Request, urlopen
import unittest

from mock_rpc import Handler, TEST_TOKEN_ACCOUNT, start_server


class MockRpcAccountEncodingTests(unittest.TestCase):
    def setUp(self):
        Handler.state.destination_token_account_exists = True
        Handler.state.account_info_requests.clear()
        self.server = start_server()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        Handler.state.destination_token_account_exists = False

    def request_account_info(self, options_marker):
        params = [TEST_TOKEN_ACCOUNT]
        if options_marker is not None:
            params.append(options_marker)
        request = Request(
            self.url,
            data=json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getAccountInfo",
                    "params": params,
                }
            ).encode(),
            headers={"content-type": "application/json"},
        )
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_large_account_requires_explicit_base64_encoding(self):
        omitted = self.request_account_info(None)
        self.assertEqual(omitted["error"]["code"], -32600)

        invalid = self.request_account_info({"encoding": "base58"})
        self.assertEqual(invalid["error"]["code"], -32600)

        encoded = self.request_account_info({"encoding": "base64"})
        self.assertNotIn("error", encoded)
        data, encoding = encoded["result"]["value"]["data"]
        self.assertEqual(encoding, "base64")
        self.assertEqual(len(base64.b64decode(data)), 165)


if __name__ == "__main__":
    unittest.main()
