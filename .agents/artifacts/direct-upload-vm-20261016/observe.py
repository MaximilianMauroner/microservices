import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time

state = Path(sys.argv[1])
control = state / "proxy-control.json"
lock = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.forward()

    do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

    def forward(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        route = re.sub(r"/sessions/[0-9a-f-]+", "/sessions/:id", self.path)
        route = re.sub(r"/(artifacts|files)/[^/?]+", r"/\1/:id", route)
        route = route.split("?")[0]
        with lock:
            with (state / "requests.jsonl").open("a") as log:
                log.write(json.dumps({"method": self.command, "route": route, "bytes": len(body),
                                      "sha256": hashlib.sha256(body).hexdigest(),
                                      "hasTransferEncoding": "Transfer-Encoding" in self.headers,
                                      "hasFixtureBody": b"DIRECT-UPLOAD-VM-BODY" in body}) + "\n")
            fault = json.loads(control.read_text()) if control.exists() else {}
            action = "init" if self.path == "/api/uploads/sessions" else "complete" if self.path.endswith("/complete") else "parts" if self.path.endswith("/parts") else None
            selected = fault.get("action") == action
            if selected:
                control.write_text("{}")
        if selected and fault.get("mode") == "hold":
            with (state / "faults.jsonl").open("a") as log:
                log.write(json.dumps({"action": action, "mode": "hold", "forwarded": False}) + "\n")
            (state / "proxy-held").write_text("ready")
            while not (state / "proxy-release").exists():
                time.sleep(0.05)
            self.close_connection = True
            return
        connection = http.client.HTTPConnection("127.0.0.1", 43173, timeout=120)
        try:
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in {"connection", "transfer-encoding"}}
            headers["Host"] = "127.0.0.1:43171"
            connection.request(self.command, self.path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
            if selected:
                with (state / "faults.jsonl").open("a") as log:
                    log.write(json.dumps({"action": action, "mode": fault["mode"], "forwarded": True,
                                          "status": response.status}) + "\n")
            if selected and fault.get("mode") == "commit-hold":
                (state / "committed-result.json").write_bytes(payload)
                (state / "committed-held").write_text("ready")
                while not (state / "committed-release").exists():
                    time.sleep(0.05)
                self.close_connection = True
                return
            if selected and fault.get("mode") == "mutate":
                source = Path(fault["source"])
                source.write_bytes(source.read_bytes().replace(b"original", b"mutated!", 1))
            if selected and fault.get("mode") == "drop":
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {"connection", "transfer-encoding", "content-length"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", response.getheader("Content-Length", "0") if self.command == "HEAD" else str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()


server = http.server.ThreadingHTTPServer(("127.0.0.1", 43171), Handler)
(state / "proxy.pid").write_text(str(os.getpid()))
server.serve_forever()
