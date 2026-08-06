"""Bounded, event-loop friendly JSONL framing shared by local and bridged Codex."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from drsai.backend.runtime.agent import RuntimeExecutionError


CODEX_JSONL_FRAME_LIMIT = 16 * 1024 * 1024
ASYNC_JSON_PARSE_THRESHOLD = 256 * 1024


def require_jsonl_frame_size(size: int, *, source: str = "Codex App Server") -> None:
    if size <= CODEX_JSONL_FRAME_LIMIT:
        return
    raise RuntimeExecutionError(
        "codex_jsonl_frame_too_large",
        f"{source} returned a response larger than the 16 MB safety limit. "
        "Narrow the requested history or update Codex, then retry.",
        retryable=False,
        detail={"received_bytes": size, "maximum_bytes": CODEX_JSONL_FRAME_LIMIT},
    )


async def read_jsonl_frame(reader: asyncio.StreamReader, *, source: str = "Codex App Server") -> bytes:
    try:
        raw = await reader.readline()
    except (ValueError, asyncio.LimitOverrunError) as exc:
        raise RuntimeExecutionError(
            "codex_jsonl_frame_too_large",
            f"{source} returned a response larger than the 16 MB safety limit. "
            "Narrow the requested history or update Codex, then retry.",
            retryable=False,
            detail={"maximum_bytes": CODEX_JSONL_FRAME_LIMIT},
        ) from exc
    require_jsonl_frame_size(len(raw), source=source)
    return raw


async def parse_jsonl_object(raw: bytes, *, source: str = "Codex App Server") -> Any:
    require_jsonl_frame_size(len(raw), source=source)
    parser = lambda: json.loads(raw)
    return await asyncio.to_thread(parser) if len(raw) >= ASYNC_JSON_PARSE_THRESHOLD else parser()
