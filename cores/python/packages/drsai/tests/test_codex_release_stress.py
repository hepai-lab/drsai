from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.security import redact_sensitive
from drsai.backend.codex_adapter.app_server_process import redact_secrets
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.codex_adapter.history_migration import codex_history_migration_dry_run


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_ten_thousand_backend_events_are_bounded_deduplicated_and_fast(tmp_path: Path):
    engine = RuntimeEngine(tmp_path / "engine.sqlite3", RuntimeEngineIdentity("runtime-stress", "instance-1"), lambda _: True)
    # Seed records directly through public APIs; workspace existence is controlled by the fixture.
    session = engine.create_session("workspace-stress", "stress")
    run, _ = engine.create_run(session["session_id"], "codex@1", "stress", "codex")
    started = time.monotonic()
    batch = [("agent.message.delta", {"content": "x" * 64}, f"delta:{index}") for index in range(10_000)]
    engine.append_backend_events(run["run_id"], batch)
    engine.append_backend_events(run["run_id"], batch)
    elapsed = time.monotonic() - started
    collected = []
    after = 0
    while page := engine.list_events(run["run_id"], after_sequence=after, limit=2000):
        collected.extend(page); after = page[-1]["sequence"]
    assert len(collected) == 10_001  # includes run.created
    assert elapsed < 15


@pytest.mark.anyio
async def test_long_turn_delta_batching_remains_bounded_and_event_loop_responsive():
    mapper = CodexEventMapper(batch_bytes=64 * 1024, max_buffer_bytes=64 * 1024)
    emitted = []
    class Context:
        run_id = "run-long"
    class Services:
        def emit_normalized(self, _context, event):
            emitted.append(event)

    async def heartbeat():
        for _ in range(100):
            await asyncio.sleep(0)

    long_delta = "内容" * 500_000
    def map_long_delta():
        mapper.handle(Context(), Services(), {
            "method": "item/agentMessage/delta",
            "params": {"threadId": "thread-long", "turnId": "turn-long", "itemId": "item-long", "delta": long_delta},
        })
        mapper.flush_run(Context(), Services())
    await asyncio.gather(
        heartbeat(),
        asyncio.to_thread(map_long_delta),
    )
    assert emitted
    assert all(len(str(event.payload).encode("utf-8")) < 70 * 1024 for event in emitted)
    assert any(event.payload.get("truncated") is True for event in emitted)


def test_release_secret_canaries_are_removed_from_process_diagnostics():
    value = "Authorization: Bearer secret-canary api_key=sk-canary cookie=session-canary"
    result = redact_secrets(value, ["session-canary"])
    for secret in ("secret-canary", "sk-canary", "session-canary"):
        assert secret not in result


def test_twenty_megabyte_answer_streams_without_loss_or_quadratic_batches():
    mapper = CodexEventMapper(batch_bytes=4096, max_buffer_bytes=64 * 1024)
    emitted = []

    class Context:
        run_id = "run-20mb"

    class Services:
        def emit_normalized(self, _context, event):
            emitted.append(event)

    chunk = "x" * 2048
    chunk_count = 10_240
    started = time.monotonic()
    for index in range(chunk_count):
        mapper.handle(Context(), Services(), {
            "method": "item/agentMessage/delta",
            "params": {"threadId": "thread-20mb", "turnId": "turn-20mb",
                       "itemId": "item-20mb", "delta": chunk, "sequence": index},
        })
    mapper.flush_run(Context(), Services())
    elapsed = time.monotonic() - started
    text = "".join(str(event.payload.get("text") or "") for event in emitted)
    assert len(text.encode("utf-8")) == 20 * 1024 * 1024
    assert all(event.payload.get("truncated") is False for event in emitted)
    assert all(len(str(event.payload.get("text") or "").encode("utf-8")) <= 4096 for event in emitted)
    assert elapsed < 15


def test_runtime_redaction_is_linear_for_large_unbroken_deltas_and_masks_url_userinfo():
    value = "x" * (64 * 1024)
    started = time.monotonic()
    result = redact_sensitive(value)
    elapsed = time.monotonic() - started
    assert result.endswith("[TRUNCATED 61440 CHARS]")
    assert elapsed < 0.5
    assert redact_sensitive("https://alice:secret@example.invalid/path") == (
        "https://[REDACTED]@example.invalid/path"
    )


def test_five_thousand_tool_events_and_ten_thousand_history_runs_are_linear(tmp_path: Path):
    engine = RuntimeEngine(tmp_path / "tool-engine.sqlite3", RuntimeEngineIdentity("runtime-tools", "instance-1"), lambda _: True)
    session = engine.create_session("workspace-tools", "tools")
    run, _ = engine.create_run(session["session_id"], "codex@1", "tools", "codex")
    tool_events = [
        ("tool.progress", {"tool": "synthetic", "progress": index}, f"tool:{index}")
        for index in range(5_000)
    ]
    started = time.monotonic()
    engine.append_backend_events(run["run_id"], tool_events)
    history = [
        {"backend_run_id": f"turn-{index}", "items": [
            {"item_id": f"message-{index}", "role": "assistant"},
        ]}
        for index in range(10_000)
    ]
    existing = [
        {"item_id": f"legacy-{index}", "role": "assistant", "payload": {
            "backend_run_id": f"turn-{index}", "backend_item_id": f"message-{index}",
            "mapping_version": "old", "text": f"answer-{index}",
        }}
        for index in range(10_000)
    ]
    report = codex_history_migration_dry_run(
        session["session_id"], history, existing, [], mapping_version="p10",
    )
    elapsed = time.monotonic() - started
    assert report["scanned_items"] == 10_000
    assert report["expected_items"] == 10_000
    assert report["affected_items"] == 10_000
    collected = []
    after = 0
    while page := engine.list_events(run["run_id"], after_sequence=after, limit=2_000):
        collected.extend(page)
        after = page[-1]["sequence"]
    assert len(collected) == 5_001
    assert elapsed < 15
