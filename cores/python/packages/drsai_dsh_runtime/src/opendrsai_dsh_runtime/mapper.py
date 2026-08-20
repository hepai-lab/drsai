"""Deterministic committed DSH SessionEvent to OAEP projection."""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from .jsonrpc import JsonRpcNotification
from .oaep import OaepJournal, OaepValidationError
from .store import RuntimeAuthorityStore, RuntimeStoreError

if TYPE_CHECKING:
    from .approval import ApprovalCoordinator


class NativeFactError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ProjectionResult:
    native_session_id: str
    source_sequence: int
    oaep_sequences: tuple[int, ...]
    disposition: str


_SUPPORTED = frozenset({
    "turn/start", "turn/end", "user/message", "assistant/chunk", "assistant/message",
    "tool/call", "tool/result", "session/title", "approval/asked", "approval/decided",
})
_REVIEWED_NO_OAEP = frozenset({
    "agent-preset/selected", "agent/inbox/spliced", "approval/policy",
    "compaction/end", "compaction/prune", "compaction/start", "compaction/summary", "feedback/record",
    "hook/invoked", "hook/result", "permission/preset", "request/context", "request/header",
    "llm/retry", "llm/retry-started", "plan/mode", "sandbox/mode", "session/end-seed",
    "session/title-llm-request", "step/end", "step/start",
    "web/deepseek-search-llm-request",
})
_PROFILE_FORBIDDEN = frozenset({
    "command/done", "command/run", "goal/change", "schedule/change", "subagent/descriptor", "todo/write",
    "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end", "tool-workflow/run-start",
    "tool/code-dispatch", "tool/code-dispatch-start",
})
_TERMINAL = {
    "completed": ("completed", "event.run.completed"),
    "aborted": ("cancelled", "event.run.cancelled"),
    "error": ("failed", "event.run.failed"),
    "blocked": ("failed", "event.run.failed"),
    "max-tokens": ("failed", "event.run.failed"),
    "interrupted": ("failed", "event.run.failed"),
}


