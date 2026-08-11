from __future__ import annotations

import asyncio
import json
import statistics
import time
import tracemalloc
from copy import deepcopy
from pathlib import Path

from drsai.relay.oaep_replay import OAEPReplayHub


ROOT = Path(__file__).resolve().parents[5]


def test_10k_oaep_events_have_bounded_replay_latency_and_memory() -> None:
    fixture = json.loads(
        (ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8")
    )
    template = fixture["events"][0]

    def frame(sequence: int) -> dict:
        event = deepcopy(template)
        event.update({
            "event_id": f"event-{sequence}",
            "sequence": sequence,
            "dedupe_key": f"event-{sequence}",
        })
        event["source"]["runtime_id"] = "runtime-perf"
        return {
            "type": "event", "protocol": "oaep/1", "scope": "session",
            "runtime_id": "runtime-perf", "workspace_id": "workspace-perf",
            "session_id": event["session_id"], "sequence": sequence,
            "event": event,
        }

    async def scenario() -> tuple[float, list[float], int]:
        hub = OAEPReplayHub(max_events_per_session=10_000)
        await hub.attach("runtime-perf", "generation-one")
        tracemalloc.start()
        started = time.perf_counter()
        for sequence in range(1, 10_001):
            assert await hub.accept("runtime-perf", "generation-one", frame(sequence))
        ingest_seconds = time.perf_counter() - started
        latencies = []
        cursor = 0
        while cursor < 10_000:
            page_started = time.perf_counter()
            page = await hub.page(
                "runtime-perf", "workspace-perf", template["session_id"],
                after_sequence=cursor, limit=100,
            )
            latencies.append((time.perf_counter() - page_started) * 1000)
            cursor = page["next_sequence"]
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        return ingest_seconds, latencies, peak

    ingest_seconds, latencies, peak = asyncio.run(scenario())
    p95 = statistics.quantiles(latencies, n=100)[94]
    assert ingest_seconds < 30
    assert p95 < 100
    assert peak < 128 * 1024 * 1024
