"""Versioned, deterministic WebUI chat streaming protocol.

The legacy WebSocket protocol exposes transport details (``start_flag``,
``<think>`` tags, and a second final TextMessage) to the browser.  Protocol v2
projects those details into one stable logical message with independent
reasoning/content channels and monotonic sequence numbers.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, Iterable
from uuid import uuid4


PROTOCOL_VERSION = 2

# Prompts that mean "continue the chat", not a blocking interaction.
_DEFAULT_CONTINUATION_PROMPTS = {
    "",
    "enter your response:",
    "enter your response: ",
    "please enter your response:",
    "please enter your response: ",
}

_USER_SOURCES = frozenset({"user", "user_proxy"})


def is_default_continuation_prompt(
    prompt: str | None,
    input_type: str | None = "text_input",
) -> bool:
    """True when user_proxy is just waiting for the next free-form message."""
    if (input_type or "text_input") != "text_input":
        return False
    normalized = (prompt or "").strip().lower()
    if normalized in _DEFAULT_CONTINUATION_PROMPTS:
        return True
    # Handoff still uses the same generic continuation wording.
    return normalized.endswith("enter your response:")


@dataclass
class _MessageState:
    message_id: str
    stream_id: str
    source: str
    reasoning: str = ""
    content: str = ""
    in_reasoning: bool = False
    status: str = "streaming"


@dataclass
class StreamProjector:
    """Project agent events into an ordered, replayable message lifecycle."""

    run_id: int
    journal_size: int = 512
    seq: int = 0
    active: Dict[str, _MessageState] = field(default_factory=dict)
    snapshots: Dict[str, _MessageState] = field(default_factory=dict)
    latest_by_source: Dict[str, _MessageState] = field(default_factory=dict)
    journal: Deque[dict[str, Any]] = field(init=False)

    def __post_init__(self) -> None:
        self.journal = deque(maxlen=self.journal_size)

    def _emit(
        self,
        event: str,
        state: _MessageState,
        *,
        channel: str | None = None,
        delta: str | None = None,
        snapshot: dict[str, Any] | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        self.seq += 1
        envelope: dict[str, Any] = {
            "type": "stream.v2",
            "protocol_version": PROTOCOL_VERSION,
            "event_id": str(uuid4()),
            "run_id": str(self.run_id),
            "stream_id": state.stream_id,
            "message_id": state.message_id,
            "seq": self.seq,
            "event": event,
            "source": state.source,
        }
        if channel is not None:
            envelope["channel"] = channel
        if delta is not None:
            envelope["delta"] = delta
        if snapshot is not None:
            envelope["snapshot"] = snapshot
        if status is not None:
            envelope["status"] = status
        self.journal.append(envelope)
        return envelope

    def _ensure(self, source: str) -> tuple[_MessageState, list[dict[str, Any]]]:
        state = self.active.get(source)
        if state is not None:
            return state, []
        state = _MessageState(
            message_id=str(uuid4()),
            stream_id=str(uuid4()),
            source=source,
        )
        self.active[source] = state
        self.snapshots[state.message_id] = state
        self.latest_by_source[source] = state
        return state, [self._emit("message.started", state, status="streaming")]

    def begin_turn(self) -> None:
        """Start a user turn without discarding replayable snapshots."""
        for state in self.active.values():
            state.status = "interrupted"
            state.in_reasoning = False
        self.active.clear()
        self.latest_by_source.clear()

    def ingest_chunk(self, source: str, chunk: str) -> list[dict[str, Any]]:
        """Split legacy think-tagged chunks into independent v2 channels."""
        if not chunk:
            return []
        normalized_source = source or "assistant"
        state = self.active.get(normalized_source)
        if state is None:
            state = self.latest_by_source.get(normalized_source)
            # Interrupted OR completed hops are closed. The next token must
            # open a new message_id — otherwise turn N+1 appends onto turn N's
            # bubble and the UI shows the answer above the new user message.
            if state is not None and state.status in {"interrupted", "completed"}:
                state = None
        if state is None:
            state, events = self._ensure(normalized_source)
        else:
            events = []
        remaining = chunk
        while remaining:
            if state.in_reasoning:
                close = remaining.find("</think>")
                redacted_close = remaining.find("</redacted_thinking>")
                candidates = [i for i in (close, redacted_close) if i >= 0]
                if not candidates:
                    state.reasoning += remaining
                    events.append(
                        self._emit(
                            "message.delta",
                            state,
                            channel="reasoning",
                            delta=remaining,
                        )
                    )
                    break
                index = min(candidates)
                if index:
                    delta = remaining[:index]
                    state.reasoning += delta
                    events.append(
                        self._emit(
                            "message.delta",
                            state,
                            channel="reasoning",
                            delta=delta,
                        )
                    )
                closing = (
                    "</redacted_thinking>"
                    if remaining.startswith("</redacted_thinking>", index)
                    else "</think>"
                )
                remaining = remaining[index + len(closing) :]
                state.in_reasoning = False
                continue

            open_index = remaining.find("<think>")
            if open_index < 0:
                state.content += remaining
                events.append(
                    self._emit(
                        "message.delta",
                        state,
                        channel="content",
                        delta=remaining,
                    )
                )
                break
            if open_index:
                delta = remaining[:open_index]
                state.content += delta
                events.append(
                    self._emit(
                        "message.delta",
                        state,
                        channel="content",
                        delta=delta,
                    )
                )
            remaining = remaining[open_index + len("<think>") :]
            state.in_reasoning = True
        return events

    def ingest_thought(self, source: str, thought: str) -> list[dict[str, Any]]:
        """Use ThoughtEvent as an authoritative reasoning snapshot, not a delta."""
        if not thought:
            return []
        normalized_source = source or "assistant"
        state = self.active.get(normalized_source)
        if state is None:
            state = self.latest_by_source.get(normalized_source)
        if state is None:
            state, events = self._ensure(normalized_source)
        else:
            events = []
        if state.reasoning == thought:
            return events
        state.reasoning = thought
        events.append(self._snapshot_event(state))
        return events

    def apply_draft(
        self,
        source: str,
        content: str,
        *,
        reasoning: str = "",
    ) -> list[dict[str, Any]]:
        """Update the live hop from a TextMessage without sealing it.

        A mid-stream TextMessage is a draft snapshot, not ``message.completed``.
        Never replace longer streamed text with a shorter canonical body.
        """
        normalized_source = source or "assistant"
        state, events = self._ensure(normalized_source)
        if state.status == "completed":
            state.status = "streaming"
            self.active[normalized_source] = state
        changed = bool(events)
        if content and len(content) > len(state.content):
            state.content = content
            changed = True
        if reasoning and len(reasoning) > len(state.reasoning):
            state.reasoning = reasoning
            changed = True
        if not changed:
            return events
        events.append(self._snapshot_event(state))
        return events

    def seal_active_assistant(self) -> list[dict[str, Any]]:
        """Seal live assistant hops. Call this at turn.ready, not on TextMessage."""
        events: list[dict[str, Any]] = []
        for source in list(self.active):
            if source in _USER_SOURCES:
                continue
            state = self.active[source]
            events.extend(
                self.complete(source, state.content, reasoning=state.reasoning)
            )
        return events

    def close_turn(self) -> None:
        """After turn.ready: keep snapshots for replay, force next tokens onto a new hop."""
        self.active.clear()
        self.latest_by_source.clear()

    def complete(
        self,
        source: str,
        content: str,
        *,
        reasoning: str = "",
        keep_open: bool = False,
    ) -> list[dict[str, Any]]:
        """Seal a hop as ``message.completed``.

        ``keep_open=True`` still emits completed (so the UI can unlock) but
        leaves the hop in ``active`` for late same-turn deltas. Call
        ``close_turn()`` at ``turn.ready`` so the next user turn opens a new id.
        """
        normalized_source = source or "assistant"
        existing = self.active.get(normalized_source)
        latest = self.latest_by_source.get(normalized_source)
        if (
            existing is None
            and latest is not None
            and latest.status == "completed"
            and (not content or content == latest.content)
            and not keep_open
        ):
            return []
        # Already completed this hop with the same body — avoid duplicate seals.
        if (
            existing is not None
            and existing.status == "completed"
            and (not content or content == existing.content)
            and not keep_open
        ):
            self.active.pop(normalized_source, None)
            return []
        state, events = self._ensure(normalized_source)
        if content and len(content) >= len(state.content):
            state.content = content
        if reasoning and len(reasoning) >= len(state.reasoning):
            state.reasoning = reasoning
        state.in_reasoning = False
        state.status = "completed"
        events.append(
            self._emit(
                "message.completed",
                state,
                snapshot=self._snapshot(state),
                status="completed",
            )
        )
        if keep_open:
            # Late tokens in this turn still append; next turn must close_turn().
            self.active[normalized_source] = state
        else:
            self.active.pop(state.source, None)
        return events

    def interrupt(self, sources: Iterable[str] | None = None) -> list[dict[str, Any]]:
        """Close active message segments before an explicit tool boundary."""
        selected = set(sources or self.active.keys())
        events: list[dict[str, Any]] = []
        for source in list(self.active):
            if source not in selected:
                continue
            state = self.active.pop(source)
            state.in_reasoning = False
            state.status = "interrupted"
            events.append(
                self._emit(
                    "message.completed",
                    state,
                    snapshot=self._snapshot(state),
                    status="interrupted",
                )
            )
        return events

    def replay_after(self, last_seq: int) -> list[dict[str, Any]]:
        """Replay journal events or fall back to current snapshots after a gap."""
        if last_seq >= self.seq:
            return []
        journal = list(self.journal)
        if journal and last_seq >= int(journal[0]["seq"]) - 1:
            return [event for event in journal if int(event["seq"]) > last_seq]
        return [self._snapshot_event(state) for state in self.snapshots.values()]

    def resolve_final_message_id(self) -> str | None:
        """Last assistant hop that completed as pure text (not tool-interrupted)."""
        for state in reversed(list(self.latest_by_source.values())):
            if state.source in _USER_SOURCES:
                continue
            if state.status == "completed":
                return state.message_id
        for state in reversed(list(self.snapshots.values())):
            if state.source in _USER_SOURCES:
                continue
            if state.status == "completed":
                return state.message_id
        return None

    def emit_turn_ready(
        self,
        *,
        prompt: str = "",
        input_type: str = "text_input",
    ) -> dict[str, Any]:
        """Signal that the assistant turn finished and the chat can continue."""
        return self._emit_run_event(
            "turn.ready",
            status="ready",
            interaction={
                "kind": "continuation",
                "interaction_type": input_type,
                "prompt": prompt or "",
            },
            final_message_id=self.resolve_final_message_id(),
        )

    def emit_interaction_required(
        self,
        *,
        prompt: str,
        input_type: str = "approval",
        request_id: str | None = None,
    ) -> dict[str, Any]:
        """Signal a blocking interaction (approval / explicit prompt)."""
        return self._emit_run_event(
            "interaction.required",
            status="awaiting_input",
            interaction={
                "kind": "blocking",
                "interaction_type": input_type,
                "prompt": prompt or "",
                "request_id": request_id or str(uuid4()),
            },
        )

    def emit_agent_working(
        self,
        *,
        phase: str = "model",
        detail: str = "",
        source: str = "system",
    ) -> dict[str, Any]:
        """Signal that the backend is waiting on the agent (model/tool/orchestrator)."""
        return self._emit_run_event(
            "agent.working",
            status="active",
            source=source,
            working={
                "phase": phase,
                "detail": detail or "",
            },
        )

    def _emit_run_event(
        self,
        event: str,
        *,
        status: str,
        interaction: dict[str, Any] | None = None,
        working: dict[str, Any] | None = None,
        source: str = "system",
        final_message_id: str | None = None,
    ) -> dict[str, Any]:
        latest = next(iter(reversed(list(self.latest_by_source.values()))), None)
        self.seq += 1
        envelope: dict[str, Any] = {
            "type": "stream.v2",
            "protocol_version": PROTOCOL_VERSION,
            "event_id": str(uuid4()),
            "run_id": str(self.run_id),
            "stream_id": latest.stream_id if latest else str(uuid4()),
            "message_id": final_message_id
            or (latest.message_id if latest else str(uuid4())),
            "seq": self.seq,
            "event": event,
            "source": source,
            "status": status,
        }
        if interaction is not None:
            envelope["interaction"] = interaction
        if working is not None:
            envelope["working"] = working
        if final_message_id:
            envelope["final_message_id"] = final_message_id
        self.journal.append(envelope)
        return envelope

    def _snapshot(self, state: _MessageState) -> dict[str, Any]:
        return {
            "reasoning": state.reasoning,
            "content": state.content,
            "status": state.status,
        }

    def _snapshot_event(self, state: _MessageState) -> dict[str, Any]:
        return self._emit(
            "message.snapshot",
            state,
            snapshot=self._snapshot(state),
            status=state.status,
        )
