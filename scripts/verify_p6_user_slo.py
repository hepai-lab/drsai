#!/usr/bin/env python3
"""Content-free acceptance gate for P6 user-visible SLO aggregation."""
from __future__ import annotations

import json
from pathlib import Path
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
    USER_SLO_DEFINITIONS,
)


def verify() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="opendrsai-p6-user-slo-") as raw:
        metrics = RuntimeObservability(Path(raw) / "slo.sqlite3")
        metrics.record_user_slo_stage(
            "first_screen", "cache_load", 10, sample_id="incomplete-sample-0000"
        )
        initial = metrics.user_slo_report()
        if initial["ready"] or initial["journeys"]["first_screen"]["status"] != "insufficient_samples":
            raise RuntimeError("p6_user_slo_empty_or_incomplete_false_positive")

        for index in range(20):
            sample = f"private-sample-{index:04d}"
            observations = {
                "first_screen": (100, 300, 200),
                "operation_confirmation": (100, 2_100 + index, 100),
                "reconnect": (200, 4_000, 500),
            }
            for journey, durations in observations.items():
                for stage, duration in zip(USER_SLO_DEFINITIONS[journey]["stages"], durations):
                    metrics.record_user_slo_stage(
                        journey, stage, duration, sample_id=sample
                    )
            correlation = ResourceCorrelation(
                f"private-event-{index:04d}", f"private-operation-{index:04d}"
            )
            for stage, duration in zip(CONVERSATION_LATENCY_STAGES, (10, 20, 50, 5, 10)):
                metrics.record_conversation_latency(stage, duration, correlation)

        report = metrics.user_slo_report()
        journeys = report.get("journeys", {})
        if (
            report.get("ready") is not True
            or report.get("breaches") != ["operation_confirmation"]
            or set(journeys) != set(USER_SLO_DEFINITIONS)
            or journeys["operation_confirmation"].get("p95_bottleneck") != "runtime_commit"
            or any(
                journey.get("complete_sample_count") != 20
                or float(journey.get("total_p50_ms", 0)) <= 0
                or float(journey.get("total_p95_ms", 0)) <= 0
                for journey in journeys.values()
            )
        ):
            raise RuntimeError("p6_user_slo_report_invalid")
        encoded = json.dumps(report, sort_keys=True)
        if any(value in encoded for value in ("private-sample", "private-event", "private-operation")):
            raise RuntimeError("p6_user_slo_report_exposed_identity")
        with metrics._connect() as db:
            stored = str(db.execute("SELECT * FROM user_slo_stages").fetchall())
        if "private-sample" in stored or "incomplete-sample" in stored:
            raise RuntimeError("p6_user_slo_store_exposed_sample_id")
    return {
        "passed": True,
        "journey_count": 4,
        "complete_samples_per_journey": 20,
        "p50_nonempty": True,
        "p95_nonempty": True,
        "breach_located": True,
        "content_free": True,
    }


def main() -> int:
    print(json.dumps(verify(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
