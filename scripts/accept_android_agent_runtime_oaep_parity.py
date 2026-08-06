from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "cores/protocol/oaep/examples.json"
MANIFEST = ROOT / "cores/protocol/oaep/parity-v1.json"
OUTPUT = ROOT / "docs/android/reports/evidence/android-agent-runtime-oaep-parity.json"


def digest(value: object) -> str:
    canonical = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def main() -> int:
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    snapshot = {key: value for key, value in document.items() if key != "events"}
    observed = {
        "snapshot_sha256": digest(snapshot),
        "events_sha256": digest(document["events"]),
        "document_sha256": digest(document),
    }
    if any(manifest.get(key) != value for key, value in observed.items()):
        raise RuntimeError("oaep_cross_runtime_parity_mismatch")
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "fixture": str(FIXTURE.relative_to(ROOT)).replace("\\", "/"),
        "canonicalization": manifest["canonicalization"],
        "python_desktop": observed,
        "android_expected": observed,
        "event_count": len(document["events"]),
        "item_count": len(document["items"]),
        "passed": True,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
