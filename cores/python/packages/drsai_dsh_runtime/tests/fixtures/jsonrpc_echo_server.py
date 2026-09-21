from __future__ import annotations

import json
import sys


print(f"workspace={sys.argv[1]}", file=sys.stderr, flush=True)
print(f"secret={sys.argv[2]}", file=sys.stderr, flush=True)
for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": {}}), flush=True)
        break
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": request.get("params")}), flush=True)

