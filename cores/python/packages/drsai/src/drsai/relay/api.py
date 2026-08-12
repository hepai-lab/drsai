from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import sqlite3
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Callable, Literal
from uuid import uuid4
from dataclasses import asdict

from fastapi import Depends, FastAPI, Header, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
import json

from drsai.platform_auth import context_from_bearer
from drsai.compatibility.relay_legacy_conversation import create_relay_legacy_conversation_router
from drsai.oaep.usage import ProtocolUsageTelemetry
from drsai.oaep.generated import OaepEvent, OaepEventPage, OaepSnapshot
from drsai.oaep.protocol import OAEPValidationError
from drsai.backend.runtime.observability import ResourceCorrelation, RuntimeObservability


LOGGER = logging.getLogger(__name__)


def relay_latency_correlation(
    runtime_id: str, workspace_id: str, session_id: str, event_id: str
) -> str:
    """Scope an opaque Event identity to its Relay tenant and resource boundary."""
    values = (runtime_id, workspace_id, session_id, event_id)
    if any(not isinstance(value, str) or not value or len(value) > 500 for value in values):
        raise ValueError("latency correlation identity is invalid")
    return hashlib.sha256("\0".join(values).encode("utf-8")).hexdigest()


def record_protocol_usage_safely(telemetry: ProtocolUsageTelemetry, protocol: str,
                                 runtime_version: object, reason: str) -> bool:
    try:
        telemetry.record(protocol, runtime_version, reason)
        return True
    except (OSError, sqlite3.Error):
        return False

