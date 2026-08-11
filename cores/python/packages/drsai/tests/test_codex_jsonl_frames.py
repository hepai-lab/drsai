import asyncio
import tracemalloc

import pytest

from drsai.backend.codex_adapter.jsonl_frames import (
    CODEX_JSONL_FRAME_LIMIT,
    parse_jsonl_object,
    require_jsonl_frame_size,
)
from drsai.backend.runtime.agent import RuntimeExecutionError


def _json_frame(size: int) -> bytes:
    prefix, suffix = b'{"data":"', b'"}\n'
    return prefix + (b"x" * (size - len(prefix) - len(suffix))) + suffix


@pytest.mark.anyio
async def test_jsonl_4mb_and_16mb_boundaries_parse_without_blocking_loop():
    four_mb = _json_frame(4 * 1024 * 1024)
    exact_limit = _json_frame(CODEX_JSONL_FRAME_LIMIT)
    ticks = 0

    async def ticker():
        nonlocal ticks
        for _ in range(50):
            await asyncio.sleep(0)
            ticks += 1

    tracemalloc.start()
    parsed, _ = await asyncio.gather(parse_jsonl_object(four_mb), ticker())
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert len(parsed["data"]) > 4_000_000
    assert ticks == 50, "large JSON parsing must yield to the Runtime event loop"
    assert peak < 64 * 1024 * 1024, "4 MB parsing must remain within a bounded memory envelope"
    assert len((await parse_jsonl_object(exact_limit))["data"]) > 16_000_000


@pytest.mark.parametrize("size", [32 * 1024 * 1024, 128 * 1024 * 1024])
def test_jsonl_oversize_boundaries_fail_with_actionable_non_retryable_error(size: int):
    with pytest.raises(RuntimeExecutionError) as caught:
        require_jsonl_frame_size(size, source="Host Codex Bridge")
    assert caught.value.code == "codex_jsonl_frame_too_large"
    assert caught.value.retryable is False
    assert caught.value.detail == {"received_bytes": size, "maximum_bytes": CODEX_JSONL_FRAME_LIMIT}
    assert "Narrow the requested history" in caught.value.message
