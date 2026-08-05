from __future__ import annotations

import argparse
import json
from pathlib import Path

from drsai.oaep.compatibility import LegacyRemovalMetrics, legacy_removal_decision


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    if not args.report.is_file() or not args.report.read_bytes():
        raise SystemExit("oaep_legacy_removal_report_missing")
    metrics = LegacyRemovalMetrics.from_mapping(
        json.loads(args.report.read_text(encoding="utf-8"))
    )
    decision = legacy_removal_decision(metrics)
    print(json.dumps(decision, sort_keys=True, separators=(",", ":")))
    return 0 if decision["allowed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
