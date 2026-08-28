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
from typing import Any, Mapping, Optional

from loguru import logger
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
    tags: list[str] = field(default_factory=list)  # user-assigned tags
    pinned: bool = False  # pinned to top of lists
    archived: bool = False  # archived (hidden from default list)
    relevance_score: float = 0.0  # search relevance score (populated by smart_search)
    match_snippet: str = ""  # matched text snippet from FTS search (populated by smart_search)


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
        kwargs.setdefault("is_powershell", None)
        kwargs.setdefault("only_in_workspace", True)
        kwargs.setdefault("allolow_dangrous_cmd", False)  # CLI 默认拦截危险命令，用 /dangerous on 授权
        super().__init__(*args, **kwargs)

        self._reasoning_effort: str = reasoning_effort
        self._token_stats = TokenStats()

        # ── Dangerous-command toggle helpers ─────────────────────────────────
        # These closures come from operater_funs.get_operator_funcs() and allow
        # the CLI (/dangerous on|off) to dynamically toggle the restriction.
        # NOT registered as LLM tools — only accessible via CLI slash commands.
        _DANGEROUS_FUNC_NAMES = {"set_dangerous_allowed", "get_dangerous_status"}
        self._dangerous_toggle_funcs = [
            func for func in self._all_basic_funcs if func.__name__ in _DANGEROUS_FUNC_NAMES
        ]

        # Mirror the operater_funs closure flag onto an agent attribute so the
        # tui_gateway's session.info() can surface the correct safe-cmd /
        # any-cmd badge. Before this line ``self._allow_dangerous_commands``
        # was undefined → ``getattr(agent, "_allow_dangerous_commands", False)``
        # always returned False even when ``allolow_dangrous_cmd=True`` was
        # passed in, so the status bar lied to the user. (Discovered while
        # investigating "rm -rf ran without an approval prompt".)
        self._allow_dangerous_commands: bool = bool(
            kwargs.get("allolow_dangrous_cmd", False)
        )

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
        allowed = {"off", "none", "low", "medium", "high", "xhigh", "max"}
        if value not in allowed:
            raise ValueError(f"reasoning_effort must be one of {sorted(allowed)}")
        self._reasoning_effort = value

    # ── Max agent concurrent ───────────────────────────────────────────────
    @property
    def max_agent_concurrent(self) -> int:
        return self._max_agent_concurrent

    @max_agent_concurrent.setter
    def max_agent_concurrent(self, value: int) -> None:
        if not isinstance(value, int) or value < 1:
            raise ValueError("max_agent_concurrent must be a positive integer >= 1")
        self._max_agent_concurrent = value

    # ── Session-local state persistence ─────────────────────────────────────
    # Override base class to persist session-local configuration alongside
    # llm_context.  This ensures model selection, injected prompts (including
    # plan_mode), and reasoning effort are restored when switching sessions.

    async def save_state(self) -> Mapping[str, Any]:
        """Save llm_context + session-local configuration (model, inject, project_instructions, reasoning, workspace, dangerous)."""
        model_context_state = await self._model_context.save_state()
        return {
            "llm_context": model_context_state,
            "type": "DrSaiCLIAssistantState",
            "defult_config_name": self._defult_config_name,
            "injected_prefix": getattr(self, '_injected_prefix', ''),
            "injected_suffix": getattr(self, '_injected_suffix', ''),
            "project_instructions": getattr(self, '_project_instructions', ''),
            "reasoning_effort": self._reasoning_effort,
            "only_in_workspace": getattr(self, '_only_in_workspace', True),
            "dangerous_allowed": self._get_dangerous_allowed(),
        }

    async def load_state(self, state: Mapping[str, Any], *, restore_model: bool = True) -> None:
        """Restore session-local configuration then llm_context.

        Backward-compatible: old states that lack the extra keys are handled
        gracefully (model/inject/reasoning simply stay at their defaults).

        When ``restore_model`` is False (desktop chat passes an explicit
        per-request model alias), keep the agent model that was just created
        and only restore conversation history / inject / reasoning. Otherwise
        a prior session model (e.g. deepseek-v4-pro) would overwrite the UI
        selection after gateway recreate + load_state.
        """
        # ── 1. Restore model client if saved config differs ────────────────
        saved_config = state.get("defult_config_name")
        if (
            restore_model
            and saved_config
            and saved_config != self._defult_config_name
            and self._set_model_client
        ):
            try:
                new_client = self._set_model_client(saved_config)
                await self.switch_model(new_client)
                self._defult_config_name = saved_config
            except Exception as e:
                logger.warning(f"Failed to restore model '{saved_config}': {e}")

        # ── 2. Restore llm_context (conversation history) ──────────────────
        # Backward compat: old format is a flat dict like {"messages": [...]}
        # without a "llm_context" key.
        llm_context = state.get("llm_context", state)
        await self._model_context.load_state(llm_context)

        # ── 3. Restore injected prompts (covers plan_mode & /inject) ───────
        prefix = state.get("injected_prefix", '')
        suffix = state.get("injected_suffix", '')
        project_instructions = state.get("project_instructions", '')
        if prefix or suffix or project_instructions:
            self.inject_system_prompt(
                prefix=prefix,
                suffix=suffix,
                project_instructions=project_instructions,
            )

        # ── 4. Restore reasoning effort ────────────────────────────────────
        effort = state.get("reasoning_effort")
        if effort and effort in {"off", "low", "medium", "high", "xhigh"}:
            self._reasoning_effort = effort

        # ── 5. Restore workspace restriction ───────────────────────────────
        ws_enabled = state.get("only_in_workspace")
        if ws_enabled is not None:
            # Use toggle helpers from operater_funs to sync the closure state
            toggle_funcs = getattr(self, '_workspace_toggle_funcs', [])
            set_ws_fn = next((f for f in toggle_funcs if f.__name__ == "set_workspace_restriction"), None)
            if set_ws_fn:
                set_ws_fn(ws_enabled)
            self._only_in_workspace = ws_enabled  # sync agent-level flag

        # ── 6. Restore dangerous command restriction ───────────────────────
        dangerous_allowed = state.get("dangerous_allowed")
        if dangerous_allowed is not None:
            toggle_funcs = getattr(self, '_dangerous_toggle_funcs', [])
            set_fn = next((f for f in toggle_funcs if f.__name__ == "set_dangerous_allowed"), None)
            if set_fn:
                set_fn(dangerous_allowed)

    def _get_dangerous_allowed(self) -> bool:
        """Get current dangerous_allowed state from the closure."""
        toggle_funcs = getattr(self, '_dangerous_toggle_funcs', [])
        get_fn = next((f for f in toggle_funcs if f.__name__ == "get_dangerous_status"), None)
        if get_fn:
            status = get_fn()
            return status.get("dangerous_allowed", False)
        return getattr(self, '_dangerous_allowed', False)

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
        return _extract_messages_from_thread(row)

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
                            msgs = _extract_messages_from_thread(row)
                            blob = json.dumps(msgs, ensure_ascii=False).lower()
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


