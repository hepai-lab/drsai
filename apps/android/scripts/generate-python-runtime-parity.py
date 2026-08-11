"""Execute the shared fixture through Desktop, TUI and Android Python adapters."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    source = repo / "cores/python/packages/drsai/src"
    runtime_root = source / "drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    sys.path[:0] = [str(source), str(runtime_root), str(android_python)]
    try:
        from drsai.backend.runtime.mobile_adapter import DesktopMobileCoreAdapter, TuiMobileCoreAdapter
        from drsai.backend.runtime.mobile_core import RuntimeEnvelope

        probe = importlib.import_module("runtime_probe")
        fixture_path = repo / "cores/protocol/android-runtime/fixtures/mobile-core-parity-v1.json"
        fixture_data = fixture_path.read_bytes()
        fixture = json.loads(fixture_data)

        def normalize(values):
            rows = [item.to_dict() if isinstance(item, RuntimeEnvelope) else item for item in values]
            return [item["payload"] for item in rows if item["message_type"] == "runtime_event"]

        scenarios = []
        for scenario in fixture["scenarios"]:
            commands = [RuntimeEnvelope.from_dict(value) for value in scenario["commands"]]
            desktop = normalize(DesktopMobileCoreAdapter().execute_many(commands))
            tui = normalize(TuiMobileCoreAdapter().execute_many(commands))
            probe.reset()
            android_outbound = []
            for value in scenario["commands"]:
                android_outbound.extend(json.loads(probe.execute(json.dumps(value)))["outbound"])
            android = normalize(android_outbound)
            equal = desktop == tui == android
            scenarios.append({
                "id": scenario["id"], "expected_event_kinds": scenario["expected_events"],
                "desktop": desktop, "tui": tui, "android_python": android,
                "exact_match": equal,
            })
        report = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "fixture": fixture_path.relative_to(repo).as_posix(),
            "fixture_sha256": hashlib.sha256(fixture_data).hexdigest(),
            "scenarios": scenarios,
            "match_percent": 100 if all(row["exact_match"] for row in scenarios) else 0,
            "result": "passed" if all(row["exact_match"] for row in scenarios) else "failed",
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0 if report["result"] == "passed" else 1
    finally:
        for path in (str(source), str(runtime_root), str(android_python)):
            if path in sys.path:
                sys.path.remove(path)
        sys.modules.pop("runtime_probe", None)


if __name__ == "__main__":
    raise SystemExit(main())