class NativeFactProjector:
    """Projects only bridge-owned, generation-fenced, contiguous committed facts.

    ``turn/start`` opens a durable candidate. The following committed
    ``user/message.id`` must match a stored ``session/prompt.messageId`` before
    the Run is bound or reported started. Agent-wide ``idle`` is never used.
    """

    def __init__(
        self,
        store: RuntimeAuthorityStore,
        journal: OaepJournal,
        *,
        runtime_id: str,
        approvals: "ApprovalCoordinator | None" = None,
    ):
        self.store = store
        self.journal = journal
        self.runtime_id = runtime_id
        self.approvals = approvals

    def project(self, notification: JsonRpcNotification) -> ProjectionResult:
        if notification.method != "session.event" or not isinstance(notification.params, Mapping):
            raise NativeFactError("native_notification_invalid", "Expected a session.event object")
        params = dict(notification.params)
        native_session_id, raw_event = params.get("sessionId"), params.get("event")
        if not isinstance(native_session_id, str) or not native_session_id or not isinstance(raw_event, Mapping):
            raise NativeFactError("native_event_envelope_invalid", "Native SessionEvent envelope is invalid")
        event = dict(raw_event)
        event_type, sequence, time_ms, data = (
            event.get("type"), event.get("seq"), event.get("time"), event.get("data")
        )
        if (
            not isinstance(event_type, str) or not event_type
            or not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0
            or not isinstance(time_ms, (int, float)) or isinstance(time_ms, bool) or time_ms < 0
            or not isinstance(data, Mapping)
        ):
            raise NativeFactError("native_event_envelope_invalid", "Native SessionEvent fields are invalid")
        session_binding = self.store.resolve_native_session(
            native_session_id, generation=notification.generation
        )
        position = self.store.check_native_source_sequence(native_session_id, sequence)
        if position == "replay":
            return ProjectionResult(native_session_id, sequence, (), "replayed")
        if event_type in _REVIEWED_NO_OAEP:
            self.store.accept_native_source_sequence(native_session_id, sequence)
            return ProjectionResult(native_session_id, sequence, (), "reviewed_no_oaep")
        if event_type in _PROFILE_FORBIDDEN:
            raise NativeFactError(
                "native_event_profile_forbidden",
                "Native event belongs to a capability excluded from this production profile",
            )
        if event_type not in _SUPPORTED:
            if event.get("ignorable") is True:
                self.store.accept_native_source_sequence(native_session_id, sequence)
                return ProjectionResult(native_session_id, sequence, (), "ignored_compatible")
            raise NativeFactError("native_event_unknown_required", "Unknown required native event blocks projection")
        timestamp = datetime.fromtimestamp(float(time_ms) / 1000.0, tz=UTC).isoformat()
        emitted = self._map(
            session_id=session_binding["session_id"],
            native_session_id=native_session_id,
            generation=notification.generation,
            source_sequence=sequence,
            timestamp=timestamp,
            event_type=event_type,
            data=dict(data),
        )
        if not self.store.accept_native_source_sequence(native_session_id, sequence):
            raise NativeFactError("native_sequence_race", "Native source cursor changed during projection")
        return ProjectionResult(native_session_id, sequence, tuple(item["sequence"] for item in emitted), "mapped")

    def _source(self, native_session_id: str, source_sequence: int) -> dict[str, Any]:
        return {
            "backend": "deepseek-harness",
            "runtime_id": self.runtime_id,
            "backend_event_id": f"{native_session_id}:{source_sequence}",
            "mapping_version": "dsh-oaep/1",
        }

    @staticmethod
    def _identity(prefix: str, run_id: str, native_kind: str, native_id: str) -> str:
        return f"{prefix}-{uuid.uuid5(uuid.NAMESPACE_URL, run_id + ':' + native_kind + ':' + native_id).hex}"

    def _append(
        self,
        *,
        session_id: str,
        native_session_id: str,
        source_sequence: int,
        projection_index: int,
        timestamp: str,
        event_type: str,
        data: Mapping[str, Any],
        run_id: str | None = None,
        item_id: str | None = None,
    ) -> dict[str, Any]:
        return self.journal.append(
            session_id,
            run_id=run_id,
            item_id=item_id,
            event_type=event_type,
            dedupe_key=f"dsh:{native_session_id}:{source_sequence}:{projection_index}:{event_type}",
            source=self._source(native_session_id, source_sequence),
            data=data,
            timestamp=timestamp,
        )

    @staticmethod
    def _integer(data: Mapping[str, Any], key: str) -> int:
        value = data.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise NativeFactError("native_fact_invalid", f"Native fact has invalid {key}")
        return value

    def _run_for_turn(self, native_session_id: str, turn: int, generation: int) -> dict[str, Any]:
        return self.store.resolve_native_run(
            native_session_id=native_session_id,
            native_turn_id=str(turn),
            generation=generation,
        )

    def _map(
        self,
        *,
        session_id: str,
        native_session_id: str,
        generation: int,
        source_sequence: int,
        timestamp: str,
        event_type: str,
        data: dict[str, Any],
    ) -> list[dict[str, Any]]:
        if event_type in {"approval/asked", "approval/decided"}:
            if self.approvals is None:
                raise NativeFactError(
                    "native_approval_bridge_missing",
                    "Bridge-owned Session received approval audit without an approval answerer",
                )
            approval_id = data.get("id")
            if not isinstance(approval_id, str) or not approval_id:
                raise NativeFactError("native_approval_invalid", "Approval audit identity is invalid")
            if event_type == "approval/asked":
                tool_name, call_id, reason = data.get("toolName"), data.get("callId"), data.get("reason")
                if (
                    not isinstance(tool_name, str) or not tool_name
                    or (call_id is not None and (not isinstance(call_id, str) or not call_id))
                    or (reason is not None and not isinstance(reason, str))
                ):
                    raise NativeFactError("native_approval_invalid", "Approval ask audit is invalid")
                self.approvals.observe_committed_asked(
                    native_session_id=native_session_id, approval_id=approval_id,
                    tool_name=tool_name, call_id=call_id, reason=reason,
                )
            else:
                outcome = data.get("outcome")
                if not isinstance(outcome, str):
                    raise NativeFactError("native_approval_invalid", "Approval decision audit is invalid")
                self.approvals.observe_committed_decided(approval_id=approval_id, outcome=outcome)
            return []
        if event_type == "session/title":
            title = data.get("title")
            if not isinstance(title, str) or not title:
                raise NativeFactError("native_session_title_invalid", "Session title is invalid")
            session = self.store.update_session_title(session_id, title)
            resource = {
                "id": session_id, "workspace_id": session["workspace_id"], "title": title,
                "status": session["status"], "backend": "deepseek-harness",
                "created_at": session["created_at"], "updated_at": session["updated_at"],
            }
            return [self._append(
                session_id=session_id, native_session_id=native_session_id,
                source_sequence=source_sequence, projection_index=0, timestamp=timestamp,
                event_type="event.session.updated", data={"session": resource},
            )]
        if event_type == "turn/start":
            turn = self._integer(data, "turn")
            message_id = data.get("messageId")
            if message_id is None:
                self.store.open_native_turn(
                    native_session_id, native_turn_id=str(turn), generation=generation,
                    source_sequence=source_sequence,
                )
                return []
            # A future compatible wire may carry the receipt directly; accept
            # it under the same exact binding rule without changing OAEP.
            if not isinstance(message_id, str) or not message_id:
                raise NativeFactError("native_turn_receipt_invalid", "Turn receipt identity is invalid")
            self.store.open_native_turn(
                native_session_id, native_turn_id=str(turn), generation=generation,
                source_sequence=source_sequence,
            )
            binding = self.store.claim_open_native_turn(
                native_session_id, native_message_id=message_id, generation=generation
            )
            return self._start_bound_run(
                binding, session_id=session_id, native_session_id=native_session_id,
                source_sequence=source_sequence, timestamp=timestamp, turn=turn,
            )

        if event_type == "user/message":
            # DSH also logs plugin-authored runtime-context snapshots with the
            # user role so they enter model history. They are not client
            # prompts and must never be correlated to a Control Run receipt.
            source = data.get("source")
            if isinstance(source, Mapping) and source.get("kind") != "user":
                return []
            message_id = data.get("id")
            if not isinstance(message_id, str) or not message_id:
                raise NativeFactError("native_message_invalid", "User message identity is invalid")
            existing = self.store.resolve_native_run(
                native_session_id=native_session_id, native_message_id=message_id, generation=generation
            )
            if existing["native_turn_id"] is None:
                binding = self.store.claim_open_native_turn(
                    native_session_id, native_message_id=message_id, generation=generation
                )
                turn = int(binding["native_turn_id"])
                started = self._start_bound_run(
                    binding, session_id=session_id, native_session_id=native_session_id,
                    source_sequence=source_sequence, timestamp=timestamp, turn=turn,
                )
            else:
                binding = existing
                started = []
            run_id = binding["run_id"]
            item_id, emitted = self._ensure_message_item(
                session_id, run_id, generation, timestamp, native_kind="user-message",
                native_id=message_id, role="user", native_session_id=native_session_id,
                source_sequence=source_sequence,
            )
            current = self._current_item(item_id)
            item = {
                **current, "status": "completed", "updated_at": timestamp,
                "content": {"role": "user", "text": self._message_text(data)},
            }
            result = list(started) + list(emitted)
            result.append(self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=len(result), timestamp=timestamp, event_type="event.item.completed",
                run_id=run_id, item_id=item_id, data={"item": item},
            ))
            return result

        turn = self._integer(data, "turn")
        binding = self._run_for_turn(native_session_id, turn, generation)
        run_id = binding["run_id"]
        if event_type == "turn/end":
            reason = data.get("reason")
            kind = reason.get("kind") if isinstance(reason, Mapping) else None
            if kind not in _TERMINAL:
                raise NativeFactError("native_turn_reason_unknown", "Turn terminal reason is unsupported")
            status, oaep_type = _TERMINAL[str(kind)]
            self.store.transition_run(run_id, status, reason=str(kind))
            payload: dict[str, Any] = {"reason": dict(reason)}
            if status == "failed":
                payload["error"] = {
                    "code": f"dsh_turn_{kind}", "message": f"DeepSeek Harness turn ended: {kind}",
                    "retryable": False,
                }
            return [self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=0, timestamp=timestamp, event_type=oaep_type,
                run_id=run_id, data=payload,
            )]
        if event_type == "assistant/chunk":
            step = self._integer(data, "step")
            chunk = data.get("chunk")
            if not isinstance(chunk, Mapping):
                raise NativeFactError("native_chunk_invalid", "Assistant chunk is invalid")
            if chunk.get("type") != "text-delta":
                return []
            text = chunk.get("text")
            if not isinstance(text, str):
                raise NativeFactError("native_chunk_invalid", "Assistant text delta is invalid")
            item_id, created = self._ensure_message_item(
                session_id, run_id, generation, timestamp,
                native_kind="assistant-step", native_id=f"{turn}:{step}", role="assistant",
                native_session_id=native_session_id, source_sequence=source_sequence,
            )
            emitted = list(created)
            emitted.append(self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=len(emitted), timestamp=timestamp, event_type="event.item.delta",
                run_id=run_id, item_id=item_id,
                data={"delta": {"kind": "message.text.append", "text": text}},
            ))
            return emitted
        if event_type == "assistant/message":
            step = self._integer(data, "step")
            message = data.get("message")
            if not isinstance(message, Mapping) or not isinstance(message.get("id"), str):
                raise NativeFactError("native_message_invalid", "Assistant message is invalid")
            text = self._message_text(message)
            item_id, emitted = self._ensure_message_item(
                session_id, run_id, generation, timestamp,
                native_kind="assistant-step", native_id=f"{turn}:{step}", role="assistant",
                native_session_id=native_session_id, source_sequence=source_sequence,
            )
            self.store.bind_native_item(
                run_id, item_id=item_id, native_kind="assistant-message",
                native_item_id=str(message["id"]), generation=generation,
            )
            current = self._current_item(item_id)
            item = {
                **current, "status": "completed", "updated_at": timestamp,
                "content": {"role": "assistant", "text": text},
            }
            result = list(emitted)
            result.append(self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=len(result), timestamp=timestamp, event_type="event.item.completed",
                run_id=run_id, item_id=item_id, data={"item": item},
            ))
            return result
        if event_type == "tool/call":
            call_id, name, arguments = data.get("callId"), data.get("name"), data.get("arguments")
            if not all(isinstance(value, str) and value for value in (call_id, name, arguments)):
                raise NativeFactError("native_tool_call_invalid", "Tool call is invalid")
            try:
                parsed = json.loads(str(arguments))
            except json.JSONDecodeError:
                parsed = {"raw": arguments}
            if not isinstance(parsed, dict):
                parsed = {"value": parsed}
            item_id = self._identity("item", run_id, "tool-call", str(call_id))
            self.store.bind_native_item(
                run_id, item_id=item_id, native_kind="tool-call", native_item_id=str(call_id), generation=generation
            )
            item = self._tool_item(
                item_id, session_id, run_id, self.store.next_item_sequence(run_id), timestamp,
                "running", str(name), str(call_id), parsed, None,
            )
            return [
                self._append(
                    session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                    projection_index=0, timestamp=timestamp, event_type="event.item.created",
                    run_id=run_id, item_id=item_id, data={"item": {**item, "status": "pending"}},
                ),
                self._append(
                    session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                    projection_index=1, timestamp=timestamp, event_type="event.item.started",
                    run_id=run_id, item_id=item_id, data={"item": item},
                ),
            ]
        if event_type == "tool/result":
            message = data.get("message")
            if not isinstance(message, Mapping):
                raise NativeFactError("native_tool_result_invalid", "Tool result is invalid")
            call_id = message.get("toolCallId")
            if not isinstance(call_id, str) or not call_id:
                raise NativeFactError("native_tool_result_invalid", "Tool result call identity is invalid")
            item_binding = self.store.resolve_native_item(run_id, native_kind="tool-call", native_item_id=call_id)
            if item_binding is None:
                raise NativeFactError("native_tool_result_unbound", "Tool result has no bound call")
            item_id = item_binding["item_id"]
            current = self._current_item(item_id)
            content = dict(current["content"])
            content["result"] = self._message_text(message)
            item = {**current, "status": "failed" if data.get("error") else "completed", "updated_at": timestamp, "content": content}
            oaep_type = "event.item.failed" if data.get("error") else "event.item.completed"
            payload: dict[str, Any] = {"item": item}
            if data.get("error"):
                error = data["error"]
                payload["error"] = {
                    "code": str(error.get("code") or "dsh_tool_error") if isinstance(error, Mapping) else "dsh_tool_error",
                    "message": str(error.get("name") or "DeepSeek Harness tool failed") if isinstance(error, Mapping) else "DeepSeek Harness tool failed",
                    "retryable": False,
                }
            return [self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=0, timestamp=timestamp, event_type=oaep_type,
                run_id=run_id, item_id=item_id, data=payload,
            )]
        raise AssertionError(event_type)

    def _start_bound_run(
        self, binding: Mapping[str, Any], *, session_id: str, native_session_id: str,
        source_sequence: int, timestamp: str, turn: int,
    ) -> list[dict[str, Any]]:
        self.store.transition_run(str(binding["run_id"]), "running")
        return [self._append(
            session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
            projection_index=0, timestamp=timestamp, event_type="event.run.started",
            run_id=str(binding["run_id"]), data={"native_turn": turn},
        )]

    def _ensure_message_item(
        self, session_id: str, run_id: str, generation: int, timestamp: str, *,
        native_kind: str, native_id: str, role: str, native_session_id: str, source_sequence: int,
    ) -> tuple[str, list[dict[str, Any]]]:
        binding = self.store.resolve_native_item(run_id, native_kind=native_kind, native_item_id=native_id)
        if binding is not None:
            return str(binding["item_id"]), []
        item_id = self._identity("item", run_id, native_kind, native_id)
        self.store.bind_native_item(
            run_id, item_id=item_id, native_kind=native_kind, native_item_id=native_id, generation=generation
        )
        sequence = self.store.next_item_sequence(run_id)
        pending = self._message_item(item_id, session_id, run_id, sequence, timestamp, "pending", role, "")
        running = {**pending, "status": "running"}
        return item_id, [
            self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=0, timestamp=timestamp, event_type="event.item.created",
                run_id=run_id, item_id=item_id, data={"item": pending},
            ),
            self._append(
                session_id=session_id, native_session_id=native_session_id, source_sequence=source_sequence,
                projection_index=1, timestamp=timestamp, event_type="event.item.started",
                run_id=run_id, item_id=item_id, data={"item": running},
            ),
        ]

    def _current_item(self, item_id: str) -> dict[str, Any]:
        with self.store._lock:
            row = self.store._db.execute("SELECT item_json FROM oaep_items WHERE item_id=?", (item_id,)).fetchone()
        if row is None:
            raise OaepValidationError("oaep_item_projection_missing")
        return json.loads(row["item_json"])

    def _item_sequence(self, item_id: str) -> int:
        return int(self._current_item(item_id)["sequence"])

    def _message_item(
        self, item_id: str, session_id: str, run_id: str, sequence: int,
        timestamp: str, status: str, role: str, text: str,
    ) -> dict[str, Any]:
        return {
            "id": item_id, "session_id": session_id, "run_id": run_id, "type": "message",
            "status": status, "sequence": sequence, "created_at": timestamp, "updated_at": timestamp,
            "source": {"backend": "deepseek-harness", "runtime_id": self.runtime_id},
            "content": {"role": role, "text": text},
        }

    def _tool_item(
        self, item_id: str, session_id: str, run_id: str, sequence: int, timestamp: str,
        status: str, name: str, call_id: str, arguments: dict[str, Any], result: object,
    ) -> dict[str, Any]:
        return {
            "id": item_id, "session_id": session_id, "run_id": run_id, "type": "tool_call",
            "status": status, "sequence": sequence, "created_at": timestamp, "updated_at": timestamp,
            "source": {"backend": "deepseek-harness", "runtime_id": self.runtime_id},
            "content": {
                "tool_kind": "harness", "tool_name": name, "call_id": call_id,
                "arguments": arguments, "result": result,
            },
        }

    @staticmethod
    def _message_text(message: Mapping[str, Any]) -> str:
        content = message.get("content")
        if not isinstance(content, list):
            raise NativeFactError("native_message_invalid", "Message content is not an array")
        parts: list[str] = []
        for block in content:
            if isinstance(block, Mapping) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(str(block["text"]))
        return "".join(parts)
