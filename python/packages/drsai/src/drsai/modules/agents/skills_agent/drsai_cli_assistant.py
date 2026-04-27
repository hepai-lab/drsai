"""CLI-optimized DrSaiAssistant.

Thin subclass of :class:`DrSaiAssistant` that exposes extra hooks used by
``drsai-cli`` — history loading, session listing/search, and a running
token-usage aggregate. The production ``DrSaiAssistant`` is unchanged.

Do not put UI concerns here (Rich rendering, slash commands, prompt_toolkit).
Those live under :mod:`drsai.backend.cli`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlmodel import Session, select

from drsai.modules.managers.datamodel.db import Thread
from .drsai_assistant import DrSaiAssistant


__all__ = ["DrSaiCLIAssistant", "SessionInfo", "TokenStats"]


@dataclass
class SessionInfo:
    """One row in the CLI session list."""

    thread_id: str
    name: str
    updated_at: str
    message_count: int
    preview: str  # short excerpt from the last user turn
    workdir: str = ""  # working directory where session was created


@dataclass
class TokenStats:
    """Running token stats for the lifetime of a single DrSaiCLIAssistant."""

    turns: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    last_prompt_tokens: int = 0
    last_completion_tokens: int = 0
    last_turn_seconds: float = 0.0
    last_model: str = ""
    # Per-turn breadcrumbs kept only in memory, newest last
    history: list[dict[str, Any]] = field(default_factory=list)


class DrSaiCLIAssistant(DrSaiAssistant):
    """CLI-oriented assistant.

    Inherits *all* behaviour from :class:`DrSaiAssistant`.
    Additions are read-only introspection helpers plus a
    :attr:`reasoning_effort` knob consulted by the renderer.
    """

    def __init__(
        self,
        *args: Any,
        reasoning_effort: str = "medium",
        **kwargs: Any,
    ) -> None:
        # Nudge defaults for single-user terminal workflows.
        kwargs.setdefault("model_client_stream", True)
        kwargs.setdefault("is_powershell", False)
        kwargs.setdefault("only_in_workspace", False)
        kwargs.setdefault("allolow_dangrous_cmd", True)
        super().__init__(*args, **kwargs)

        self._reasoning_effort: str = reasoning_effort
        self._token_stats = TokenStats()

    # ── TODO: Reasoning effort ──────────────────────────────────────────────
    # 完整的 reasoning_effort 实现需要:
    # 1. 在此属性 setter 中验证并存储 reasoning_config
    # 2. 在创建 LLM client 时传递 thinking/reasoning 参数
    # 3. 不同模型需要差异化处理 (Anthropic/OAI兼容/Kimi/DeepSeek等)
    # 4. 参考 hermes-agent/agent/transports/ 的实现模式
    # ── Reasoning effort ────────────────────────────────────────────────────
    @property
    def reasoning_effort(self) -> str:
        return self._reasoning_effort

    @reasoning_effort.setter
    def reasoning_effort(self, value: str) -> None:
        allowed = {"off", "low", "medium", "high", "xhigh"}
        if value not in allowed:
            raise ValueError(f"reasoning_effort must be one of {sorted(allowed)}")
        self._reasoning_effort = value

    # ── Token stats ─────────────────────────────────────────────────────────
    @property
    def token_stats(self) -> TokenStats:
        return self._token_stats

    def record_turn(
        self,
        *,
        prompt_tokens: int,
        completion_tokens: int,
        seconds: float,
        model: str = "",
    ) -> None:
        s = self._token_stats
        s.turns += 1
        s.prompt_tokens += max(prompt_tokens, 0)
        s.completion_tokens += max(completion_tokens, 0)
        s.last_prompt_tokens = max(prompt_tokens, 0)
        s.last_completion_tokens = max(completion_tokens, 0)
        s.last_turn_seconds = max(seconds, 0.0)
        s.last_model = model or s.last_model

    # ── Thread-backed history ───────────────────────────────────────────────
    def load_history(self, thread_id: Optional[str] = None) -> list[dict[str, Any]]:
        """Return the ``Thread.messages`` JSON list for a session.

        Falls back to an empty list when no ``db_manager`` is wired or the
        thread has not been persisted yet.
        """
        if self._db_manager is None:
            return []
        tid = thread_id or self._thread_id
        response = self._db_manager.get(
            Thread, filters={"user_id": self._user_id, "thread_id": tid},
            return_json=False,
        )
        if not response.status or not response.data:
            return []
        row = response.data[0]
        msgs = getattr(row, "messages", None) or []
        return list(msgs)

    def list_sessions(self, limit: int = 50) -> list[SessionInfo]:
        """List recent Threads for the current user, newest first."""
        if self._db_manager is None:
            return []
        response = self._db_manager.get(
            Thread, filters={"user_id": self._user_id},
            order="desc", return_json=False,
        )
        if not response.status or not response.data:
            return []
        out: list[SessionInfo] = []
        for row in response.data[:limit]:
            out.append(_thread_to_info(row))
        return out

    def search_sessions(self, query: str, limit: int = 20) -> list[SessionInfo]:
        """Substring match across Thread messages/names. Case-insensitive.

        Uses a Python-side filter — acceptable for a few hundred sessions.
        Upgrade to FTS5 if this becomes slow.
        """
        if self._db_manager is None or not query:
            return []
        needle = query.lower()
        hits: list[SessionInfo] = []
        for info in self.list_sessions(limit=500):
            blob = f"{info.name}\n{info.preview}".lower()
            if needle in blob:
                hits.append(info)
                if len(hits) >= limit:
                    break
        # Second pass: deep scan full message bodies for misses in preview
        if len(hits) < limit:
            seen = {h.thread_id for h in hits}
            try:
                engine = self._db_manager.engine
                with Session(engine) as sess:
                    stmt = select(Thread).where(Thread.user_id == self._user_id)
                    for row in sess.exec(stmt):
                        if row.thread_id in seen:
                            continue
                        try:
                            blob = json.dumps(row.messages or [], ensure_ascii=False).lower()
                        except Exception:
                            continue
                        if needle in blob:
                            hits.append(_thread_to_info(row))
                            if len(hits) >= limit:
                                break
            except Exception:
                pass
        return hits

    def set_session_name(self, thread_id: str, name: str) -> bool:
        """Persist a human-friendly name on ``Thread.meta['name']``."""
        if self._db_manager is None:
            return False
        response = self._db_manager.get(
            Thread, filters={"user_id": self._user_id, "thread_id": thread_id},
            return_json=False,
        )
        if not response.status or not response.data:
            return False
        row = response.data[0]
        meta = dict(row.meta or {})
        meta["name"] = name
        row.meta = meta
        self._db_manager.upsert(row, return_json=False)
        return True


def _thread_to_info(row: Thread) -> SessionInfo:
    msgs = row.messages or []
    preview = ""
    for m in reversed(msgs):
        if isinstance(m, dict):
            content = m.get("content") or ""
            if isinstance(content, str) and content.strip():
                preview = content.strip().splitlines()[0][:120]
                break
    meta = row.meta or {}
    name = meta.get("name") if isinstance(meta, dict) else None
    workdir = meta.get("workdir") if isinstance(meta, dict) else None
    ts = row.updated_at.isoformat() if hasattr(row.updated_at, "isoformat") else str(row.updated_at)
    return SessionInfo(
        thread_id=row.thread_id or "",
        name=name or (row.thread_id or "")[:8],
        updated_at=ts,
        message_count=len(msgs),
        preview=preview,
        workdir=workdir or "",
    )
