"""Single-answerer approval bridge for a production DSH server-request extension."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from .oaep import OaepJournal
from .store import RuntimeAuthorityStore, RuntimeStoreError


class ApprovalProtocolError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ApprovalCoordinator:
    """Owns every approval for bridge-owned Sessions; first valid answer wins."""

    def __init__(
        self,
        store: RuntimeAuthorityStore,
        journal: OaepJournal,
        *,
        runtime_id: str,
        generation: int,
    ) -> None:
        self.store = store
        self.journal = journal
        self.runtime_id = runtime_id
        self.generation = generation
        self._waiters: dict[str, asyncio.Future[str]] = {}
        self._closed = False

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _identity(run_id: str, approval_id: str) -> str:
        return f"item-{uuid.uuid5(uuid.NAMESPACE_URL, run_id + ':approval:' + approval_id).hex}"

    async def handle_server_request(self, method: str, params: object | None) -> object:
        if method != "approval/request":
            raise ApprovalProtocolError("native_server_method_unsupported", "Native server request is unsupported")
        if self._closed or not isinstance(params, Mapping):
            return {"outcome": "unavailable"}
        value = dict(params)
        native_session_id = value.get("sessionId")
        approval_id = value.get("approvalId")
        tool_name = value.get("toolName")
        turn = value.get("turn")
        if (
            not isinstance(native_session_id, str) or not native_session_id
            or not isinstance(approval_id, str) or not approval_id
            or not isinstance(tool_name, str) or not tool_name
            or not isinstance(turn, int) or isinstance(turn, bool) or turn < 0
        ):
            raise ApprovalProtocolError("native_approval_invalid", "Native approval request is invalid")
        session_binding = self.store.resolve_native_session(native_session_id, generation=self.generation)
        run_binding = self.store.resolve_native_run(
            native_session_id=native_session_id, native_turn_id=str(turn), generation=self.generation
        )
        run = self.store.require_run(run_binding["run_id"])
        if run["session_id"] != session_binding["session_id"]:
            raise ApprovalProtocolError("native_approval_binding_mismatch", "Approval Run binding is invalid")
        call_id = value.get("callId")
        if call_id is not None and (not isinstance(call_id, str) or not call_id):
            raise ApprovalProtocolError("native_approval_invalid", "Approval call identity is invalid")
        reason = value.get("reason")
        if reason is not None and not isinstance(reason, str):
            raise ApprovalProtocolError("native_approval_invalid", "Approval reason is invalid")
        approval, created = self._ensure_approval(
            approval_id=approval_id, run=run, call_id=call_id, tool_name=tool_name, reason=reason,
        )
        if created:
            self._project_requested(approval)
        if approval["state"] == "answered":
            return {"outcome": approval["outcome"]}
        loop = asyncio.get_running_loop()
        waiter = self._waiters.get(approval_id)
        if waiter is None or waiter.done():
            waiter = loop.create_future()
            self._waiters[approval_id] = waiter
        try:
            return {"outcome": await asyncio.shield(waiter)}
        finally:
            if waiter.done():
                self._waiters.pop(approval_id, None)

    def observe_committed_asked(
        self,
        *,
        native_session_id: str,
        approval_id: str,
        tool_name: str,
        call_id: str | None,
        reason: str | None,
    ) -> dict[str, Any]:
        self.store.resolve_native_session(native_session_id, generation=self.generation)
        binding = self.store.resolve_active_native_run(native_session_id, generation=self.generation)
        run = self.store.require_run(binding["run_id"])
        approval, created = self._ensure_approval(
            approval_id=approval_id, run=run, call_id=call_id, tool_name=tool_name, reason=reason,
        )
        if created:
            self._project_requested(approval)
        return approval

    def observe_committed_decided(self, *, approval_id: str, outcome: str) -> dict[str, Any]:
        approval = self.store.require_approval(approval_id)
        if approval["state"] != "answered" or approval["outcome"] != outcome:
            raise RuntimeStoreError(
                "approval_authority_conflict",
                "Committed approval decision was not produced by the bridge answerer",
            )
        return approval

    def _ensure_approval(
        self,
        *,
        approval_id: str,
        run: Mapping[str, Any],
        call_id: str | None,
        tool_name: str,
        reason: str | None,
    ) -> tuple[dict[str, Any], bool]:
        item_id = self._identity(str(run["run_id"]), approval_id)
        return self.store.create_approval(
            approval_id=approval_id,
            session_id=str(run["session_id"]),
            run_id=str(run["run_id"]),
            item_id=item_id,
            native_call_id=call_id,
            tool_name=tool_name,
            reason=reason,
            generation=self.generation,
        )

    def _project_requested(self, approval: Mapping[str, Any]) -> None:
        run = self.store.require_run(str(approval["run_id"]))
        timestamp = str(approval["created_at"])
        related_item_id = None
        if approval.get("native_call_id"):
            binding = self.store.resolve_native_item(
                run["run_id"], native_kind="tool-call", native_item_id=str(approval["native_call_id"])
            )
            related_item_id = binding["item_id"] if binding else None
        content = {
            "interaction_type": "approval",
            "approval_id": approval["approval_id"],
            "operation": approval["tool_name"],
            "prompt": approval.get("reason") or f"Allow DeepSeek Harness tool {approval['tool_name']}?",
            "options": [
                {"id": "allowed-once", "label": "Allow once"},
                {"id": "rejected", "label": "Reject"},
                {"id": "cancelled", "label": "Cancel"},
            ],
            "related_item_id": related_item_id,
            "request_summary": {"tool_name": approval["tool_name"]},
        }
        item = {
            "id": approval["item_id"], "session_id": approval["session_id"], "run_id": approval["run_id"],
            "type": "interaction", "status": "pending",
            "sequence": self.store.next_item_sequence(str(approval["run_id"])),
            "created_at": timestamp, "updated_at": timestamp,
            "source": {"backend": "deepseek-harness", "runtime_id": self.runtime_id},
            "content": content,
        }
        source = {"backend": "deepseek-harness", "runtime_id": self.runtime_id}
        self.journal.append(
            str(approval["session_id"]), run_id=str(approval["run_id"]), item_id=str(approval["item_id"]),
            event_type="event.item.created", dedupe_key=f"approval:{approval['approval_id']}:created",
            source=source, data={"item": item}, timestamp=timestamp,
        )
        waiting = {**item, "status": "waiting"}
        self.journal.append(
            str(approval["session_id"]), run_id=str(approval["run_id"]), item_id=str(approval["item_id"]),
            event_type="event.item.updated", dedupe_key=f"approval:{approval['approval_id']}:waiting",
            source=source, data={"item": waiting}, timestamp=timestamp,
        )
        if run["status"] == "running":
            self.store.transition_run(run["run_id"], "waiting")
            self.journal.append(
                str(approval["session_id"]), run_id=str(approval["run_id"]),
                event_type="event.run.waiting", dedupe_key=f"approval:{approval['approval_id']}:run.waiting",
                source=source, data={"approval_id": approval["approval_id"]}, timestamp=timestamp,
            )

    def respond(self, *, approval_id: str, outcome: str) -> dict[str, Any]:
        approval, won = self.store.answer_approval(approval_id, outcome)
        self._project_answered(approval)
        waiter = self._waiters.get(approval_id)
        if waiter is not None and not waiter.done():
            waiter.set_result(outcome)
        return {"approval_id": approval_id, "outcome": outcome, "won": won}

    def _project_answered(self, approval: Mapping[str, Any]) -> None:
        with self.store._lock:
            row = self.store._db.execute(
                "SELECT item_json FROM oaep_items WHERE item_id=?", (approval["item_id"],)
            ).fetchone()
        if row is None:
            raise RuntimeStoreError("approval_projection_missing", "Approval Interaction projection is missing")
        item = json.loads(row["item_json"])
        if item["status"] not in {"completed", "failed", "cancelled"}:
            item = {
                **item,
                "status": "cancelled" if approval["outcome"] == "cancelled" else "completed",
                "updated_at": approval["updated_at"],
                "content": {**item["content"], "response": {"outcome": approval["outcome"]}},
            }
            event_type = "event.item.cancelled" if item["status"] == "cancelled" else "event.item.completed"
            self.journal.append(
                str(approval["session_id"]), run_id=str(approval["run_id"]), item_id=str(approval["item_id"]),
                event_type=event_type,
                dedupe_key=f"approval:{approval['approval_id']}:answered:{approval['outcome']}",
                source={"backend": "deepseek-harness", "runtime_id": self.runtime_id},
                data={"item": item}, timestamp=str(approval["updated_at"]),
            )
        run = self.store.require_run(str(approval["run_id"]))
        if run["status"] == "waiting" and not self.store.run_has_pending_approvals(run["run_id"]):
            self.store.transition_run(run["run_id"], "running")
            self.journal.append(
                str(approval["session_id"]), run_id=run["run_id"], event_type="event.run.resumed",
                dedupe_key=f"approval:{approval['approval_id']}:run.resumed",
                source={"backend": "deepseek-harness", "runtime_id": self.runtime_id},
                data={"approval_id": approval["approval_id"]}, timestamp=str(approval["updated_at"]),
            )

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for approval in self.store.pending_approvals():
            self.respond(approval_id=str(approval["approval_id"]), outcome="unavailable")
        await asyncio.sleep(0)
