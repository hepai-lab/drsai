from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from drsai.backend.codex_adapter.native_decoder import CodexNativeEventDecoder


async def verify(workspace: Path, requested_thread_id: str | None = None) -> dict[str, Any]:
    executable = shutil.which("codex.cmd") or shutil.which("codex") or "codex"
    process = await asyncio.create_subprocess_exec(
        executable, "app-server", "--listen", "stdio://",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE, limit=16 * 1024 * 1024,
    )
    assert process.stdin is not None and process.stdout is not None
    request_id = 0

    async def request(method: str, params: dict[str, Any]) -> Any:
        nonlocal request_id
        request_id += 1
        current = request_id
        process.stdin.write((json.dumps({"id": current, "method": method, "params": params}) + "\n").encode())
        await process.stdin.drain()
        while line := await asyncio.wait_for(process.stdout.readline(), timeout=30):
            message = json.loads(line)
            if message.get("id") != current:
                continue
            if "error" in message:
                raise RuntimeError(f"{method} failed: {message['error']}")
            return message.get("result")
        raise RuntimeError(f"{method} ended before a response")

    try:
        await request("initialize", {"clientInfo": {"name": "opendrsai-acceptance", "version": "1.0.0"}})
        process.stdin.write(b'{"method":"initialized","params":{}}\n')
        await process.stdin.drain()
        expected = os.path.normcase(str(workspace.resolve()))
        candidates: list[dict[str, Any]] = []
        for archived in (False, True):
            cursor = None
            for _ in range(100):
                params: dict[str, Any] = {"limit": 100, "archived": archived}
                if cursor:
                    params["cursor"] = cursor
                page = await request("thread/list", params)
                for thread in page.get("data") or page.get("threads") or []:
                    cwd = str(thread.get("cwd") or thread.get("workdir") or "")
                    if cwd and os.path.normcase(str(Path(cwd).resolve())) == expected:
                        candidates.append(thread)
                cursor = page.get("nextCursor")
                if not cursor:
                    break
        if not candidates:
            raise RuntimeError("No Codex Thread belongs to the requested Workspace")
        if requested_thread_id:
            candidates = [value for value in candidates if str(value.get("id")) == requested_thread_id]
            if not candidates:
                raise RuntimeError("Requested Codex Thread does not belong to the Workspace")
        candidates.sort(key=lambda value: str(value.get("updatedAt") or value.get("updated_at") or ""), reverse=True)
        selected = None
        for candidate in candidates:
            result = await request("thread/read", {"threadId": candidate["id"], "includeTurns": True})
            thread = result.get("thread") or {}
            if thread.get("turns"):
                selected = thread
                break
        if selected is None:
            raise RuntimeError("Workspace Codex Threads contain no Turns")
        decoder = CodexNativeEventDecoder()
        decoded_items = 0
        user_messages = 0
        unknown_items: list[str] = []
        previous_turn_index = -1
        for turn_index, turn in enumerate(selected.get("turns") or []):
            if turn_index <= previous_turn_index:
                raise AssertionError("Codex Turn order is not strictly increasing")
            previous_turn_index = turn_index
            for item_index, item in enumerate(turn.get("items") or []):
                native_type = str(item.get("type") or "unknown")
                event = decoder.decode({"method": "item/completed", "params": {
                    "threadId": selected["id"], "turnId": turn.get("id"),
                    "item": {**item, "id": item.get("id") or f"item-{turn_index}-{item_index}"},
                }})
                assert event is not None
                decoded_items += 1
                if event.payload.get("code") == "codex_item_unknown":
                    unknown_items.append(native_type)
                if native_type == "userMessage":
                    user_messages += 1
                    raw_text = "\n".join(
                        str(part.get("text") or "") for part in item.get("content") or []
                        if isinstance(part, dict) and part.get("type") == "text"
                    )
                    assert event.payload.get("text") == raw_text
                    assert not str(event.payload.get("text") or "").startswith("[{")
        if unknown_items:
            raise AssertionError("Unmapped Codex ThreadItem types: " + ", ".join(sorted(set(unknown_items))))
        return {
            "workspace": workspace.name, "thread_id": selected["id"],
            "turns": len(selected.get("turns") or []), "items": decoded_items,
            "user_messages": user_messages, "unknown_item_types": [],
        }
    finally:
        process.stdin.close()
        await process.stdin.wait_closed()
        if process.returncode is None:
            process.terminate()
            await process.wait()
        # Explicitly drain and release Windows Proactor pipe transports. Without
        # this, a successful verifier can still print a misleading
        # "Event loop is closed" warning during interpreter shutdown.
        await asyncio.gather(process.stdout.read(), process.stderr.read())
        await asyncio.sleep(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--thread-id")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(verify(args.workspace, args.thread_id)), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
