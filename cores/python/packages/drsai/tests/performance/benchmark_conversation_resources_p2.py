"""Reproducible P2 resource scalability gate (not part of routine unit tests)."""

from __future__ import annotations

import json
import sqlite3
import statistics
import tempfile
import time
from pathlib import Path

from drsai.owop.resource_service import InMemoryObjectResourceHost, ResourceAccessContext, ResourceService


def p95(samples: list[float]) -> float:
    return sorted(samples)[max(0, int(len(samples) * 0.95) - 1)]


def benchmark() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="drsai-resource-perf-") as raw:
        root = Path(raw)
        host = InMemoryObjectResourceHost()
        service = ResourceService(root / "resources.sqlite3", host, authorize=lambda *_: True, audit_salt=b"perf-gate")
        context = ResourceAccessContext("tenant-perf", "principal-perf", "session-perf", "authority-perf", "workspace-perf", "corr-perf")
        observations = []
        for index in range(100):
            handle = f"handle-{index}"
            host.publish("tenant-perf", handle, f"resource-{index}".encode(), display_name=f"resource-{index}.txt", mime_type="text/plain")
            registered = service.register(context, host_handle=handle, resource_type="file", idempotency_key=f"register-{index}")
            observations.append({"association_id": f"association-{index}", "resource": registered["resource"]})

        batch_samples = []
        for _ in range(25):
            started = time.perf_counter()
            result = service.resolve_batch(context, observations)
            batch_samples.append((time.perf_counter() - started) * 1000)
            assert len(result["results"]) == 100

        preview_bytes = b"p" * (900 * 1024)
        host.publish("tenant-perf", "preview", preview_bytes, display_name="preview.md", mime_type="text/markdown")
        preview_registered = service.register(context, host_handle="preview", resource_type="artifact", idempotency_key="preview")
        preview_samples = []
        for _ in range(10):
            started = time.perf_counter()
            preview = service.preview(
                context, preview_registered["resource"], version_id=preview_registered["version"]["version_id"],
                accept_kinds=["text"], max_bytes=1024 * 1024,
            )
            preview_samples.append((time.perf_counter() - started) * 1000)
            assert preview["digest"] == preview_registered["version"]["digest"]

        # Opening a 2,000-association history selects only the visible window;
        # it never creates 2,000 resolve observations.
        history = [{"association_id": f"history-{index}", "resource": observations[index % 100]["resource"]} for index in range(2_000)]
        viewport_samples = []
        for offset in range(0, 1_900, 19):
            started = time.perf_counter()
            visible = history[offset:offset + 100]
            viewport_samples.append((time.perf_counter() - started) * 1000)
            assert len(visible) <= ResourceService.MAX_BATCH

        database = root / "million.sqlite3"
        ResourceService(database, host, authorize=lambda *_: True, audit_salt=b"million-index")
        db = sqlite3.connect(database)
        try:
            db.execute("PRAGMA synchronous=OFF")
            db.execute("PRAGMA journal_mode=MEMORY")
            started = time.perf_counter()
            db.execute("""
                WITH RECURSIVE sequence(value) AS (
                  SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < 1000000
                )
                INSERT INTO owop_resources_v2
                SELECT 'tenant-perf','authority-million','workspace-million','file',
                       printf('resource-%07d', value),1,printf('handle-%07d', value),
                       printf('object-%07d', value),printf('file-%07d', value),NULL,
                       'available','version-1',0,'2026-08-16T00:00:00Z','2026-08-16T00:00:00Z'
                  FROM sequence
            """)
            db.commit()
            insert_seconds = time.perf_counter() - started
            count = db.execute("SELECT COUNT(*) FROM owop_resources_v2").fetchone()[0]
            plan = " ".join(str(value) for row in db.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM owop_resources_v2 WHERE authority_id=? AND workspace_id=? AND resource_type=? AND resource_id=? AND generation=?",
                ("authority-million", "workspace-million", "file", "resource-0500000", 1),
            ) for value in row)
            lookup_samples = []
            for index in range(1, 1_000_001, 5_000):
                started = time.perf_counter()
                row = db.execute(
                    "SELECT resource_id FROM owop_resources_v2 WHERE authority_id=? AND workspace_id=? AND resource_type=? AND resource_id=? AND generation=?",
                    ("authority-million", "workspace-million", "file", f"resource-{index:07d}", 1),
                ).fetchone()
                lookup_samples.append((time.perf_counter() - started) * 1000)
                assert row is not None
        finally:
            db.close()

        report = {
            "batch_100_p95_ms": round(p95(batch_samples), 3),
            "batch_request_count": 1,
            "history_associations": 2_000,
            "history_max_resolved_per_viewport": 100,
            "history_viewport_slice_p95_ms": round(p95(viewport_samples), 3),
            "preview_bytes": len(preview_bytes),
            "preview_p95_ms": round(p95(preview_samples), 3),
            "index_rows": count,
            "index_insert_seconds": round(insert_seconds, 3),
            "index_lookup_p95_ms": round(p95(lookup_samples), 3),
            "index_query_plan": plan,
        }
        assert report["batch_100_p95_ms"] <= 150
        assert report["preview_p95_ms"] <= 2_000
        assert report["history_max_resolved_per_viewport"] == 100
        assert count >= 1_000_000 and "INDEX" in plan.upper()
        return report


if __name__ == "__main__":
    print(json.dumps(benchmark(), indent=2, sort_keys=True))
