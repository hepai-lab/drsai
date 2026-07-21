from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.codex_adapter.app_server_process import redact_secrets
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper


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
        def emit_backend(self, _context, event_type, data, key):
            emitted.append((event_type, data, key))

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
    assert all(len(str(data).encode("utf-8")) < 70 * 1024 for _, data, _ in emitted)
    assert any(data.get("truncated") is True for _, data, _ in emitted)


def test_release_secret_canaries_are_removed_from_process_diagnostics():
    value = "Authorization: Bearer secret-canary api_key=sk-canary cookie=session-canary"
    result = redact_secrets(value, ["session-canary"])
    for secret in ("secret-canary", "sk-canary", "session-canary"):
        assert secret not in result
