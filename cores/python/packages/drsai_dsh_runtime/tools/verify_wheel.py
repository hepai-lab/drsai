from __future__ import annotations

import json
import sys
from pathlib import Path

from opendrsai_dsh_runtime.wheel_verify import verify_bridge_wheel


if len(sys.argv) != 2:
    raise SystemExit("usage: verify_wheel.py WHEEL")
print(json.dumps(verify_bridge_wheel(Path(sys.argv[1])), sort_keys=True))
