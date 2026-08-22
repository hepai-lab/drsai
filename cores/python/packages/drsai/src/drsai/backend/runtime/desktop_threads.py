"""Read-only projection of Desktop Threads into the Runtime Session contract.

The Windows Desktop owns its sidebar catalog and message snapshots.  Mobile
clients speak the Runtime Session/Conversation protocol, so the gateway must
project that catalog instead of exposing only sessions created directly in the
Runtime database.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from drsai.config.agent_model_policy import canonical_agent_name, current_agent_name


_MAX_THREADS_BYTES = 8 * 1024 * 1024
_MAX_SNAPSHOTS_BYTES = 64 * 1024 * 1024
_MAX_MESSAGES = 500
_MAX_MESSAGE_CHARS = 200_000


def _read_json(path: Path, maximum: int, fallback: Any) -> Any:
    try:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > maximum:
            return fallback
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return fallback


def _path_key(value: str) -> str:
    try:
        return os.path.normcase(os.path.abspath(value))
    except (OSError, ValueError):
        return ""


def _agent_binding(bound_agent_id: Any) -> tuple[str | None, str | None]:
    """Map only built-in Desktop agents to immutable Runtime definitions."""
    if bound_agent_id == "my-codex":
        return "codex@1", "codex"
    if bound_agent_id in {None, "", "my-drsai", current_agent_name()}:
        return "opendrsai@1", "opendrsai"
    if isinstance(bound_agent_id, str):
        try:
            canonical_agent_name(bound_agent_id.removeprefix("agent:"))
            return "opendrsai@1", "opendrsai"
        except Exception:
            pass
    return None, None


class DesktopThreadProjection:
    """Bounded, fail-closed reader for the Desktop thread stores."""

    def __init__(self, state_root: Path):
        self.root = Path(state_root).expanduser().resolve(strict=False) / "desktop"

    def threads_for_workspace(self, workspace_path: str) -> list[dict[str, Any]]:
        raw = _read_json(self.root / "threads.json", _MAX_THREADS_BYTES, [])
        if not isinstance(raw, list):
            return []
        wanted = _path_key(workspace_path)
        rows: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict) or _path_key(str(item.get("workspacePath") or "")) != wanted:
                continue
            thread_id = str(item.get("id") or "")
            if not thread_id.startswith("thread-") or len(thread_id) > 160:
                continue
            agent_definition, backend_id = _agent_binding(item.get("boundAgentId"))
            rows.append({
                "session_id": thread_id,
                "title": str(item.get("title") or "New session")[:240],
                "created_at": str(item.get("createdAt") or item.get("updatedAt") or ""),
                "updated_at": str(item.get("updatedAt") or item.get("createdAt") or ""),
                "archived": bool(item.get("archived")),
                "agent_definition": agent_definition,
                "backend_id": backend_id,
            })
        return sorted(rows, key=lambda row: row["updated_at"], reverse=True)

    def has_thread(self, thread_id: str) -> bool:
        raw = _read_json(self.root / "threads.json", _MAX_THREADS_BYTES, [])
        return isinstance(raw, list) and any(
            isinstance(item, dict) and item.get("id") == thread_id for item in raw
        )

    def conversation(self, thread_id: str) -> list[dict[str, Any]]:
        raw = _read_json(self.root / "thread-snapshots.json", _MAX_SNAPSHOTS_BYTES, {})
        if not isinstance(raw, dict) or not isinstance(raw.get(thread_id), dict):
            return []
        snapshot = raw[thread_id]
        messages = snapshot.get("messages")
        if not isinstance(messages, list):
            return []
        raw_timestamp = snapshot.get("updatedAt")
        try:
            timestamp = datetime.fromtimestamp(float(raw_timestamp) / 1000, timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            timestamp = datetime.now(timezone.utc).isoformat()
        items: list[dict[str, Any]] = []
        for index, message in enumerate(messages[:_MAX_MESSAGES]):
            if not isinstance(message, dict):
                continue
            role = str(message.get("role") or "")
            if role not in {"user", "assistant", "system"}:
                continue
            content = str(message.get("content") or "")[:_MAX_MESSAGE_CHARS]
            if not content:
                continue
            message_id = str(message.get("id") or f"{thread_id}:{index}")[:240]
            items.append({
                "item_id": f"desktop:{message_id}",
                "kind": f"message.{role}",
                "timestamp": timestamp,
                "payload": {"content": content, "source": "desktop_thread"},
            })
        return items

    @staticmethod
    def encode_cursor(offset: int) -> str:
        return "desktop:" + base64.urlsafe_b64encode(str(offset).encode()).rstrip(b"=").decode()

    @staticmethod
    def decode_cursor(cursor: str | None) -> int:
        if not cursor:
            return 0
        if not cursor.startswith("desktop:"):
            raise ValueError("Invalid Desktop Conversation cursor")
        try:
            raw = cursor.removeprefix("desktop:")
            return max(0, int(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()))
        except (ValueError, UnicodeError) as exc:
            raise ValueError("Invalid Desktop Conversation cursor") from exc
