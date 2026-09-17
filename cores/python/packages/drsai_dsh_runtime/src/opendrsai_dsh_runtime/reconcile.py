"""Restart reconciliation using exact profile identity and durable native history."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .driver import NativeRuntimeIdentity
from .jsonrpc import JsonRpcNotification
from .mapper import NativeFactProjector
from .store import RuntimeAuthorityStore, RuntimeStoreError


@dataclass(frozen=True)
class ReconciliationReport:
    session_id: str
    generation: int
    replayed_facts: int
    mapped_facts: int
    ignored_facts: int
    repaired_operations: int
    unresolved_operations: int
    quarantined_side_effects: int


class RuntimeReconciler:
    """Never resends an uncertain mutation; it only consumes authoritative facts."""

    def __init__(self, store: RuntimeAuthorityStore, projector: NativeFactProjector):
        self.store = store
        self.projector = projector

    def reconcile_session(
        self,
        session_id: str,
        *,
        native_identity: NativeRuntimeIdentity,
        generation: int,
        history: Iterable[JsonRpcNotification],
    ) -> ReconciliationReport:
        self.store.require_session(session_id)
        binding = self.store.promote_session_generation(
            session_id,
            native_runtime_version=native_identity.server_version,
            native_contract_sha256=native_identity.contract_sha256,
            new_generation=generation,
        )
        replayed = mapped = ignored = 0
        for fact in history:
            if fact.generation != generation:
                raise RuntimeStoreError("native_generation_stale", "History fact has the wrong generation")
            params = fact.params if isinstance(fact.params, dict) else {}
            if params.get("sessionId") != binding["native_session_id"]:
                raise RuntimeStoreError("native_history_session_mismatch", "History crossed a Session boundary")
            result = self.projector.project(fact)
            if result.disposition == "replayed":
                replayed += 1
            elif result.disposition == "mapped":
                mapped += 1
            else:
                ignored += 1
        repaired = self.reconcile_operations(session_id=session_id)
        quarantined = self.quarantine_unknown_side_effects(session_id=session_id)
        unresolved = sum(
            operation["session_id"] == session_id for operation in self.store.unresolved_operations()
        )
        return ReconciliationReport(
            session_id, generation, replayed, mapped, ignored, repaired, unresolved, quarantined
        )

    def quarantine_unknown_side_effects(self, *, session_id: str) -> int:
        """Freeze uncertain tool outcomes until native history supplies a result.

        No command or tool input is returned from this method, so recovery has
        no execution path that could blindly repeat an external side effect.
        """
        items = self.store.unsettled_side_effect_items(session_id)
        run_ids = {str(item["run_id"]) for item in items}
        for run_id in run_ids:
            run = self.store.require_run(run_id)
            if run["status"] in {"starting", "running", "waiting"}:
                self.store.transition_run(run_id, "outcome_unknown")
        return len(items)

    def reconcile_operations(self, *, session_id: str) -> int:
        repaired = 0
        for operation in self.store.unresolved_operations():
            if operation["session_id"] != session_id:
                continue
            kind, operation_id = operation["operation_kind"], operation["operation_id"]
            if kind == "run.start" and operation["run_id"]:
                try:
                    self.store.require_native_run_binding(operation["run_id"])
                except RuntimeStoreError as exc:
                    if exc.code != "native_run_unbound":
                        raise
                    if operation["state"] in {"sent", "acknowledged"}:
                        self.store.transition_operation(operation_id, "outcome_unknown")
                    continue
                run = self.store.require_run(operation["run_id"])
                self.store.transition_operation(
                    operation_id, "completed",
                    result={"run_id": run["run_id"], "status": run["status"]},
                )
                repaired += 1
            elif kind == "session.create":
                try:
                    session = self.store.require_session(session_id)
                    self.store.require_native_session_binding(session_id)
                except RuntimeStoreError:
                    continue
                self.store.transition_operation(
                    operation_id, "completed", result={"session_id": session["session_id"]}
                )
                repaired += 1
            elif kind == "session.archive":
                session = self.store.require_session(session_id)
                if session["status"] == "archived":
                    self.store.transition_operation(
                        operation_id, "completed", result={"session_id": session_id, "status": "archived"}
                    )
                    repaired += 1
        return repaired
