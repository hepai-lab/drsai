#!/usr/bin/env python3
"""Real-process gate for P6 shared conversation latency aggregation."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.backend.runtime.observability import (  # noqa: E402
    CONVERSATION_LATENCY_STAGES,
    ResourceCorrelation,
    RuntimeObservability,
)


def _write(database: Path, worker_id: str, start: int, count: int) -> None:
    metrics = RuntimeObservability(database, conversation_latency_trim_interval=1)
    for index in range(start, start + count):
        correlation = ResourceCorrelation(f"p6-{index}", f"p6-{index}")
        for offset, stage in enumerate(CONVERSATION_LATENCY_STAGES):
            dimensions = {"protocol": "oaep/1"}
            if stage == "relay_fanout":
                dimensions["relay_worker"] = worker_id
            if not metrics.record_conversation_latency(
                stage, float(index + offset + 1), correlation, dimensions
            ):
                raise RuntimeError("p6_latency_duplicate_observation")


def verify() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="opendrsai-p6-latency-") as raw:
        database = Path(raw) / "shared.sqlite3"
        processes = [
            subprocess.Popen(
                [
                    sys.executable, str(Path(__file__).resolve()), "--child",
                    "--database", str(database), "--worker-id", f"worker-{index}",
                    "--start", str(index * 10), "--count", "10",
                ],
                cwd=ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            for index in range(2)
        ]
        if len({process.pid for process in processes}) != 2:
            raise RuntimeError("p6_latency_worker_process_identity_invalid")
        for process in processes:
            _, stderr = process.communicate(timeout=30)
            if process.returncode != 0:
                raise RuntimeError(
                    "p6_latency_worker_failed:" + str(process.returncode)
                    + ":" + str(len(stderr.encode("utf-8")))
                )
        report = RuntimeObservability(database).conversation_latency_report(
            minimum_complete_samples=20
        )
        if (
            report.get("ready") is not True
            or report.get("multi_worker_ready") is not True
            or report.get("complete_sample_count") != 20
            or report.get("incomplete_sample_count") != 0
            or report.get("relay_worker_count") != 2
            or any(
                row.get("sample_count") != 20
                or float(row.get("p50_ms", 0)) <= 0
                or float(row.get("p95_ms", 0)) <= 0
                for row in report.get("stages", {}).values()
            )
        ):
            raise RuntimeError("p6_latency_multi_worker_report_invalid")
        encoded = json.dumps(report, sort_keys=True)
        if "p6-" in encoded or "worker-" in encoded:
            raise RuntimeError("p6_latency_report_exposed_identity")
    return {
        "passed": True,
        "worker_process_count": 2,
        "complete_correlation_count": 20,
        "stage_count": len(CONVERSATION_LATENCY_STAGES),
        "p50_nonempty": True,
        "p95_nonempty": True,
        "content_free": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--child", action="store_true")
    parser.add_argument("--database", type=Path)
    parser.add_argument("--worker-id")
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--count", type=int, default=0)
    args = parser.parse_args(argv)
    if args.child:
        if args.database is None or not args.database.is_absolute() \
                or not args.worker_id or args.count < 1:
            raise SystemExit("p6_latency_child_arguments_invalid")
        _write(args.database, args.worker_id, args.start, args.count)
        return 0
    print(json.dumps(verify(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
