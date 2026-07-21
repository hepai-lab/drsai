from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "protocol" / "codex-app-server-stable-contract.json"
ADAPTER = ROOT / "cores" / "python" / "packages" / "drsai" / "src" / "drsai" / "backend" / "codex_adapter"


def main() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert contract["experimentalApi"] is False
    sources = "\n".join(path.read_text(encoding="utf-8") for path in sorted(ADAPTER.glob("*.py")))
    missing = []
    for method, fields in contract["clientMethods"].items():
        if f'"{method}"' not in sources:
            missing.append(f"method:{method}")
        for field in fields:
            if f'"{field}"' not in sources:
                missing.append(f"field:{method}.{field}")
    for method in contract["serverRequests"]:
        if f'"{method}"' not in sources:
            missing.append(f"serverRequest:{method}")
    for method in contract["notifications"]:
        if f'"{method}"' not in sources:
            missing.append(f"notification:{method}")
    if missing:
        raise SystemExit("Codex stable contract drift: " + ", ".join(missing))
    initialize_block = sources[sources.index('"initialize"'):sources.index('"initialize"') + 300]
    if "experimentalApi" in initialize_block:
        raise SystemExit("Production initialize must not request experimentalApi")
    print("Codex App Server stable contract drift verification passed.")


if __name__ == "__main__":
    main()