from .models import (
    AccessGrantResult,
    AccessGrantCreateRequest,
    AccessGrantStatusResult,
    AssociationResult,
    AssociationPresenceRequest,
    PushRegistrationRequest,
    PushRegistrationResult,
    PushProviderReadiness,
    PushReadinessResult,
    AssociationDeviceKeyRotationRequest,
    AssociationAuthorizationShrinkRequest,
    AssociationRequest,
    ErrorEnvelope,
    HeartbeatRequest,
    RegistrationRequest,
    RegistrationResult,
    WorkspacePublishRequest,
    WorkspaceCatalogSyncRequest,
    WorkspaceCatalogSyncResult,
    Workspace,
    ResourceLifecycle,
)
from .registry import RelayRegistry, RelayRegistryError
from .runtime_domain import RuntimeAuthority
from .runtime_channel import RuntimeChannelHub
from .oaep_replay import OAEPReplayHub
from .notifications import NotificationDeliveryQueue, NotificationFanoutSink, NotificationOutbox
from .device_audit import DeviceActionAudit, DeviceActionKey
from .generated_contract import (
    GeneratedApprovalDecisionRecoveryResponse,
    GeneratedApprovalDecisionRequest,
    GeneratedApprovalProjection,
    GeneratedLatencyObservationRequest,
    GeneratedLatencyObservationResponse,
    GeneratedRunCreateRecoveryResponse,
    GeneratedRunCreateRequest,
    GeneratedRunProjection,
    GeneratedSessionCreateRecoveryResponse,
    GeneratedSessionCreateRequest,
    GeneratedSessionProjection,
    GeneratedSessionUpdateRequest,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


P5_PLATFORM_CONTRACT_SHA256 = "490afae079e65acf2344f8a5a0bdd662f13a1cd175177f3e7dd57a35fdc77050"


class _StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _OwopRequest(_StrictBody):
    version: str
    request_id: str
    correlation_id: str
    operation: str
    params: dict


class _RuntimeRename(_StrictBody):
    display_name: str


class _DeviceBoundSubject(str):
    device_id: str

    def __new__(cls, subject: str, device_id: str):
        value = str.__new__(cls, subject)
        value.device_id = device_id
        return value


class _ConversationLatencyClientObservation(_StrictBody):
    correlation_id: str = Field(min_length=1, max_length=500)
    operation_id: str = Field(min_length=1, max_length=500)
    stage: Literal["client_receive", "client_render"]
    duration_ms: float = Field(ge=0, le=300_000, allow_inf_nan=False)


class ProtocolDeletionRequirements(_StrictBody):
    observation_days: Literal[0]
    release_cycles: Literal[0]
    oaep_ratio: Literal[0.999]
    legacy_ratio: Literal[0.001]
    migration_ratio: Literal[1.0]
    fallback_error_ratio: Literal[0.001]


class ProtocolDeletionDecision(_StrictBody):
    schema_version: Literal["p5-protocol-deletion-decision/1"]
    status: Literal[
        "no_data", "history_gap", "insufficient_window", "threshold_failed", "eligible"
    ]
    data_start: date | None
    data_end: date | None
    observation_days: int = Field(ge=0)
    release_cycles: int = Field(ge=0)
    oaep_ratio: float = Field(ge=0, le=1)
    legacy_ratio: float = Field(ge=0, le=1)
    migration_ratio: float | None = Field(default=None, ge=0, le=1)
    fallback_error_ratio: float = Field(ge=0, le=1)
    gap_days: int = Field(ge=0)
    requirements: ProtocolDeletionRequirements
    eligible: bool

    @model_validator(mode="after")
    def validate_state(self) -> "ProtocolDeletionDecision":
        if self.eligible:
            if not (
                self.status == "eligible"
                and self.oaep_ratio >= 0.999
                and self.legacy_ratio < 0.001
                and self.migration_ratio == 1.0
                and self.fallback_error_ratio <= 0.001
            ):
                raise ValueError("protocol_deletion_decision_eligible_invalid")
        elif self.status == "eligible":
            raise ValueError("protocol_deletion_decision_status_invalid")
        if self.status in {"no_data", "history_gap", "insufficient_window"} and self.eligible:
            raise ValueError("protocol_deletion_decision_ineligible_state_invalid")
        if self.status == "no_data" and not (
            self.data_start is None
            and self.data_end is None
            and self.observation_days == 0
            and self.migration_ratio is None
            and self.gap_days == 0
        ):
            raise ValueError("protocol_deletion_decision_no_data_invalid")
        if self.status == "history_gap" and self.gap_days < 1:
            raise ValueError("protocol_deletion_decision_history_gap_invalid")
        return self


def create_relay_app(registry: RelayRegistry | None = None,
                     runtimes: dict[str, RuntimeAuthority] | None = None,
                     channels: RuntimeChannelHub | None = None,
                     principal_resolver: Callable[[Request], str] | None = None,
                     release_id: str | None = None,
                     conversation_latency_database: Path | None = None,
                     push_worker_running: bool = False) -> FastAPI:
    if not isinstance(push_worker_running, bool):
        raise TypeError("push_worker_running must be bool")
    store = registry or RelayRegistry()
    app = FastAPI(title="OpenDrSai Runtime Relay", version="2.0.0")
    app.state.registry = store
    authorities = runtimes or {}
    channel_hub = channels or RuntimeChannelHub()
    app.state.runtime_channels = channel_hub
    notification_outbox = NotificationOutbox()
    app.state.notification_outbox = notification_outbox
    oaep_replay = OAEPReplayHub()
    app.state.oaep_replay = oaep_replay
    telemetry_directory = tempfile.TemporaryDirectory(prefix="drsai-relay-telemetry-")
    app.state._telemetry_directory = telemetry_directory
    device_action_audit = DeviceActionAudit(
        path=Path(telemetry_directory.name) / "device-action-audit.sqlite3"
    )
    app.state.device_action_audit = device_action_audit
    configured_latency_database = conversation_latency_database
    if configured_latency_database is None:
        configured_value = os.environ.get("OPENDRSAI_CONVERSATION_LATENCY_DATABASE", "").strip()
        configured_latency_database = Path(configured_value) if configured_value else None
    if configured_latency_database is not None and not configured_latency_database.is_absolute():
        raise ValueError("conversation latency database path must be absolute")
    conversation_latency_shared = configured_latency_database is not None
    conversation_latency = RuntimeObservability(
        configured_latency_database
        if configured_latency_database is not None
        else Path(telemetry_directory.name) / "conversation-latency.sqlite3"
    )
    app.state.conversation_latency = conversation_latency
    app.state.conversation_latency_shared = conversation_latency_shared
    protocol_usage = ProtocolUsageTelemetry(Path(telemetry_directory.name) / "protocol-usage.sqlite3")
    app.state.protocol_usage = protocol_usage
    app.state.protocol_usage_write_failures = 0
    try:
        protocol_usage.record_observation_day()
    except (OSError, sqlite3.Error):
        app.state.protocol_usage_write_failures += 1
        LOGGER.warning("protocol_observation_day_write_failed")
    effective_release_id = release_id or os.environ.get("OPENDRSAI_RELEASE_ID")
    if effective_release_id:
        try:
            protocol_usage.record_release_cycle(effective_release_id)
        except (OSError, sqlite3.Error, ValueError):
            app.state.protocol_usage_write_failures += 1
            LOGGER.warning("protocol_release_cycle_write_failed")

    def observe_protocol(runtime_id: str, protocol: str, reason: str) -> None:
        if not record_protocol_usage_safely(
            protocol_usage, protocol, store.runtime_version(runtime_id), reason
        ):
            app.state.protocol_usage_write_failures += 1
            LOGGER.warning("protocol_usage_write_failed", extra={"protocol": protocol})
    notification_deliveries = NotificationDeliveryQueue(
        Path(telemetry_directory.name) / "notification-deliveries.sqlite3"
    )
    notification_fanout = NotificationFanoutSink(notification_deliveries, store.active_device_ids)
    app.state.notification_deliveries = notification_deliveries
    app.state.push_worker_running = push_worker_running
    oaep_replay.notification_sink = lambda runtime_id, workspace_id, session_id, event: (
        notification_outbox.accept(runtime_id, workspace_id, session_id, event),
        notification_fanout.accept(runtime_id, workspace_id, session_id, event),
    )

    @app.get("/v1/push/readiness", response_model=PushReadinessResult)
    async def push_readiness() -> PushReadinessResult:
        fcm_configured = "fcm" in store.supported_push_providers
        worker_running = app.state.push_worker_running
        return PushReadinessResult(
            ready=fcm_configured and worker_running,
            providers=PushProviderReadiness(fcm=fcm_configured),
            worker_running=worker_running,
        )

    def validated_oaep_snapshot(
        value: object, *, workspace_id: str, session_id: str
    ) -> GeneratedLatencyObservationResponse:
        if not isinstance(value, dict):
            raise RelayRegistryError("oaep_snapshot_invalid", "Runtime OAEP Snapshot is invalid")
        try:
            oaep_replay.protocol.validate_snapshot(value)
        except OAEPValidationError as exc:
            raise RelayRegistryError("oaep_snapshot_invalid", "Runtime OAEP Snapshot is invalid") from exc
        session = value.get("session")
        if not isinstance(session, dict) or session.get("id") != session_id or session.get("workspace_id") != workspace_id:
            raise RelayRegistryError("oaep_identity_mismatch", "Runtime OAEP Snapshot identity is invalid")
        return value

    def validated_oaep_page(value: object, *, session_id: str) -> dict:
        if not isinstance(value, dict):
            raise RelayRegistryError("oaep_event_page_invalid", "Runtime OAEP Event page is invalid")
        try:
            oaep_replay.protocol.validate_event_page(value)
        except OAEPValidationError as exc:
            raise RelayRegistryError("oaep_event_page_invalid", "Runtime OAEP Event page is invalid") from exc
        if any(event.get("session_id") != session_id for event in value["data"]):
            raise RelayRegistryError("oaep_identity_mismatch", "Runtime OAEP Event identity is invalid")
        return value

    @app.get("/v1/metrics/oaep")
    async def oaep_metrics():
        return oaep_replay.metrics()

    @app.get("/v1/metrics/conversation-latency", include_in_schema=False)
    @app.get("/v1/metrics/relay-latency")
    async def conversation_latency_metrics() -> dict:
        report = conversation_latency.conversation_latency_report()
        return {
            **report,
            "aggregation_scope": "shared" if conversation_latency_shared else "process",
            "multi_worker_ready": conversation_latency_shared and report["ready"],
        }

    @app.get("/v1/metrics/protocol-usage")
    async def protocol_usage_metrics() -> dict:
        return protocol_usage.report()

    @app.get(
        "/v1/metrics/protocol-usage/deletion-decision",
        response_model=ProtocolDeletionDecision,
        openapi_extra={"x-p5-platform-contract-sha256": P5_PLATFORM_CONTRACT_SHA256},
    )
    async def protocol_usage_deletion_decision() -> ProtocolDeletionDecision:
        return ProtocolDeletionDecision.model_validate(protocol_usage.deletion_decision())

    workspace_sync_tasks: dict[str, asyncio.Task[WorkspaceCatalogSyncResult]] = {}

    def oidc_subject_base(request: Request) -> str:
        if principal_resolver is not None:
            subject = principal_resolver(request)
            if not subject:
                raise RelayRegistryError("oidc_auth_invalid", "Authenticated Principal is missing")
            return subject
        try:
            return context_from_bearer(request.headers.get("authorization"), "").subject
        except ValueError as exc:
            code = str(exc)
            raise RelayRegistryError("oidc_auth_invalid", f"OIDC Principal is invalid: {code}",
                                     retryable=code in {"token_expired", "oidc_verification_unavailable"}) from exc

    async def device_subject(request: Request, subject: str = Depends(oidc_subject_base)) -> str:
        # A custom principal resolver is the explicit unit/service-test seam.
        # Production bearer traffic additionally proves possession of the
        # Android key enrolled with its association.
        if principal_resolver is not None and not request.headers.get("x-relay-device-signature"):
            return subject
        authorization = request.headers.get("authorization", "")
        if not authorization.lower().startswith("bearer "):
            raise RelayRegistryError("oidc_auth_invalid", "OIDC bearer token is missing")
        headers = {
            "device_id": request.headers.get("x-relay-device-id"),
            "timestamp": request.headers.get("x-relay-device-timestamp"),
            "nonce": request.headers.get("x-relay-device-nonce"),
            "signature": request.headers.get("x-relay-device-signature"),
        }
        if any(not value for value in headers.values()):
            raise RelayRegistryError("device_proof_required", "Device-bound request proof is required")
        device_id = store.verify_device_request(
            subject,
            str(headers["device_id"]),
            runtime_id=request.path_params.get("runtime_id"),
            method=request.method,
            path=request.url.path,
            query=request.url.query,
            body=await request.body(),
            timestamp=str(headers["timestamp"]),
            nonce=str(headers["nonce"]),
            signature=str(headers["signature"]),
            access_token=authorization.split(" ", 1)[1],
        )
        return _DeviceBoundSubject(subject, device_id)

    # Keep the established dependency name for all protected catalog/proxy
    # routes while allowing first-time association to use OIDC + grant + the
    # public key carried by its body.
    oidc_subject = device_subject

    def authority(runtime_id: str) -> RuntimeAuthority:
        if runtime_id not in authorities:
            raise RelayRegistryError("runtime_unavailable", "Runtime control channel is unavailable", retryable=True)
        return authorities[runtime_id]

    def authorize_workspace(
        subject: str, runtime_id: str, workspace_id: str, permission: str = "read"
    ) -> None:
        store.authorize_workspace(subject, runtime_id, workspace_id, permission)

    async def runtime_call(runtime_id: str, operation: str, *args, **kwargs):
        local = authorities.get(runtime_id)
        if local is not None:
            kwargs.pop("_authorization", None)
            return getattr(local, operation)(*args, **kwargs)
        return await channel_hub.request(runtime_id, operation, {"args": list(args), "kwargs": kwargs})

    app.include_router(create_relay_legacy_conversation_router(
        oidc_subject=device_subject,
        authorize_workspace=authorize_workspace,
        runtime_call=runtime_call,
        protocol_observer=observe_protocol,
    ))

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "conversation-latency",
        status_code=204,
        include_in_schema=False,
    )
    async def record_client_conversation_latency(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        body: _ConversationLatencyClientObservation,
        x_subject: str = Depends(oidc_subject),
    ) -> None:
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if body.stage not in {"client_receive", "client_render"}:
            raise RelayRegistryError(
                "latency_stage_forbidden", "Client cannot report this latency stage"
            )
        if body.correlation_id != body.operation_id or not await oaep_replay.contains_event(
            runtime_id, session_id, body.correlation_id
        ):
            raise RelayRegistryError(
                "latency_event_not_found", "Latency Event was not accepted by Relay"
            )
        scoped_correlation = relay_latency_correlation(
            runtime_id, workspace_id, session_id, body.correlation_id
        )
        conversation_latency.record_conversation_latency(
            body.stage,
            body.duration_ms,
            ResourceCorrelation(
                scoped_correlation,
                scoped_correlation,
                runtime_id=runtime_id,
                workspace_id=workspace_id,
                session_id=session_id,
            ),
            {"protocol": "oaep/1", "client": "android"},
        )

    def client_latency_observation(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        event_id: str,
    ) -> GeneratedLatencyObservationResponse:
        scoped = relay_latency_correlation(runtime_id, workspace_id, session_id, event_id)
        observations = conversation_latency.conversation_latency_observations(scoped)
        stages = {str(item["stage"]): item["duration_ms"] for item in observations}
        required = {"client_receive", "client_render"}
        ready = required.issubset(stages)
        return GeneratedLatencyObservationResponse(
            ready=ready,
            stages_present=sorted(stages),
            latencies_ms={
                "client_receive_to_render": int(round(stages["client_render"])),
            } if ready else None,
        )

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "events/{event_id}/latency-observation",
        response_model=GeneratedLatencyObservationResponse,
    )
    async def record_latency_observation(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        event_id: str,
        body: GeneratedLatencyObservationRequest,
        x_subject: str = Depends(oidc_subject),
    ) -> GeneratedLatencyObservationResponse:
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if body.render_at_ms < body.client_receive_at_ms:
            raise RelayRegistryError(
                "latency_observation_invalid", "Render timestamp precedes receive timestamp"
            )
        if not await oaep_replay.contains_event(runtime_id, session_id, event_id):
            raise RelayRegistryError(
                "latency_event_not_found", "Latency Event was not accepted by Relay"
            )
        scoped = relay_latency_correlation(runtime_id, workspace_id, session_id, event_id)
        correlation = ResourceCorrelation(
            scoped,
            scoped,
            runtime_id=runtime_id,
            workspace_id=workspace_id,
            session_id=session_id,
        )
        dimensions = {"protocol": "oaep/1", "client": "android"}
        conversation_latency.record_conversation_latency(
            "client_receive", 0.0, correlation, dimensions
        )
        conversation_latency.record_conversation_latency(
            "client_render",
            float(body.render_at_ms - body.client_receive_at_ms),
            correlation,
            dimensions,
        )
        return client_latency_observation(runtime_id, workspace_id, session_id, event_id)

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/"
        "events/{event_id}/latency-observation",
        response_model=GeneratedLatencyObservationResponse,
    )
    async def get_latency_observation(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        event_id: str,
        x_subject: str = Depends(oidc_subject),
    ) -> GeneratedLatencyObservationResponse:
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if not await oaep_replay.contains_event(runtime_id, session_id, event_id):
            raise RelayRegistryError(
                "latency_event_not_found", "Latency Event was not accepted by Relay"
            )
        return client_latency_observation(runtime_id, workspace_id, session_id, event_id)

    def json_dataclass(value):
        if isinstance(value, dict):
            return value
        result = asdict(value)
        for key, item in list(result.items()):
            if hasattr(item, "isoformat"):
                result[key] = item.isoformat()
            elif hasattr(item, "value"):
                result[key] = item.value
            elif isinstance(item, frozenset):
                result[key] = sorted(item)
            elif isinstance(item, tuple):
                result[key] = list(item)
        return result

    @app.exception_handler(RelayRegistryError)
    async def registry_error(request: Request, exc: RelayRegistryError) -> JSONResponse:
        correlation_id = request.headers.get("x-correlation-id", str(uuid4()))
        error = ErrorEnvelope(code=exc.code, message=exc.message, correlation_id=correlation_id,
                              retryable=exc.retryable, details=exc.details, source=exc.source)
        status = 503 if exc.code in {"host_offline", "catalog_sync_timeout", "push_provider_unavailable"} else 409 if (
            exc.code in {"stale_runtime_generation", "cursor_expired", "push_registration_stale",
                         "push_registration_conflict"}
        ) else 401 if exc.code in {
            "oidc_auth_invalid", "runtime_auth_invalid", "device_proof_required",
            "device_proof_invalid", "device_proof_expired", "device_proof_replay",
        } else 403 if (
            exc.code.endswith("forbidden") or exc.code in {
                "association_required", "runtime_permission_denied",
            }
        ) else 404 if exc.code in {
            "runtime_not_found", "access_grant_not_found", "association_not_found",
            "session_not_found", "run_not_found", "approval_not_found", "push_registration_not_found",
        } else 400
        return JSONResponse(status_code=status, content=error.model_dump(mode="json"))

    @app.get("/v1/admin/registration-code")
    async def issue_registration_code() -> dict[str, str]:
        return {"code": store.issue_registration_code()}

    @app.post("/v1/runtimes/register", response_model=RegistrationResult)
    async def register(body: RegistrationRequest, x_registration_code: str = Header()) -> RegistrationResult:
        if body.idempotency_key is None:
            raise RelayRegistryError("idempotency_key_required", "Registration requires idempotency_key")
        runtime_id, token = store.register(x_registration_code, body.display_name, body.version, body.public_key,
                                           body.idempotency_key)
        return RegistrationResult(runtime_id=runtime_id, registration_token=token)

    @app.post("/v1/runtimes/{runtime_id}/access-grants", response_model=AccessGrantResult)
    async def access_grant(
        runtime_id: str,
        body: AccessGrantCreateRequest | None = None,
        x_runtime_token: str = Header(),
    ) -> AccessGrantResult:
        request = body or AccessGrantCreateRequest()
        grant_id, code, expires_at = store.issue_access_grant(
            runtime_id,
            x_runtime_token,
            workspace_scope=request.workspace_scope,
            workspace_ids=request.workspace_ids,
            permissions=request.permissions,
        )
        return AccessGrantResult(grant_id=grant_id, code=code, expires_at=expires_at, status="pending")

    @app.get("/v1/runtimes/{runtime_id}/access-grants/{grant_id}", response_model=AccessGrantStatusResult)
    async def access_grant_status(runtime_id: str, grant_id: str,
                                  x_runtime_token: str = Header()) -> AccessGrantStatusResult:
        status, expires_at = store.access_grant_status(runtime_id, x_runtime_token, grant_id)
        return AccessGrantStatusResult(
            grant_id=grant_id,
            expires_at=expires_at,
            status=status,
            subject_summary=store.access_grant_subject_summary(
                runtime_id, x_runtime_token, grant_id
            ),
        )

    @app.delete("/v1/runtimes/{runtime_id}/access-grants/{grant_id}", response_model=AccessGrantStatusResult)
    async def revoke_access_grant(runtime_id: str, grant_id: str,
                                  x_runtime_token: str = Header()) -> AccessGrantStatusResult:
        status, expires_at = store.revoke_access_grant(runtime_id, x_runtime_token, grant_id)
        return AccessGrantStatusResult(
            grant_id=grant_id,
            expires_at=expires_at,
            status=status,
            subject_summary=store.access_grant_subject_summary(
                runtime_id, x_runtime_token, grant_id
            ),
        )

    @app.post("/v1/associations")
    async def associate(body: AssociationRequest, x_subject: str = Depends(oidc_subject_base)) -> dict[str, str]:
        return {
            "runtime_id": store.associate(
                x_subject,
                body.code,
                body.device_id,
                body.device_name,
                body.device_public_key,
                body.workspace_scope,
                body.workspace_ids,
                body.permissions,
            )
        }

    @app.delete("/v1/associations/{runtime_id}", response_model=AssociationResult)
    async def revoke_user_association(
        runtime_id: str,
        x_subject: str = Depends(oidc_subject),
        x_relay_device_id: str = Header(),
    ) -> AssociationResult:
        result = store.revoke_association(
            x_subject,
            runtime_id,
            x_relay_device_id,
        )
        await oaep_replay.invalidate_runtime(runtime_id)
        return AssociationResult.model_validate(result)

    @app.post("/v1/associations/{runtime_id}/presence", response_model=AssociationResult)
    async def record_user_association_presence(
        runtime_id: str,
        body: AssociationPresenceRequest,
        x_subject: str = Depends(oidc_subject),
        x_relay_device_id: str = Header(),
    ) -> AssociationResult:
        return AssociationResult.model_validate(
            store.record_device_presence(
                x_subject,
                runtime_id,
                x_relay_device_id,
                accessing=body.accessing,
            )
        )

    @app.get(
        "/v1/runtimes/{runtime_id}/associations",
        response_model=list[AssociationResult],
    )
    async def runtime_associations(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> list[AssociationResult]:
        return [
            AssociationResult.model_validate(item)
            for item in store.list_associations(runtime_id, x_runtime_token)
        ]

    @app.delete(
        "/v1/runtimes/{runtime_id}/associations/{association_id}",
        response_model=AssociationResult,
    )
    async def revoke_runtime_association(
        runtime_id: str,
        association_id: str,
        x_runtime_token: str = Header(),
    ) -> AssociationResult:
        result = store.revoke_runtime_association(
            runtime_id, x_runtime_token, association_id
        )
        await oaep_replay.invalidate_runtime(runtime_id)
        return AssociationResult.model_validate(result)

    @app.patch(
        "/v1/runtimes/{runtime_id}/associations/{association_id}",
        response_model=AssociationResult,
    )
    async def shrink_runtime_association_authorization(
        runtime_id: str,
        association_id: str,
        body: AssociationAuthorizationShrinkRequest,
        x_runtime_token: str = Header(),
    ) -> AssociationResult:
        result = store.shrink_association_authorization(
            runtime_id,
            x_runtime_token,
            association_id,
            workspace_scope=body.workspace_scope,
            workspace_ids=body.workspace_ids,
            permissions=body.permissions,
        )
        await oaep_replay.invalidate_runtime(runtime_id)
        return AssociationResult.model_validate(result)

    @app.delete("/v1/runtimes/{runtime_id}/enrollment")
    async def revoke_runtime_enrollment(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> dict[str, str | None]:
        result = store.revoke_enrollment(runtime_id, x_runtime_token)
        await oaep_replay.invalidate_runtime(runtime_id)
        return result

    @app.post("/v1/runtimes/{runtime_id}/enrollment/pause")
    async def pause_runtime_enrollment(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> dict[str, str | None]:
        result = store.set_enrollment_paused(runtime_id, x_runtime_token, paused=True)
        await oaep_replay.invalidate_runtime(runtime_id)
        return result

    @app.post("/v1/runtimes/{runtime_id}/enrollment/resume")
    async def resume_runtime_enrollment(
        runtime_id: str,
        x_runtime_token: str = Header(),
    ) -> dict[str, str | None]:
        return store.set_enrollment_paused(runtime_id, x_runtime_token, paused=False)

    @app.post("/v1/runtime-connections/{runtime_id}/heartbeat")
    async def heartbeat(runtime_id: str, body: HeartbeatRequest, x_runtime_token: str = Header()):
        return store.heartbeat(runtime_id, x_runtime_token, instance_id=body.instance_id, version=body.version,
                               capabilities=body.capabilities, backend_health=body.backend_health,
                               nonce=body.nonce, signature=body.signature)

    @app.put("/v1/runtime-connections/{runtime_id}/workspaces", status_code=204)
    async def publish_workspaces(runtime_id: str, body: WorkspacePublishRequest, x_runtime_token: str = Header()):
        store.publish_workspaces(runtime_id, x_runtime_token, body.workspaces)

    async def sync_workspace_catalog_once(
        runtime_id: str,
        subject: str,
    ) -> WorkspaceCatalogSyncResult:
        store.identity(subject, runtime_id)
        response, generation = await channel_hub.request_http_current(
            runtime_id,
            "GET",
            "/v1/workspaces?include_closed=true",
            timeout_code="catalog_sync_timeout",
        )
        body = response.get("body") if isinstance(response, dict) else None
        rows = body.get("data") if isinstance(body, dict) else None
        if not isinstance(rows, list):
            raise RelayRegistryError("workspace_catalog_sync_invalid", "Runtime returned an invalid Workspace Catalog",
                                     source="runtime")
        try:
            workspaces = [Workspace.model_validate(row) for row in rows]
        except ValidationError as exc:
            raise RelayRegistryError("workspace_catalog_sync_invalid",
                                     "Runtime returned an invalid Workspace Catalog",
                                     source="runtime") from exc
        if any(item.runtime_id != runtime_id for item in workspaces):
            raise RelayRegistryError("workspace_scope_mismatch", "Workspace belongs to another runtime")
        if not await channel_hub.is_current(runtime_id, generation):
            raise RelayRegistryError("stale_runtime_generation", "Runtime generation changed during Workspace sync",
                                     retryable=True, source="runtime")
        store.replace_workspace_projection(runtime_id, workspaces)
        active_items = [
            item
            for item in workspaces
            if item.lifecycle == ResourceLifecycle.ACTIVE
        ]
        return WorkspaceCatalogSyncResult(
            runtime_id=runtime_id,
            catalog_revision=max(
                [item.revision for item in workspaces],
                default=0,
            ),
            items=active_items,
        )

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/sync",
        response_model=WorkspaceCatalogSyncResult,
    )
    async def sync_workspaces(
        runtime_id: str,
        body: WorkspaceCatalogSyncRequest,
        x_subject: str = Depends(oidc_subject),
    ) -> WorkspaceCatalogSyncResult:
        store.identity(x_subject, runtime_id)
        task = workspace_sync_tasks.get(runtime_id)
        if task is None or task.done():
            task = asyncio.create_task(sync_workspace_catalog_once(
                runtime_id,
                x_subject,
            ))
            workspace_sync_tasks[runtime_id] = task
        try:
            return await task
        finally:
            if workspace_sync_tasks.get(runtime_id) is task and task.done():
                workspace_sync_tasks.pop(runtime_id, None)

    @app.get("/v1/runtimes")
    async def list_runtimes(x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                            limit: int = Query(20, ge=1, le=100), query: str | None = None):
        items, next_cursor = store.list_runtimes(x_subject, cursor=cursor, limit=limit, query=query)
        return {"items": [item.model_dump(mode="json") for item in items], "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/runtime")
    async def identity(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        return store.identity(x_subject, runtime_id)

    @app.patch("/v1/runtimes/{runtime_id}")
    async def rename_runtime(
        runtime_id: str,
        body: _RuntimeRename,
        x_subject: str = Depends(oidc_subject),
    ) -> dict[str, str]:
        return store.rename_runtime(x_subject, runtime_id, body.display_name)

    @app.get("/v1/runtimes/{runtime_id}/capabilities")
    async def capabilities(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        return store.capabilities(x_subject, runtime_id)

    @app.get("/v1/runtimes/{runtime_id}/workspaces")
    async def workspaces(runtime_id: str, x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                         limit: int = Query(20, ge=1, le=100), query: str | None = None,
                         lifecycle: ResourceLifecycle | None = ResourceLifecycle.ACTIVE):
        items, next_cursor = store.list_workspaces(
            x_subject, runtime_id, cursor=cursor, limit=limit, query=query, lifecycle=lifecycle)
        return {"items": [item.model_dump(mode="json") for item in items], "next_cursor": next_cursor}

    @app.get("/v1/runtimes/{runtime_id}/agent-definitions")
    async def agent_definitions(runtime_id: str, x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        rows = await runtime_call(runtime_id, "list_agent_definitions")
        return {"items": [json_dataclass(item) for item in rows]}

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions")
    async def sessions(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject), cursor: str | None = None,
                       limit: int = Query(20, ge=1, le=100), query: str | None = None,
                       lifecycle: ResourceLifecycle = ResourceLifecycle.ACTIVE):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows, next_cursor = await runtime_call(runtime_id, "list_sessions_for_subject", x_subject, workspace_id,
                                               cursor=cursor, limit=limit, query=query, lifecycle=lifecycle)
        return {"items": [json_dataclass(item) for item in rows], "next_cursor": next_cursor}

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        response_model=GeneratedSessionProjection,
    )
    async def create_session(runtime_id: str, workspace_id: str, body: GeneratedSessionCreateRequest,
                             x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id, "send")
        item = await runtime_call(runtime_id, "create_session", x_subject, workspace_id, title=body.title,
            definition_id=body.agent_definition_id, definition_version=body.agent_definition_version,
            idempotency_key=body.idempotency_key)
        return json_dataclass(item)

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        response_model=GeneratedSessionProjection,
    )
    async def session(runtime_id: str, workspace_id: str, session_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        await runtime_call(runtime_id, "authorize_session", x_subject, workspace_id, session_id)
        return json_dataclass(await runtime_call(runtime_id, "get_session", workspace_id, session_id))

    @app.patch(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        response_model=GeneratedSessionProjection,
    )
    async def update_session(runtime_id: str, workspace_id: str, session_id: str, body: GeneratedSessionUpdateRequest,
                             x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id, "send")
        if body.title is None and body.lifecycle is None:
            raise RelayRegistryError("session_update_empty", "Session update requires title or lifecycle")
        return json_dataclass(await runtime_call(runtime_id, "update_session", x_subject, workspace_id, session_id,
            title=body.title, lifecycle=body.lifecycle))

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs")
    async def runs(runtime_id: str, workspace_id: str, session_id: str, x_subject: str = Depends(oidc_subject),
                   cursor: str | None = None, limit: int = Query(20, ge=1, le=100)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows, next_cursor = await runtime_call(runtime_id, "list_runs_for_subject", x_subject, workspace_id,
                                               session_id, cursor=cursor, limit=limit)
        return {"items": [json_dataclass(item) for item in rows], "next_cursor": next_cursor}

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot",
        response_model=OaepSnapshot,
    )
    async def oaep_snapshot(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        x_subject: str = Depends(oidc_subject),
        cursor: str | None = None,
        limit: int = Query(100, ge=1, le=500),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        observe_protocol(runtime_id, "oaep", "selected")
        return validated_oaep_snapshot(
            await runtime_call(
                runtime_id, "oaep_snapshot_for_subject", x_subject, workspace_id, session_id,
                cursor=cursor, limit=limit,
            ),
            workspace_id=workspace_id,
            session_id=session_id,
        )

    @app.post(
        "/v1/associations/{runtime_id}/device-key/rotate",
        response_model=AssociationResult,
    )
    async def rotate_user_association_device_key(
        runtime_id: str,
        body: AssociationDeviceKeyRotationRequest,
        request: Request,
        x_subject: str = Depends(device_subject),
    ) -> AssociationResult:
        return AssociationResult.model_validate(
            store.rotate_association_device_key(
                x_subject,
                runtime_id,
                request.headers.get("x-relay-device-id", ""),
                body.new_device_public_key,
            )
        )

    @app.put(
        "/v1/associations/{runtime_id}/push-registration",
        response_model=PushRegistrationResult,
    )
    async def upsert_user_push_registration(
        runtime_id: str,
        body: PushRegistrationRequest,
        x_subject: str = Depends(oidc_subject),
    ) -> PushRegistrationResult:
        device_id = getattr(x_subject, "device_id", None)
        if not device_id:
            raise RelayRegistryError("device_proof_required", "Device-bound request proof is required")
        return PushRegistrationResult.model_validate(store.upsert_push_registration(
            str(x_subject), runtime_id, str(device_id), body.provider, body.token, body.generation,
        ))

    @app.delete(
        "/v1/associations/{runtime_id}/push-registration",
        response_model=PushRegistrationResult,
    )
    async def revoke_user_push_registration(
        runtime_id: str,
        x_subject: str = Depends(oidc_subject),
    ) -> PushRegistrationResult:
        device_id = getattr(x_subject, "device_id", None)
        if not device_id:
            raise RelayRegistryError("device_proof_required", "Device-bound request proof is required")
        return PushRegistrationResult.model_validate(
            store.revoke_push_registration(str(x_subject), runtime_id, str(device_id))
        )

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events",
        response_model=OaepEventPage,
    )
    async def oaep_events(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        x_subject: str = Depends(oidc_subject),
        after_sequence: int = Query(0, ge=0),
        limit: int = Query(500, ge=1, le=500),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        cached = await oaep_replay.page(
            runtime_id,
            workspace_id,
            session_id,
            after_sequence=after_sequence,
            limit=limit,
        )
        if cached is not None:
            return cached
        return validated_oaep_page(
            await runtime_call(
                runtime_id, "oaep_events_for_subject", x_subject, workspace_id, session_id,
                after_sequence=after_sequence, limit=limit,
            ),
            session_id=session_id,
        )

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream"
    )
    async def session_catalog_event_stream(
        runtime_id: str,
        workspace_id: str,
        raw_request: Request,
        x_subject: str = Depends(oidc_subject),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        queue = await oaep_replay.subscribe_workspace(runtime_id, workspace_id)

        async def encoded_catalog_events():
            try:
                yield b": connected\n\n"
                while not await raw_request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15)
                    except TimeoutError:
                        yield b": heartbeat\n\n"
                        continue
                    if event.get("_control") == "authorization_changed":
                        return
                    data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {event['event_id']}\nevent: session.catalog.changed\ndata: {data}\n\n".encode()
            finally:
                await oaep_replay.unsubscribe_workspace(runtime_id, workspace_id, queue)

        return StreamingResponse(
            encoded_catalog_events(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream",
        responses={
            200: {
                "description": "OAEP Event stream",
                "content": {
                    "text/event-stream": {
                        "schema": {"$ref": "#/components/schemas/OaepEvent"}
                    }
                },
            }
        },
    )
    async def oaep_event_stream(
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        raw_request: Request,
        x_subject: str = Depends(oidc_subject),
        after_sequence: int = Query(0, ge=0),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        queue = await oaep_replay.subscribe(runtime_id, session_id)
        try:
            cached = await oaep_replay.page(
                runtime_id,
                workspace_id,
                session_id,
                after_sequence=after_sequence,
                limit=500,
            )
            if cached is None:
                cached = validated_oaep_page(
                    await runtime_call(
                        runtime_id,
                        "oaep_events_for_subject",
                        x_subject,
                        workspace_id,
                        session_id,
                        after_sequence=after_sequence,
                        limit=500,
                    ),
                    session_id=session_id,
                )
        except Exception:
            await oaep_replay.unsubscribe(runtime_id, session_id, queue)
            raise

        async def encoded_oaep_events():
            cursor = after_sequence
            try:
                for event in cached["data"]:
                    cursor = int(event["sequence"])
                    data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {cursor}\nevent: oaep.event\ndata: {data}\n\n".encode()
                while not await raw_request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=15)
                    except TimeoutError:
                        yield b": heartbeat\n\n"
                        continue
                    if event.get("_control") == "authorization_changed":
                        return
                    sequence = int(event["sequence"])
                    if sequence <= cursor:
                        continue
                    if sequence != cursor + 1:
                        return
                    cursor = sequence
                    data = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {cursor}\nevent: oaep.event\ndata: {data}\n\n".encode()
            finally:
                await oaep_replay.unsubscribe(runtime_id, session_id, queue)

        return StreamingResponse(
            encoded_oaep_events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/v1/runtimes/{runtime_id}/idempotency/{operation}/{idempotency_key}")
    async def idempotency_result(runtime_id: str, operation: str, idempotency_key: str,
                                 x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        if operation == "approval.decide":
            store.authorize_runtime_permission(x_subject, runtime_id, "approve")
        item = await runtime_call(runtime_id, "idempotency_result", x_subject, operation, idempotency_key)
        resource = json_dataclass(item)
        if operation == "approval.decide":
            resource = {
                "runtime_id": resource["runtime_id"],
                "approval_id": resource["approval_id"],
                "status": resource["status"],
            }
        payload = {"status": "succeeded", "operation": operation, "resource": resource}
        response_types = {
            "session.create": GeneratedSessionCreateRecoveryResponse,
            "run.create": GeneratedRunCreateRecoveryResponse,
            "approval.decide": GeneratedApprovalDecisionRecoveryResponse,
        }
        response_type = response_types.get(operation)
        if response_type is None:
            raise RelayRegistryError("idempotency_operation_invalid", "Unsupported idempotency operation")
        return response_type.model_validate(payload)

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        response_model=GeneratedRunProjection,
    )
    async def create_run(runtime_id: str, workspace_id: str, session_id: str, body: GeneratedRunCreateRequest, request: Request,
                         x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id, "send")
        await runtime_call(runtime_id, "authorize_session", x_subject, workspace_id, session_id)
        item = await runtime_call(runtime_id, "create_run", x_subject, workspace_id, session_id, message=body.message,
            attachment_refs=body.attachment_refs, idempotency_key=body.idempotency_key,
            correlation_id=body.correlation_id, retry_of=body.retry_of,
            source_message_id=body.source_message_id,
            _authorization=request.headers.get("authorization"))
        value = json_dataclass(item)
        device_action_audit.record(
            DeviceActionKey(runtime_id, workspace_id, str(value["run_id"]), "run.created"),
            getattr(x_subject, "device_id", None),
        )
        return value

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}", response_model=GeneratedRunProjection)
    async def get_run(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        return json_dataclass(await runtime_call(runtime_id, "get_run", run_id))

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}/events")
    async def events(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject), after_sequence: int = Query(0, ge=0),
                     limit: int = Query(100, ge=1, le=500)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        rows, cursor = await runtime_call(runtime_id, "list_events", run_id, after_sequence=after_sequence, limit=limit)
        return {"items": [item.model_dump(mode="json") if hasattr(item, "model_dump") else item for item in rows], "next_cursor": cursor}

    @app.get("/v1/runtimes/{runtime_id}/runs/{run_id}/events/stream")
    async def event_stream(runtime_id: str, run_id: str, x_subject: str = Depends(oidc_subject),
                           after_sequence: int = Query(0, ge=0)):
        store.identity(x_subject, runtime_id)
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        rows, _ = await runtime_call(runtime_id, "list_events", run_id, after_sequence=after_sequence, limit=500)

        def encoded_events():
            for item in rows:
                value = item.model_dump(mode="json") if hasattr(item, "model_dump") else item
                data = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                yield f"id: {value['sequence']}\nevent: {value['kind']}\ndata: {data}\n\n".encode()
            yield b": keep-alive\n\n"

        return StreamingResponse(encoded_events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post(
        "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel",
        response_model=GeneratedRunProjection,
    )
    async def cancel_run(runtime_id: str, workspace_id: str, run_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id, "send")
        await runtime_call(runtime_id, "authorize_run", x_subject, run_id)
        value = json_dataclass(await runtime_call(runtime_id, "cancel_run", workspace_id, run_id))
        device_action_audit.record(
            DeviceActionKey(runtime_id, workspace_id, run_id, "run.cancelled"),
            getattr(x_subject, "device_id", None),
        )
        return value

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals")
    async def approvals(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows = await runtime_call(runtime_id, "pending_approvals_for_subject", x_subject, workspace_id)
        return {"items": [json_dataclass(item) for item in rows]}

    @app.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/audit")
    async def audit(runtime_id: str, workspace_id: str, x_subject: str = Depends(oidc_subject), run_id: str | None = None):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        rows = await runtime_call(runtime_id, "audit_entries_for_subject", x_subject, workspace_id, run_id)
        items = [json_dataclass(item) for item in rows]
        for item in items:
            item["actor_label"] = device_action_audit.label(
                DeviceActionKey(runtime_id, workspace_id, str(item["run_id"]), str(item["action"])),
                getattr(x_subject, "device_id", None),
            )
        return {"items": items}

    @app.post("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/owop")
    async def owop(runtime_id: str, workspace_id: str, body: _OwopRequest, x_subject: str = Depends(oidc_subject)):
        authorize_workspace(x_subject, runtime_id, workspace_id, "files")
        if body.version != "1.0":
            raise RelayRegistryError("owop_version_incompatible", "OWOP version is incompatible")
        result = await runtime_call(runtime_id, "execute_owop", workspace_id, body.operation, body.params)
        return {"request_id": body.request_id, "correlation_id": body.correlation_id,
                "runtime_id": runtime_id, "workspace_id": workspace_id, "result": result}

    @app.post(
        "/v1/runtimes/{runtime_id}/approvals/{approval_id}/decision",
        response_model=GeneratedApprovalProjection,
    )
    async def decide(runtime_id: str, approval_id: str, body: GeneratedApprovalDecisionRequest,
                     x_subject: str = Depends(oidc_subject)):
        store.authorize_runtime_permission(x_subject, runtime_id, "approve")
        value = json_dataclass(await runtime_call(
            runtime_id, "decide_approval", x_subject, approval_id, body.decision, body.idempotency_key
        ))
        status = str(value.get("status") or "")
        action = {"approved": "approval.approved", "denied": "approval.denied",
                  "cancelled": "approval.denied"}.get(status)
        if action and value.get("workspace_id") and value.get("run_id"):
            device_action_audit.record(
                DeviceActionKey(runtime_id, str(value["workspace_id"]), str(value["run_id"]), action),
                getattr(x_subject, "device_id", None),
            )
        return value

    @app.delete("/v1/admin/runtimes/{runtime_id}", status_code=204)
    async def revoke(runtime_id: str):
        store.revoke(runtime_id)

    @app.websocket("/v1/runtime-connect")
    async def runtime_connect(socket: WebSocket) -> None:
        authorization = socket.headers.get("authorization", "")
        if not authorization.startswith("Runtime "):
            await socket.close(code=4401, reason="runtime_auth_required")
            return
        token = authorization.removeprefix("Runtime ")
        await socket.accept()
        try:
            hello = await socket.receive_json()
            if hello.get("type") != "runtime.hello" or hello.get("protocol_version") != "owop/1":
                await socket.close(code=4400, reason="runtime_hello_invalid")
                return
            identity = store.heartbeat(
                hello["runtime_id"], token, instance_id=hello["instance_id"], version=hello["version"],
                capabilities=frozenset(hello["capabilities"]), backend_health=hello.get("backend_health", {}),
                nonce=hello["nonce"], signature=hello["signature"],
            )
            await socket.send_json({"type": "runtime.connected", "runtime": identity.model_dump(mode="json")})
            generation = await channel_hub.attach(hello["runtime_id"], socket)
            await oaep_replay.attach(hello["runtime_id"], generation)
            while True:
                message = await socket.receive_json()
                if message.get("type") == "pong":
                    continue
                if message.get("type") in {"runtime.response", "response"}:
                    channel_hub.accept_response(hello["runtime_id"], message)
                elif message.get("type") == "runtime.workspaces":
                    rows = message.get("workspaces")
                    if not isinstance(rows, list):
                        await socket.close(code=4400, reason="runtime_workspaces_invalid")
                        return
                    if not await channel_hub.is_current(hello["runtime_id"], generation):
                        continue
                    store.publish_workspaces(hello["runtime_id"], token,
                                             [Workspace.model_validate(row) for row in rows])
                elif message.get("type") == "event" and message.get("protocol") == "oaep/1":
                    if not await channel_hub.is_current(hello["runtime_id"], generation):
                        await socket.close(code=4409, reason="stale_runtime_generation")
                        return
                    try:
                        fanout_started = time.perf_counter()
                        await oaep_replay.accept(hello["runtime_id"], generation, message)
                        event = message.get("event") or {}
                        event_id = str(event.get("event_id") or "")
                        if event_id:
                            scoped_correlation = relay_latency_correlation(
                                hello["runtime_id"],
                                str(message.get("workspace_id") or ""),
                                str(message.get("session_id") or ""),
                                event_id,
                            )
                            conversation_latency.record_conversation_latency(
                                "relay_fanout",
                                (time.perf_counter() - fanout_started) * 1000,
                                ResourceCorrelation(
                                    scoped_correlation,
                                    scoped_correlation,
                                    runtime_id=hello["runtime_id"],
                                    workspace_id=str(message.get("workspace_id") or ""),
                                    session_id=str(message.get("session_id") or ""),
                                    run_id=str(event.get("run_id") or ""),
                                ),
                                {"protocol": "oaep/1"},
                            )
                        await socket.send_json({
                            "type": "oaep.event.ack",
                            "protocol": "oaep/1",
                            "runtime_id": hello["runtime_id"],
                            "session_id": message.get("session_id"),
                            "sequence": message.get("sequence"),
                        })
                    except RelayRegistryError as exc:
                        await socket.close(code=4400, reason=exc.code)
                        return
                elif message.get("type") == "telemetry.conversation_latency":
                    expected = {
                        "type", "runtime_id", "workspace_id", "session_id", "run_id",
                        "correlation_id", "operation_id", "stage", "duration_ms",
                    }
                    if set(message) != expected or message.get("runtime_id") != hello["runtime_id"]:
                        await socket.close(code=4400, reason="latency_observation_invalid")
                        return
                    event_id = str(message.get("correlation_id") or "")
                    if (
                        message.get("operation_id") != event_id
                        or message.get("stage") not in {"journal_append", "runtime_wss_send"}
                        or not await oaep_replay.contains_event(
                            hello["runtime_id"], str(message.get("session_id") or ""), event_id
                        )
                    ):
                        await socket.close(code=4400, reason="latency_observation_invalid")
                        return
                    scoped_correlation = relay_latency_correlation(
                        hello["runtime_id"],
                        str(message.get("workspace_id") or ""),
                        str(message.get("session_id") or ""),
                        event_id,
                    )
                    conversation_latency.record_conversation_latency(
                        str(message["stage"]),
                        float(message["duration_ms"]),
                        ResourceCorrelation(
                            scoped_correlation,
                            scoped_correlation,
                            runtime_id=hello["runtime_id"],
                            workspace_id=str(message.get("workspace_id") or ""),
                            session_id=str(message.get("session_id") or ""),
                            run_id=str(message.get("run_id") or ""),
                        ),
                        {"protocol": "oaep/1"},
                    )
        except WebSocketDisconnect:
            return
        finally:
            if "generation" in locals() and "hello" in locals():
                await oaep_replay.detach(hello.get("runtime_id", ""), generation)
                await channel_hub.detach(hello.get("runtime_id", ""), generation)

    return app
