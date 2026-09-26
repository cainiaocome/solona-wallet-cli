"""Deterministic Solana-shaped JSON-RPC fixture for Docker E2E.

This is deliberately a small transport fixture, not a fake production branch.
It records requests so tests can assert that dry-run and simulation failures do
not call sendTransaction.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading


def base58(data: bytes) -> str:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = int.from_bytes(data, "big")
    result = ""
    while number:
        number, remainder = divmod(number, 58)
        result = alphabet[remainder] + result
    return alphabet[0] * (len(data) - len(data.lstrip(b"\0"))) + (result or alphabet[0])


TEST_SIGNATURE = base58(bytes(range(1, 65)))
TEST_MINT = "11111111111111111111111111111114"
TEST_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TEST_TOKEN_ACCOUNT = "11111111111111111111111111111115"
TEST_VOTE_ACCOUNT = "11111111111111111111111111111116"


class State:
    fail_simulation = False
    methods: list[str] = []
    transactions: list[str] = []
    token_owner: str | None = None


class Handler(BaseHTTPRequestHandler):
    state = State

    def log_message(self, *_args):
        return

    def do_POST(self):
        size = int(self.headers.get("content-length", "0"))
        request = json.loads(self.rfile.read(size))
        method = request.get("method")
        self.state.methods.append(method)
        params = request.get("params", [])
        if method == "getBalance":
            result = {"context": {"slot": 100}, "value": 10_000_000_000}
        elif method == "getGenesisHash":
            result = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC"
        elif method == "getTokenAccountsByOwner":
            owner = params[0]
            result = {
                "context": {"slot": 100},
                "value": (
                    [
                        {
                            "pubkey": TEST_TOKEN_ACCOUNT,
                            "account": {
                                "data": {
                                    "program": "spl-token",
                                    "parsed": {
                                        "type": "account",
                                        "info": {
                                            "mint": TEST_MINT,
                                            "owner": owner,
                                            "state": "initialized",
                                            "tokenAmount": {
                                                "amount": "5000000",
                                                "decimals": 6,
                                                "uiAmount": 5,
                                                "uiAmountString": "5",
                                            },
                                        },
                                    },
                                    "space": 165,
                                },
                                "executable": False,
                                "lamports": 2_039_280,
                                "owner": TEST_TOKEN_PROGRAM,
                                "rentEpoch": 0,
                            },
                        }
                    ]
                    if owner == self.state.token_owner
                    else []
                ),
            }
        elif method == "getAccountInfo":
            account = params[0]
            result = {
                "context": {"slot": 100},
                "value": (
                    {
                        "data": {
                            "program": "spl-token",
                            "parsed": {
                                "type": "mint",
                                "info": {"decimals": 6, "supply": "1000000"},
                            },
                            "space": 82,
                        },
                        "executable": False,
                        "lamports": 1,
                        "owner": TEST_TOKEN_PROGRAM,
                        "rentEpoch": 0,
                    }
                    if account == TEST_MINT
                    else None
                ),
            }
        elif method == "getVoteAccounts":
            result = {
                "current": [
                    {
                        "votePubkey": TEST_VOTE_ACCOUNT,
                        "nodePubkey": "11111111111111111111111111111117",
                        "commission": 5,
                        "activatedStake": 1_000_000,
                        "lastVote": 100,
                        "rootSlot": 100,
                    }
                ],
                "delinquent": [],
            }
        elif method == "getProgramAccounts":
            result = []
        elif method == "getStakeMinimumDelegation":
            result = {"value": 1}
        elif method == "getMinimumBalanceForRentExemption":
            result = 2_039_280
        elif method == "getLatestBlockhash":
            result = {
                "context": {"slot": 100},
                "value": {
                    "blockhash": "11111111111111111111111111111111",
                    "lastValidBlockHeight": 200,
                },
            }
        elif method == "getFeeForMessage":
            result = {"context": {"slot": 100}, "value": 5000}
        elif method == "getBlockHeight":
            result = 150
        elif method == "simulateTransaction":
            result = {
                "context": {"apiVersion": "fixture", "slot": 100},
                "value": {
                    "err": (
                        {"InstructionError": [0, "Custom"]}
                        if self.state.fail_simulation
                        else None
                    ),
                    "logs": ["fixture simulation"],
                    "fee": 5000,
                    "loadedAccountsDataSize": 0,
                    "loadedAddresses": None,
                    "postBalances": None,
                    "postTokenBalances": None,
                    "preBalances": None,
                    "preTokenBalances": None,
                    "replacementBlockhash": None,
                },
            }
        elif method == "sendTransaction":
            self.state.transactions.append(params[0])
            result = TEST_SIGNATURE
        elif method == "getSignatureStatuses":
            result = {
                "context": {"slot": 101},
                "value": [
                    {
                        "confirmationStatus": "confirmed",
                        "confirmations": 1,
                        "err": None,
                        "slot": 101,
                        "status": {"Ok": None},
                    }
                ],
            }
        elif method == "getTransaction":
            result = None
        else:
            result = None
        response = {"jsonrpc": "2.0", "id": request.get("id"), "result": result}
        encoded = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def start_server(port: int = 0):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
