import json, os, socket, uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = os.environ.get("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "")
_REMOTE_PROTOCOL_VERSION = 1
RUNTIME_ID = "runtime-fixture-" + socket.gethostname()
INSTANCE_ID = "instance-" + str(uuid.uuid4())
class Handler(BaseHTTPRequestHandler):
    def _reply(self, status, body):
        raw=json.dumps(body).encode()
        self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_POST(self):
        if self.headers.get("X-OpenDrSai-Gateway-Token") != TOKEN:
            return self._reply(401, {"error":"unauthorized"})
        length=int(self.headers.get("Content-Length","0")); body=json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/v1/remote/handshake":
            return self._reply(200, {"runtime_id":RUNTIME_ID,"instance_id":INSTANCE_ID,"protocol_version":1,"gateway_version":"fixture","platform":"linux","workspace_path":body.get("workspace_path"),"capabilities":["threads","chat","files","file-watch","git","approvals","hepai-worker","pty"],"capability_versions":{"threads":1,"chat":1,"files":2,"file-watch":2,"git":1,"approvals":1,"hepai-worker":1,"pty":2}})
        if self.path == "/v1/workspaces/open":
            return self._reply(200, {"workspace_id":body.get("workspace_id"),"path":body.get("path")})
        return self._reply(404, {"error":"not found"})
    def do_GET(self):
        if self.headers.get("X-OpenDrSai-Gateway-Token") != TOKEN:
            return self._reply(401, {"error":"unauthorized"})
        if self.path == "/v1/runtime":
            return self._reply(200, {"runtime_id":RUNTIME_ID,"instance_id":INSTANCE_ID,"version":"fixture","protocol_version":1,"platform":"linux"})
        if self.path.startswith("/v1/threads"):
            return self._reply(200, {"object":"list","data":[],"total":0})
        parsed=urlparse(self.path); query=parse_qs(parsed.query)
        if parsed.path.endswith("/files"):
            return self._reply(200, {"data":[{"name":"remote.txt","path":"remote.txt","directory":False}]})
        if parsed.path.endswith("/file") and query.get("path") == ["remote.txt"]:
            content=Path("remote.txt").read_text()
            return self._reply(200, {"path":"remote.txt","content":content,"truncated":False,"size":len(content.encode())})
        if parsed.path == "/v1/hepai/workers":
            return self._reply(200, {"data":[{"id":"fixture-worker","name":"Fixture Worker","enabled":True}]})
        return self._reply(404, {"error":"not found"})
    def log_message(self, *_args): pass

def main():
    ThreadingHTTPServer((os.environ.get("DRSAI_API_HOST","127.0.0.1"),int(os.environ.get("DRSAI_API_PORT","18642"))),Handler).serve_forever()
if __name__ == "__main__": main()