def _extract_messages_from_thread(row: Thread) -> list[dict[str, Any]]:
    """Extract messages from Thread, falling back to Thread.state if needed.

    Messages may live in ``Thread.messages`` (legacy) or be embedded inside
    ``Thread.state`` under ``llm_context.current_messages`` (current storage).
    """
    msgs = list(row.messages) if row.messages else []
    if msgs:
        return msgs
    # Fall back to decompressing Thread.state
    state = getattr(row, "state", None)
    if state:
        try:
            from drsai.utils.utils import decompress_state
            state_dict = decompress_state(state) if isinstance(state, str) else state
            llm_context = state_dict.get("llm_context", state_dict)
            current_msgs = llm_context.get("current_messages", [])
            if current_msgs:
                return list(current_msgs)
        except Exception:
            pass
    return []


def _safe_content_str(val: Any) -> str:
    """Coerce a message content value to a non-empty string for preview/name."""
    if isinstance(val, str):
        return val
    if isinstance(val, (list, dict)):
        try:
            return json.dumps(val, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(val)
    if val is None:
        return ""
    return str(val)


def _thread_to_info(row: Thread) -> SessionInfo:
    msgs = _extract_messages_from_thread(row)
    preview = ""

    # Extract the first user message as the auto-generated session name,
    # and the LAST user message as the preview (so /list shows what the user
    # last asked about, not the assistant's last reply).
    auto_name = ""
    for m in msgs:
        if isinstance(m, dict):
            source = (m.get("source") or m.get("role") or "").lower()
            content = _safe_content_str(m.get("content"))
            if not content.strip():
                continue
            # First user TextMessage → auto name
            if not auto_name and source == "user":
                auto_name = content.strip().splitlines()[0][:40]
            # Track last user message → preview
            if source == "user":
                preview = content.strip().splitlines()[0][:120]

    meta = row.meta or {}
    name = meta.get("name") if isinstance(meta, dict) else None
    workdir = meta.get("workdir") if isinstance(meta, dict) else None
    tags = meta.get("tags", []) if isinstance(meta, dict) else []
    pinned = meta.get("pinned", False) if isinstance(meta, dict) else False
    archived = meta.get("archived", False) if isinstance(meta, dict) else False
    ts = row.updated_at.isoformat() if hasattr(row.updated_at, "isoformat") else str(row.updated_at)
    return SessionInfo(
        thread_id=row.thread_id or "",
        name=name or auto_name or (row.thread_id or "")[:8],
        updated_at=ts,
        message_count=len(msgs),
        preview=preview,
        workdir=workdir or "",
        tags=tags if isinstance(tags, list) else [],
        pinned=bool(pinned),
        archived=bool(archived),
    )
