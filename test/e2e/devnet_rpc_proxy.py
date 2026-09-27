"""A method-only recording proxy for real Devnet RPC requests.

Request bodies can contain signed transactions, so the proxy deliberately
keeps only JSON-RPC method names and response status codes in memory.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class DevnetRpcProxy(ThreadingHTTPServer):
    def __init__(self, upstream_url):
        super().__init__(("127.0.0.1", 0), Handler)
        self.upstream_url = upstream_url
        self.records = []
        self.records_lock = threading.Lock()
        self.server_thread = None

    def __enter__(self):
        self.server_thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.server_thread.start()
        return self

    def __exit__(self, *_args):
        self.shutdown()
        self.server_close()
        if self.server_thread:
            self.server_thread.join(timeout=5)

    def snapshot(self):
        with self.records_lock:
            return list(self.records)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_POST(self):
        size = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(size)
        method_names = []
        try:
            payload = json.loads(body)
            requests = payload if isinstance(payload, list) else [payload]
            method_names = [
                item["method"]
                for item in requests
                if isinstance(item, dict) and isinstance(item.get("method"), str)
            ]
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass

        request = Request(
            self.server.upstream_url,
            data=body,
            headers={
                "Content-Type": self.headers.get("content-type", "application/json")
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=60) as response:
                status = response.status
                response_body = response.read()
                response_type = response.headers.get("content-type", "application/json")
        except HTTPError as error:
            status = error.code
            response_body = error.read()
            response_type = error.headers.get("content-type", "application/json")
        except (TimeoutError, URLError, OSError):
            status = 502
            response_body = b'{"error":"Devnet RPC upstream unavailable"}'
            response_type = "application/json"

        with self.server.records_lock:
            self.server.records.extend(
                {"method": name, "status": status} for name in method_names
            )
        self.send_response(status)
        self.send_header("Content-Type", response_type)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)
