"""Rebuild enough chat context to resume after a WebUI stream error.

Remote workers keep history in-process keyed by chat_id. After an ERROR/STOPPED
run the UI sends a fresh ``start`` with only the latest user text (often
``continue``). If the remote session was also destroyed, the model honestly
claims there was no prior conversation. This module turns persisted WebUI
messages into a hidden recap the next start can prepend.
"""
from __future__ import annotations

import json
from typing import Any, Sequence

from autogen_agentchat.messages import ChatMessage, MultiModalMessage, TextMessage

_USER_SOURCES = frozenset({"user", "user_proxy"})
_SKIP_SOURCES = frozenset({"system"})
_PROCESS_META_TYPES = frozenset(
    {
        "ToolCallRequestEvent",
        "ToolCallExecutionEvent",
        "ToolCallSummaryMessage",
        "AgentLogEvent",
        "ThoughtEvent",
        "inline_image",
        "file",
        "browser_address",
        "interrupted_run_recap",
    }
)
_ERROR_SNIPPETS = (
    "这次回复出错了",
    "这次回复超时了",
    "已经安全结束",
    "No stream output for",
    "Request exceeded total timeout",
)
_MAX_RECAP_CHARS = 8000
_MAX_TURNS = 12


def _plain_text(content: Any) -> str:
    if isinstance(content, dict):
        inner = content.get("content")
        if isinstance(inner, str):
            return inner.strip()
        return ""
    if not isinstance(content, str):
        return ""
    text = content.strip()
    if text.startswith("{") and "content" in text[:80]:
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return text
        if isinstance(parsed, dict) and isinstance(parsed.get("content"), str):
            return parsed["content"].strip()
    return text


def _is_error_bubble(text: str) -> bool:
    return any(snippet in text for snippet in _ERROR_SNIPPETS)


def build_interrupted_run_recap(message_configs: Sequence[dict[str, Any]]) -> str | None:
    """Return a recap of prior user/assistant text, or None if nothing useful."""
    lines: list[str] = []
    for config in message_configs:
        if not isinstance(config, dict):
            continue
        source = str(config.get("source") or "")
        metadata = config.get("metadata") if isinstance(config.get("metadata"), dict) else {}
        if metadata.get("internal") == "yes":
            continue
        if metadata.get("type") in _PROCESS_META_TYPES:
            continue
        if metadata.get("turn_plane") == "process":
            continue
        if metadata.get("content_type") in {"tools", "log"}:
            continue
        if source in _SKIP_SOURCES:
            continue
        text = _plain_text(config.get("content"))
        if not text or _is_error_bubble(text):
            continue
        role = "User" if source in _USER_SOURCES else "Assistant"
        snippet = text if len(text) <= 1500 else text[:1500] + "…"
        lines.append(f"{role}: {snippet}")

    if not lines:
        return None
    clipped = lines[-_MAX_TURNS:]
    body = "\n\n".join(clipped)
    if len(body) > _MAX_RECAP_CHARS:
        body = body[-_MAX_RECAP_CHARS:]
    return (
        "The previous turn in this session was interrupted. "
        "There IS a prior conversation in this session. "
        "Continue that work. Do not claim there was no previous conversation "
        "or that no task is in progress.\n\n"
        f"Prior conversation:\n{body}"
    )


def attach_recap_to_task(
    task: str | ChatMessage | Sequence[ChatMessage] | None,
    recap: str,
) -> Sequence[ChatMessage]:
    """Prepend a hidden recap message so the UI still only shows the new user turn."""
    recap_message = TextMessage(
        source="user",
        content=recap,
        metadata={
            "internal": "yes",
            "is_save": "no",
            "type": "interrupted_run_recap",
        },
    )
    if task is None or task == "":
        return [recap_message]
    if isinstance(task, str):
        return [
            recap_message,
            TextMessage(source="user_proxy", content=task),
        ]
    if isinstance(task, (TextMessage, MultiModalMessage)):
        return [recap_message, task]
    if isinstance(task, Sequence):
        return [recap_message, *list(task)]
    return [recap_message]
