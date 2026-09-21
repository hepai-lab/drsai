"""Transport-neutral Runtime Control v1 service for the standalone bridge."""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import __version__
from .contracts import BRIDGE_SERVER_NAME, canonical_json_sha256, runtime_protocol_description
from .driver import NativeDriver, NativeRuntimeIdentity
from .oaep import OaepJournal
from .profiles import CompatibilityDecision
from .store import RuntimeAuthorityStore, RuntimeStoreError

if TYPE_CHECKING:
    from .approval import ApprovalCoordinator


class ControlError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class RuntimeBinding:
    runtime_id: str
    generation: int
    workspace_root: Path
    workspace_id: str
    workspace_fingerprint: str
    native_profile: str
    mapping_version: str

    def __post_init__(self) -> None:
        if not self.runtime_id or self.generation < 1 or not self.workspace_id:
            raise ValueError("Runtime binding identity is invalid")
        if len(self.workspace_fingerprint) != 64:
            raise ValueError("Workspace fingerprint must be SHA-256")
        root = self.workspace_root.expanduser().resolve(strict=False)
        if not root.is_absolute() or not root.is_dir():
            raise ValueError("Workspace root must be an existing absolute directory")
        object.__setattr__(self, "workspace_root", root)


class RuntimeControlService:
    """Implements control commands without importing the OpenDrSai product runtime."""

    def __init__(
        self,
        *,
        store: RuntimeAuthorityStore,
        journal: OaepJournal,
        driver: NativeDriver,
        native_identity: NativeRuntimeIdentity,
        compatibility: CompatibilityDecision,
        binding: RuntimeBinding,
        approvals: "ApprovalCoordinator | None" = None,
    ) -> None:
        self.store = store
        self.journal = journal
        self.driver = driver
        self.native_identity = native_identity
        self.compatibility = compatibility
        self.binding = binding
        self.approvals = approvals
        self._admitting = compatibility.available
        self._closed = False

    @property
    def available(self) -> bool:
        return self._admitting and not self._closed

    @staticmethod
    def _require_object(value: object, code: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise ControlError(code, "Control parameters must be an object")
        return dict(value)

    def initialize(self, requested_protocols: Mapping[str, Any] | None = None) -> dict[str, Any]:
        protocols = runtime_protocol_description()
        if requested_protocols is not None:
            requested = dict(requested_protocols)
            control = requested.get("control")
            if (
                not isinstance(control, Mapping)
                or control.get("version") != protocols["control"]["version"]
                or (
                    control.get("schema_sha256") is not None
                    and control.get("schema_sha256") != protocols["control"]["schema_sha256"]
                )
            ):
                raise ControlError("control_protocol_incompatible", "Runtime Control identity is incompatible")
            oaep = requested.get("oaep")
            if not isinstance(oaep, Mapping) or oaep.get("version") != protocols["oaep"]["version"]:
                raise ControlError("oaep_protocol_incompatible", "OAEP version is incompatible")
            requested_profiles = oaep.get("profiles")
            if not isinstance(requested_profiles, list) or not set(requested_profiles).intersection(
                protocols["oaep"]["profiles"]
            ):
                raise ControlError("oaep_profile_incompatible", "No common OAEP profile exists")
            if oaep.get("schema_sha256") != protocols["oaep"]["schema_sha256"]:
                raise ControlError("oaep_schema_incompatible", "OAEP schema digest is incompatible")
        profile = self.compatibility.profile
        return {
            "server_info": {"name": BRIDGE_SERVER_NAME, "version": __version__},
            "runtime_id": self.binding.runtime_id,
            "protocols": protocols,
            "native_runtime": {
                "name": self.native_identity.server_name,
                "version": self.native_identity.server_version,
                "protocol_profile": profile.profile_id if profile else None,
                "schema_sha256": self.native_identity.contract_sha256,
            },
            "mapping_version": self.binding.mapping_version,
            "generation": self.binding.generation,
            "capabilities": self._capabilities(),
            "availability": self.compatibility.state,
        }

    def _capabilities(self) -> list[str]:
        readable = ["runtime.health", "session.snapshot", "session.events", "session.events.stream"]
        if not self.compatibility.available:
            return readable
        return readable + [
            "session.create", "session.resume", "session.archive",
            "run.start", "run.cancel", "approval.respond", "runtime.shutdown",
        ]

    def health(self) -> dict[str, Any]:
        return {
            "runtime_id": self.binding.runtime_id,
            "status": "available" if self.available else ("stopped" if self._closed else "degraded"),
            "generation": self.binding.generation,
            "persistence": "sqlite-wal",
            "native": {
                "name": self.native_identity.server_name,
                "version": self.native_identity.server_version,
                "profile": self.compatibility.profile.profile_id if self.compatibility.profile else None,
            },
            "degraded_reason": None if self.compatibility.available else self.compatibility.reason,
        }

    def _require_admission(self) -> None:
        if self._closed:
            raise ControlError("runtime_stopped", "Runtime is stopped")
        if not self.compatibility.available:
            raise ControlError("native_profile_not_production", "Native compatibility profile is not production-ready")

    def _operation_identity(self, kind: str, key: str) -> str:
        return f"operation-{uuid.uuid5(uuid.NAMESPACE_URL, self.binding.runtime_id + ':' + kind + ':' + key).hex}"

    def _resource_identity(self, prefix: str, kind: str, key: str) -> str:
        return f"{prefix}-{uuid.uuid5(uuid.NAMESPACE_URL, self.binding.runtime_id + ':' + kind + ':' + key).hex}"

    def create_session(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._require_admission()
        value = dict(params)
        key = value.get("idempotency_key")
        if not isinstance(key, str) or not key:
            raise ControlError("idempotency_key_required", "session.create requires an idempotency key")
        expected = {
            "workspace_id": self.binding.workspace_id,
            "workspace_fingerprint": self.binding.workspace_fingerprint,
            "native_profile": self.binding.native_profile,
            "mapping_version": self.binding.mapping_version,
            "owner_profile": "bridge",
        }
        supplied = {name: value.get(name, default) for name, default in expected.items()}
        if supplied != expected:
            raise ControlError("session_binding_mismatch", "Session does not match the fixed Runtime binding")
        digest = canonical_json_sha256(supplied)
        session_id = self._resource_identity("session", "session.create", key)
        operation, created = self.store.prepare_operation(
            operation_kind="session.create",
            idempotency_key=key,
            request_digest=digest,
            generation=self.binding.generation,
            session_id=session_id,
            operation_id=self._operation_identity("session.create", key),
        )
        if not created:
            if operation["state"] != "completed":
                raise ControlError("operation_outcome_unknown", "Prior session.create did not converge")
            return dict(operation["result"])
        try:
            session = self.store.create_session(session_id=session_id, **expected)
            self.store.bind_native_session(
                session_id,
                native_session_id=session_id,
                native_runtime_version=self.native_identity.server_version,
                native_contract_sha256=self.native_identity.contract_sha256,
                generation=self.binding.generation,
            )
            self.journal.append(
                session_id,
                event_type="event.session.created",
                dedupe_key=f"control:{operation['operation_id']}:session.created",
                source={"backend": "deepseek-harness", "runtime_id": self.binding.runtime_id},
                data={"session": self._session_resource(session)},
            )
            result = {"session": self._session_resource(session)}
            self.store.transition_operation(operation["operation_id"], "completed", result=result)
            return result
        except Exception:
            self.store.transition_operation(operation["operation_id"], "outcome_unknown")
            raise

    async def resume_session(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._require_admission()
        value = dict(params)
        session_id = value.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            raise ControlError("session_id_required", "session.resume requires a Session id")
        session = self.store.require_session(session_id)
        expected = (
            self.binding.workspace_id,
            self.binding.workspace_fingerprint,
            self.binding.native_profile,
            self.binding.mapping_version,
            "bridge",
        )
        actual = tuple(session[name] for name in (
            "workspace_id", "workspace_fingerprint", "native_profile", "mapping_version", "owner_profile"
        ))
        if actual != expected or session["status"] != "active":
            raise ControlError("session_resume_incompatible", "Persisted Session binding is incompatible")
        binding = self.store.require_native_session_binding(session_id)
        if binding["native_runtime_version"] != self.native_identity.server_version:
            raise ControlError("session_native_profile_incompatible", "Native version changed for this Session")
        await self.driver.resume_session(session_id=session_id)
        history = await self.driver.session_history(session_id=session_id)
        return {
            "session": self._session_resource(session),
            "snapshot": self.journal.snapshot(session_id),
            "native_history": history,
        }

    def archive_session(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._require_admission()
        value = dict(params)
        session_id, key = value.get("session_id"), value.get("idempotency_key")
        if not isinstance(session_id, str) or not session_id or not isinstance(key, str) or not key:
            raise ControlError(
                "session_archive_identity_required",
                "session.archive requires Session and idempotency identities",
            )
        digest = canonical_json_sha256({"session_id": session_id})
        operation, created = self.store.prepare_operation(
            operation_kind="session.archive", idempotency_key=key, request_digest=digest,
            generation=self.binding.generation, session_id=session_id,
            operation_id=self._operation_identity("session.archive", key),
        )
        if not created:
            if operation["state"] != "completed":
                raise ControlError("operation_outcome_unknown", "Prior session.archive did not converge")
            return dict(operation["result"])
        try:
            session = self.store.archive_session(session_id)
            self.journal.append(
                session_id, event_type="event.session.archived",
                dedupe_key=f"control:{operation['operation_id']}:session.archived",
                source={"backend": "deepseek-harness", "runtime_id": self.binding.runtime_id},
                data={"session": self._session_resource(session)},
            )
            result = {"session": self._session_resource(session)}
            self.store.transition_operation(operation["operation_id"], "completed", result=result)
            return result
        except Exception:
            self.store.transition_operation(operation["operation_id"], "outcome_unknown")
            raise

    async def start_run(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._require_admission()
        value = dict(params)
        session_id, key = value.get("session_id"), value.get("idempotency_key")
        blocks = value.get("content_blocks")
        if not isinstance(session_id, str) or not session_id or not isinstance(key, str) or not key:
            raise ControlError("run_identity_required", "run.start requires Session and idempotency identities")
        if not isinstance(blocks, Sequence) or isinstance(blocks, (str, bytes)):
            raise ControlError("run_input_invalid", "Run content_blocks must be an array")
        normalized = [self._require_object(block, "run_input_invalid") for block in blocks]
        request = {"session_id": session_id, "content_blocks": normalized}
        digest = canonical_json_sha256(request)
        run_id = self._resource_identity("run", "run.start", key)
        operation, created = self.store.prepare_operation(
            operation_kind="run.start", idempotency_key=key, request_digest=digest,
            generation=self.binding.generation, session_id=session_id, run_id=run_id,
            operation_id=self._operation_identity("run.start", key),
        )
        if not created:
            if operation["state"] != "completed":
                raise ControlError("operation_outcome_unknown", "Prior run.start did not converge")
            return dict(operation["result"])
        run = self.store.create_run(session_id, input_digest=digest, run_id=run_id)
        self.journal.append(
            session_id, run_id=run_id, event_type="event.run.created",
            dedupe_key=f"control:{operation['operation_id']}:run.created",
            source={"backend": "deepseek-harness", "runtime_id": self.binding.runtime_id},
            data={"run_id": run_id},
        )
        self.store.transition_run(run_id, "starting")
        self.store.transition_operation(operation["operation_id"], "sent")
        try:
            receipt = await self.driver.start_run(session_id=session_id, content_blocks=normalized)
            if receipt.session_id != session_id:
                raise ControlError("native_session_receipt_mismatch", "Native receipt belongs to another Session")
            self.store.bind_native_run(
                run_id, native_message_id=receipt.message_id, generation=self.binding.generation
            )
            result = {"run_id": run_id, "status": "starting"}
            self.store.transition_operation(operation["operation_id"], "completed", result=result)
            return result
        except Exception:
            self.store.transition_operation(operation["operation_id"], "outcome_unknown")
            self.store.transition_run(run_id, "outcome_unknown")
            raise

    async def cancel_run(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._require_admission()
        value = dict(params)
        run_id = value.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise ControlError("run_id_required", "run.cancel requires a Run id")
        run = self.store.require_run(run_id)
        binding = self.store.require_native_run_binding(run_id)
        await self.driver.cancel_run(
            session_id=run["session_id"], message_id=binding["native_message_id"]
        )
        return {"run_id": run_id, "status": run["status"], "terminal": False}

    async def shutdown(self) -> dict[str, Any]:
        if self._closed:
            return {"status": "stopped"}
        self._admitting = False
        if self.approvals is not None:
            await self.approvals.close()
        await self.driver.close()
        self._closed = True
        return {"status": "stopped"}

    @staticmethod
    def _session_resource(session: Mapping[str, Any]) -> dict[str, Any]:
        value = {
            "id": session["session_id"], "workspace_id": session["workspace_id"],
            "status": session["status"], "backend": "deepseek-harness",
            "created_at": session["created_at"], "updated_at": session["updated_at"],
        }
        if session.get("title"):
            value["title"] = session["title"]
        return value

    async def dispatch(self, method: str, params: object | None = None) -> object:
        value = self._require_object(params or {}, "control_params_invalid")
        if method == "initialize":
            protocols = value.get("protocols")
            return self.initialize(protocols if isinstance(protocols, Mapping) else None)
        if method == "runtime.health":
            return self.health()
        if method == "session.create":
            return self.create_session(value)
        if method == "session.resume":
            return await self.resume_session(value)
        if method == "session.archive":
            return self.archive_session(value)
        if method == "run.start":
            return await self.start_run(value)
        if method == "run.cancel":
            return await self.cancel_run(value)
        if method == "approval.respond":
            self._require_admission()
            if self.approvals is None:
                raise ControlError("approval_unavailable", "Approval bridge is unavailable")
            approval_id, outcome = value.get("approval_id"), value.get("outcome")
            if not isinstance(approval_id, str) or not isinstance(outcome, str):
                raise ControlError("approval_response_invalid", "Approval response is invalid")
            return self.approvals.respond(approval_id=approval_id, outcome=outcome)
        if method == "session.snapshot":
            return self.journal.snapshot(str(value.get("session_id") or ""))
        if method == "session.events":
            return self.journal.event_page(
                str(value.get("session_id") or ""),
                after_sequence=int(value.get("after_sequence", 0)), limit=int(value.get("limit", 100)),
            )
        if method == "runtime.shutdown":
            return await self.shutdown()
        raise ControlError("method_not_found", "Runtime Control method is unsupported")
