from __future__ import annotations

import json
import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "cores" / "protocol" / "codex-app-server-stable-contract.json"
ADAPTER = ROOT / "cores" / "python" / "packages" / "drsai" / "src" / "drsai" / "backend" / "codex_adapter"


def main() -> None:
    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert contract["experimentalApi"] is False
    baseline = contract["generatedBaseline"]
    schema_root = ROOT / baseline["schemaPath"]
    bundle = schema_root / "codex_app_server_protocol.v2.schemas.json"
    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    if digest != baseline["v2BundleSha256"]:
        raise SystemExit(
            f"Codex schema digest drift for {baseline['codexVersion']}: {digest}"
        )
    thread_schema = json.loads((schema_root / "v2" / "ThreadReadResponse.json").read_text(encoding="utf-8"))
    variants = {
        str(value["properties"]["type"]["enum"][0])
        for value in thread_schema["definitions"]["ThreadItem"]["oneOf"]
    }
    declared_variants = set(contract["threadItemCoverage"])
    if variants != declared_variants:
        raise SystemExit(
            "Codex ThreadItem coverage drift: missing="
            + ",".join(sorted(variants - declared_variants))
            + " stale=" + ",".join(sorted(declared_variants - variants))
        )
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
    for native_type in sorted(declared_variants):
        if f'"{native_type}"' not in sources:
            missing.append(f"threadItem:{native_type}")
    if missing:
        raise SystemExit("Codex stable contract drift: " + ", ".join(missing))
    initialize_block = sources[sources.index('"initialize"'):sources.index('"initialize"') + 300]
    if "experimentalApi" in initialize_block:
        raise SystemExit("Production initialize must not request experimentalApi")
    print("Codex App Server stable contract drift verification passed.")


if __name__ == "__main__":
    main()
