"""Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = '2.0.0'
PROTOCOL_VERSION = 'owop/1'
SOURCE_SCHEMA_SHA256 = '0eeacedcba0b195a0a657242b77e7a15d28fb1163d94e55593ce2ddf0fb8c647'
ENDPOINTS = {'access_grant_create': 'POST /v1/runtimes/{runtime_id}/access-grants', 'access_grant_read': 'GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'access_grant_revoke': 'DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'approval_decision': 'POST /v1/runtimes/{runtime_id}/approvals/{approval_id}/decision', 'approval_decision_recovery': 'GET /v1/runtimes/{runtime_id}/idempotency/approval.decide/{idempotency_key}', 'approval_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals', 'association_create': 'POST /v1/associations', 'association_device_key_rotate': 'POST /v1/associations/{runtime_id}/device-key/rotate', 'association_push_registration_revoke': 'DELETE /v1/associations/{runtime_id}/push-registration', 'association_push_registration_upsert': 'PUT /v1/associations/{runtime_id}/push-registration', 'association_revoke': 'DELETE /v1/associations/{runtime_id}', 'conversation_latency_metrics': 'GET /v1/metrics/relay-latency', 'conversation_latency_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation', 'conversation_latency_record': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation', 'conversation_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot', 'event_list': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events', 'event_stream': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream', 'file_raw': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw', 'oaep_event_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events', 'oaep_event_stream': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream', 'oaep_snapshot': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot', 'run_cancel': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel', 'run_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_read': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}', 'runtime_association_authorization_shrink': 'PATCH /v1/runtimes/{runtime_id}/associations/{association_id}', 'runtime_association_list': 'GET /v1/runtimes/{runtime_id}/associations', 'runtime_association_revoke': 'DELETE /v1/runtimes/{runtime_id}/associations/{association_id}', 'runtime_capabilities': 'GET /v1/runtimes/{runtime_id}/capabilities', 'runtime_connect': 'WS /v1/runtime-connect', 'runtime_enrollment_pause': 'POST /v1/runtimes/{runtime_id}/enrollment/pause', 'runtime_enrollment_resume': 'POST /v1/runtimes/{runtime_id}/enrollment/resume', 'runtime_enrollment_revoke': 'DELETE /v1/runtimes/{runtime_id}/enrollment', 'runtime_identity': 'GET /v1/runtimes/{runtime_id}/runtime', 'runtime_list': 'GET /v1/runtimes', 'runtime_rename': 'PATCH /v1/runtimes/{runtime_id}', 'session_catalog_event_stream': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream', 'session_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_event_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events', 'session_event_stream': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream', 'session_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}', 'session_update': 'PATCH /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}', 'user_slo_first_screen_record': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/first-screen/{sample_id}', 'user_slo_metrics': 'GET /v1/metrics/user-slo', 'user_slo_operation_confirmation_record': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/operation-confirmation/{sample_id}', 'user_slo_reconnect_record': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/slo/reconnect/{sample_id}', 'workspace_list': 'GET /v1/runtimes/{runtime_id}/workspaces', 'workspace_sync': 'POST /v1/runtimes/{runtime_id}/workspaces/sync'}
CAPABILITIES = frozenset(['approval.decide', 'approval.list', 'association.authorization.shrink', 'association.device-bound', 'association.device-key.rotate', 'association.list', 'association.revoke', 'conversation.read', 'enrollment.pause', 'enrollment.resume', 'enrollment.revoke', 'event.cursor_expired', 'event.resume', 'event.stream', 'file.raw.read', 'mcp.stdio', 'notification.push.registration', 'oaep.session.events', 'oaep.session.events.stream', 'oaep.session.snapshot', 'oaep.v1', 'run.cancel', 'run.create', 'run.list', 'run.read', 'runtime.capabilities', 'runtime.identity', 'runtime.rename', 'session.catalog.events.stream', 'session.create', 'session.list', 'session.manage', 'session.read', 'telemetry.conversation-latency', 'workspace.list', 'workspace.sync'])

CAPABILITY_PROFILES = {'device-association/1': frozenset(['association.authorization.shrink', 'association.device-bound', 'association.device-key.rotate', 'association.list', 'association.revoke']), 'oaep.session-stream/1': frozenset(['event.cursor_expired', 'oaep.session.events', 'oaep.session.events.stream', 'oaep.session.snapshot', 'oaep.v1']), 'oaep/1': frozenset(['event.cursor_expired', 'oaep.session.events', 'oaep.session.events.stream', 'oaep.session.snapshot', 'oaep.v1']), 'push-notifications/1': frozenset(['association.device-bound', 'notification.push.registration']), 'session-events/1': frozenset(['conversation.snapshot', 'session.event.cursor_expired', 'session.event.resume', 'session.event.stream'])}
MINIMUM_VERSIONS = {'device-association/1': {'android': '1.5.3', 'relay': '2.0.0', 'runtime': '1.5.3'}, 'oaep.session-stream/1': {'runtime': '1.6.0', 'android': '1.5.6', 'desktop': '1.6.0'}, 'oaep/1': {'runtime': '1.6.0', 'android': '1.5.6', 'desktop': '1.6.0'}, 'push-notifications/1': {'android': '1.5.6', 'relay': '2.0.0'}, 'session-events/1': {'runtime': '1.5.3', 'android': '1.5.3', 'desktop': '1.5.3'}}
SESSION_EVENT_KINDS = frozenset(['approval.created', 'approval.decided', 'artifact.created', 'conversation.item.created', 'conversation.item.delta', 'conversation.item.upsert', 'run.created', 'run.state.changed', 'session.archived', 'session.removed', 'session.updated', 'tool.state.changed'])

RELAY_ERROR_ACTIONS = {'access_denied': 'contact-admin', 'access_grant_consumed': 're-pair', 'access_grant_expired': 're-pair', 'access_grant_invalid': 're-pair', 'access_grant_not_found': 're-pair', 'access_grant_revoked': 're-pair', 'agent_definition_not_found': 'contact-admin', 'agent_version_invalid': 'contact-admin', 'approval_decision_invalid': 'contact-admin', 'approval_decision_ledger_invalid': 'contact-admin', 'approval_not_found': 'contact-admin', 'association_not_found': 're-pair', 'association_permissions_invalid': 'contact-admin', 'association_required': 're-pair', 'association_revoked': 're-pair', 'attachment_reference_invalid': 'contact-admin', 'auth_required': 'login', 'authorization_expansion_forbidden': 'contact-admin', 'backend_unavailable': 'retry', 'backpressure_overflow': 'retry', 'capability_unknown': 'update', 'catalog_order_invalid': 'contact-admin', 'catalog_sync_timeout': 'retry', 'client_update_required': 'update', 'cursor_expired': 'retry', 'cursor_invalid': 'retry', 'device_identity_conflict': 're-pair', 'device_key_conflict': 're-pair', 'device_name_invalid': 'contact-admin', 'device_proof_expired': 're-pair', 'device_proof_invalid': 're-pair', 'device_proof_replay': 're-pair', 'device_proof_required': 're-pair', 'device_public_key_invalid': 're-pair', 'event_cursor_invalid': 'retry', 'event_id_conflict': 'contact-admin', 'event_sequence_gap': 'retry', 'file_forbidden': 'contact-admin', 'gateway_timeout': 'retry', 'grant_forbidden': 're-pair', 'grant_not_found': 're-pair', 'grant_unavailable': 'retry', 'heartbeat_replay': 'contact-admin', 'host_offline': 'retry', 'idempotency_conflict': 'contact-admin', 'idempotency_key_invalid': 'contact-admin', 'idempotency_key_required': 'contact-admin', 'idempotency_operation_invalid': 'contact-admin', 'idempotency_pending': 'retry', 'idempotency_result_not_found': 'retry', 'insufficient_scope': 're-pair', 'invalid_cursor': 'retry', 'invalid_device_key': 'contact-admin', 'invalid_device_proof': 're-pair', 'invalid_display_name': 'contact-admin', 'invalid_idempotency_key': 'contact-admin', 'invalid_latency_observation': 'contact-admin', 'invalid_limit': 'contact-admin', 'invalid_registration_code': 'contact-admin', 'invalid_token': 'login', 'key_rotation_invalid': 'contact-admin', 'key_rotation_replay': 'contact-admin', 'latency_event_not_found': 'contact-admin', 'latency_observation_expired': 'contact-admin', 'latency_observation_invalid': 'contact-admin', 'latency_stage_forbidden': 'contact-admin', 'latency_store_unavailable': 'retry', 'oaep_event_invalid': 'contact-admin', 'oaep_event_page_invalid': 'contact-admin', 'oaep_frame_identity_mismatch': 'contact-admin', 'oaep_frame_invalid': 'contact-admin', 'oaep_identity_mismatch': 'contact-admin', 'oaep_sequence_collision': 'contact-admin', 'oaep_sequence_gap': 'retry', 'oaep_snapshot_invalid': 'contact-admin', 'oidc_auth_invalid': 'login', 'owop_operation_forbidden': 'contact-admin', 'owop_unavailable': 'retry', 'owop_version_incompatible': 'update', 'page_limit_invalid': 'contact-admin', 'permission_denied': 'contact-admin', 'permission_forbidden': 'contact-admin', 'protocol_incompatible': 'update', 'public_key_invalid': 'contact-admin', 'push_provider_unavailable': 'retry', 'push_registration_conflict': 'retry', 'push_registration_not_found': 'contact-admin', 'push_registration_stale': 'retry', 'raw_range_invalid': 'contact-admin', 'registration_code_invalid': 'contact-admin', 'relay_bus_unavailable': 'retry', 'relay_restart_in_progress': 'retry', 'run_input_empty': 'contact-admin', 'run_not_found': 'contact-admin', 'run_scope_mismatch': 'contact-admin', 'runtime_auth_invalid': 'contact-admin', 'runtime_display_name_invalid': 'contact-admin', 'runtime_forbidden': 'contact-admin', 'runtime_generation_stale': 'retry', 'runtime_id_conflict': 'contact-admin', 'runtime_identity_mismatch': 'contact-admin', 'runtime_invalid_catalog': 'contact-admin', 'runtime_invalid_oaep': 'contact-admin', 'runtime_invalid_response': 'contact-admin', 'runtime_not_found': 'contact-admin', 'runtime_offline': 'retry', 'runtime_owner_unavailable': 'retry', 'runtime_paused': 'retry', 'runtime_permission_denied': 'contact-admin', 'runtime_request_failed': 'contact-admin', 'runtime_timeout': 'retry', 'runtime_unavailable': 'retry', 'runtime_update_required': 'update', 'session_forbidden': 'contact-admin', 'session_lifecycle_invalid': 'contact-admin', 'session_not_found': 'contact-admin', 'session_title_invalid': 'contact-admin', 'session_update_empty': 'contact-admin', 'signature_invalid': 'contact-admin', 'stale_runtime_generation': 'retry', 'ticket_expired': 're-pair', 'ticket_invalid': 're-pair', 'ticket_revoked': 're-pair', 'ticket_scope_mismatch': 're-pair', 'timeout': 'retry', 'token_expired': 'login', 'unsupported_protocol': 'update', 'workspace_catalog_sync_invalid': 'retry', 'workspace_forbidden': 'contact-admin', 'workspace_not_found': 'contact-admin', 'workspace_scope_invalid': 'contact-admin', 'workspace_scope_mismatch': 'contact-admin'}
RELAY_USER_ACTIONS = frozenset(['contact-admin', 'login', 're-pair', 'retry', 'update'])

def generated_relay_error_action(code: str | None, retryable: bool = False) -> str:
    """Return one safe user action; unknown transient errors retry, all others escalate."""
    return RELAY_ERROR_ACTIONS.get(code or "", "retry" if retryable else "contact-admin")

class GeneratedStrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

class GeneratedWireStrictModel(GeneratedStrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

class GeneratedControlRequest(GeneratedStrictModel):
    request_id: UUID
    correlation_id: str
    idempotency_key: str | None = None

class GeneratedErrorEnvelope(GeneratedStrictModel):
    code: str
    message: str
    correlation_id: str
    retryable: bool
    details: dict[str, Any]
    source: Literal["relay", "runtime"]

class GeneratedRelayEvent(GeneratedStrictModel):
    event_id: str
    sequence: int
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    timestamp: datetime
    kind: str
    payload: dict[str, Any]

class GeneratedSessionConversationItem(GeneratedStrictModel):
    item_id: str
    session_id: str
    run_id: str | None
    kind: Literal["message", "reasoning", "tool", "file_change", "approval", "artifact", "error"]
    role: Literal["user", "assistant", "system", "tool"] | None
    revision: int
    session_sequence: int
    source_client: Literal["windows", "android", "runtime"]
    source_message_id: str | None
    created_at: datetime
    updated_at: datetime
    payload: dict[str, Any]

class GeneratedConversationSnapshot(GeneratedStrictModel):
    session_id: str
    snapshot_sequence: int
    items: list[GeneratedSessionConversationItem]
    next_cursor: str | None

class GeneratedSessionEvent(GeneratedStrictModel):
    event_id: str
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str | None
    item_id: str | None = None
    item_revision: int | None = None
    session_sequence: int
    kind: str
    timestamp: datetime
    payload: dict[str, Any]

class GeneratedRuntimeSessionEventFrame(GeneratedStrictModel):
    type: Literal["event"] = "event"
    scope: Literal["session"] = "session"
    session_id: str
    session_sequence: int
    event: GeneratedSessionEvent

class GeneratedSessionCreateRequest(GeneratedWireStrictModel):
    request_id: str
    correlation_id: str
    idempotency_key: str
    title: str
    agent_definition_id: str
    agent_definition_version: str

class GeneratedSessionUpdateRequest(GeneratedWireStrictModel):
    request_id: str
    correlation_id: str
    title: str | None = None
    lifecycle: Literal['active', 'archived', 'removed'] | None = None

    @model_validator(mode="after")
    def validate_sessionupdaterequest(self):
        if not (self.title is not None or self.lifecycle is not None):
            raise ValueError("generated_dto_required_alternative_missing")
        return self

class GeneratedRunCreateRequest(GeneratedWireStrictModel):
    request_id: str
    correlation_id: str
    idempotency_key: str
    message: str
    source_message_id: str | None = None
    attachment_refs: list[str] = Field(default_factory=list)
    retry_of: str | None = None

class GeneratedApprovalDecisionRequest(GeneratedWireStrictModel):
    request_id: str
    correlation_id: str
    idempotency_key: str | None = None
    decision: Literal['approve', 'deny', 'cancel']

class GeneratedLatencyObservationRequest(GeneratedWireStrictModel):
    client_receive_at_ms: int
    render_at_ms: int

class GeneratedFirstScreenObservationRequest(GeneratedWireStrictModel):
    cache_load_at_ms: int
    authority_refresh_at_ms: int
    first_render_at_ms: int

class GeneratedOperationConfirmationObservationRequest(GeneratedWireStrictModel):
    request_dispatch_at_ms: int
    runtime_commit_at_ms: int
    confirmation_render_at_ms: int

class GeneratedReconnectObservationRequest(GeneratedWireStrictModel):
    disconnect_detect_at_ms: int
    transport_restore_at_ms: int
    replay_catchup_at_ms: int

class GeneratedSessionProjection(GeneratedWireStrictModel):
    runtime_id: str
    workspace_id: str
    session_id: str
    title: str
    lifecycle: Literal['active', 'archived', 'removed']
    updated_at: str
    agent_definition_id: str | None = None
    agent_definition_version: str | None = None
    backend_id: str | None = None
    last_run_status: str | None = None

class GeneratedRunProjection(GeneratedWireStrictModel):
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    backend_id: str
    status: Literal['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled']
    correlation_id: str
    created_at: str
    retry_of: str | None = None
    message: str
    attachment_refs: list[str]

class GeneratedApprovalProjection(GeneratedWireStrictModel):
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    approval_id: str
    agent_definition_id: str
    backend_id: str
    operation: str
    risk_summary: str
    scope: str
    expires_at: str
    correlation_id: str
    status: Literal['pending', 'approved', 'denied', 'cancelled', 'expired']

class GeneratedApprovalDecisionProjection(GeneratedWireStrictModel):
    runtime_id: str
    approval_id: str
    status: Literal['approved', 'denied', 'cancelled', 'expired']

class GeneratedLatencyObservationResponse(GeneratedWireStrictModel):
    ready: bool
    stages_present: list[str]
    latencies_ms: dict[str, int] | None

class GeneratedUserSloObservationResponse(GeneratedWireStrictModel):
    ready: bool
    stages_present: list[str]
    latencies_ms: dict[str, int] | None

class GeneratedSessionCreateRecoveryResponse(GeneratedWireStrictModel):
    status: Literal['succeeded']
    operation: Literal['session.create']
    resource: GeneratedSessionProjection

class GeneratedRunCreateRecoveryResponse(GeneratedWireStrictModel):
    status: Literal['succeeded']
    operation: Literal['run.create']
    resource: GeneratedRunProjection

class GeneratedApprovalDecisionRecoveryResponse(GeneratedWireStrictModel):
    status: Literal['succeeded']
    operation: Literal['approval.decide']
    resource: GeneratedApprovalDecisionProjection
