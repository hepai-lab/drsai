// Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object RelayContractGenerated {
    const val SCHEMA_VERSION: String = "2.0.0"
    const val PROTOCOL_VERSION: String = "owop/1"
    val ENDPOINTS: Map<String, String> = mapOf(
        "access_grant_create" to "POST /v1/runtimes/{runtime_id}/access-grants",
        "access_grant_read" to "GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "access_grant_revoke" to "DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "approval_decision" to "POST /v1/runtimes/{runtime_id}/approvals/{approval_id}/decision",
        "approval_decision_recovery" to "GET /v1/runtimes/{runtime_id}/idempotency/approval.decide/{idempotency_key}",
        "approval_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals",
        "association_create" to "POST /v1/associations",
        "association_device_key_rotate" to "POST /v1/associations/{runtime_id}/device-key/rotate",
        "association_push_registration_revoke" to "DELETE /v1/associations/{runtime_id}/push-registration",
        "association_push_registration_upsert" to "PUT /v1/associations/{runtime_id}/push-registration",
        "association_revoke" to "DELETE /v1/associations/{runtime_id}",
        "conversation_latency_metrics" to "GET /v1/metrics/relay-latency",
        "conversation_latency_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation",
        "conversation_latency_record" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/{event_id}/latency-observation",
        "conversation_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot",
        "event_list" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events",
        "event_stream" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream",
        "file_raw" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw",
        "oaep_event_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events",
        "oaep_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream",
        "oaep_snapshot" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot",
        "run_cancel" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/runs/{run_id}/cancel",
        "run_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_read" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}",
        "runtime_association_authorization_shrink" to "PATCH /v1/runtimes/{runtime_id}/associations/{association_id}",
        "runtime_association_list" to "GET /v1/runtimes/{runtime_id}/associations",
        "runtime_association_revoke" to "DELETE /v1/runtimes/{runtime_id}/associations/{association_id}",
        "runtime_capabilities" to "GET /v1/runtimes/{runtime_id}/capabilities",
        "runtime_connect" to "WS /v1/runtime-connect",
        "runtime_enrollment_pause" to "POST /v1/runtimes/{runtime_id}/enrollment/pause",
        "runtime_enrollment_resume" to "POST /v1/runtimes/{runtime_id}/enrollment/resume",
        "runtime_enrollment_revoke" to "DELETE /v1/runtimes/{runtime_id}/enrollment",
        "runtime_identity" to "GET /v1/runtimes/{runtime_id}/runtime",
        "runtime_list" to "GET /v1/runtimes",
        "runtime_rename" to "PATCH /v1/runtimes/{runtime_id}",
        "session_catalog_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream",
        "session_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_event_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events",
        "session_event_stream" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream",
        "session_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        "session_update" to "PATCH /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        "workspace_list" to "GET /v1/runtimes/{runtime_id}/workspaces",
        "workspace_sync" to "POST /v1/runtimes/{runtime_id}/workspaces/sync"
    )
    val CAPABILITIES: Set<String> = setOf(
        "approval.decide",
        "approval.list",
        "association.authorization.shrink",
        "association.device-bound",
        "association.device-key.rotate",
        "association.list",
        "association.revoke",
        "conversation.read",
        "enrollment.pause",
        "enrollment.resume",
        "enrollment.revoke",
        "event.cursor_expired",
        "event.resume",
        "event.stream",
        "file.raw.read",
        "mcp.stdio",
        "notification.push.registration",
        "oaep.session.events",
        "oaep.session.events.stream",
        "oaep.session.snapshot",
        "oaep.v1",
        "run.cancel",
        "run.create",
        "run.list",
        "run.read",
        "runtime.capabilities",
        "runtime.identity",
        "runtime.rename",
        "session.catalog.events.stream",
        "session.create",
        "session.list",
        "session.manage",
        "session.read",
        "telemetry.conversation-latency",
        "workspace.list",
        "workspace.sync"
    )
    val CAPABILITY_PROFILES: Map<String, Set<String>> = mapOf(
        "device-association/1" to setOf("association.authorization.shrink", "association.device-bound", "association.device-key.rotate", "association.list", "association.revoke"),
        "oaep.session-stream/1" to setOf("event.cursor_expired", "oaep.session.events", "oaep.session.events.stream", "oaep.session.snapshot", "oaep.v1"),
        "oaep/1" to setOf("event.cursor_expired", "oaep.session.events", "oaep.session.events.stream", "oaep.session.snapshot", "oaep.v1"),
        "push-notifications/1" to setOf("association.device-bound", "notification.push.registration"),
        "session-events/1" to setOf("conversation.snapshot", "session.event.cursor_expired", "session.event.resume", "session.event.stream")
    )
    val MINIMUM_VERSIONS: Map<String, Map<String, String>> = mapOf(
        "device-association/1" to mapOf("android" to "1.5.3", "relay" to "2.0.0", "runtime" to "1.5.3"),
        "oaep.session-stream/1" to mapOf("android" to "1.5.6", "desktop" to "1.6.0", "runtime" to "1.6.0"),
        "oaep/1" to mapOf("android" to "1.5.6", "desktop" to "1.6.0", "runtime" to "1.6.0"),
        "push-notifications/1" to mapOf("android" to "1.5.6", "relay" to "2.0.0"),
        "session-events/1" to mapOf("android" to "1.5.3", "desktop" to "1.5.3", "runtime" to "1.5.3")
    )
    val SESSION_EVENT_KINDS: Set<String> = setOf(
        "approval.created",
        "approval.decided",
        "artifact.created",
        "conversation.item.created",
        "conversation.item.delta",
        "conversation.item.upsert",
        "run.created",
        "run.state.changed",
        "session.archived",
        "session.removed",
        "session.updated",
        "tool.state.changed"
    )
}

data class GeneratedControlRequest(
    val requestId: String,
    val correlationId: String,
    val idempotencyKey: String? = null,
)

data class GeneratedErrorEnvelope(
    val code: String,
    val message: String,
    val correlationId: String,
    val retryable: Boolean,
    val details: Map<String, Any?>,
    val source: String,
)

data class GeneratedRelayEvent(
    val eventId: String,
    val sequence: Long,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val timestamp: String,
    val kind: String,
    val payload: Map<String, Any?>,
)

data class GeneratedSessionConversationItem(
    val itemId: String,
    val sessionId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payload: Map<String, Any?>,
)

data class GeneratedConversationSnapshot(
    val sessionId: String,
    val snapshotSequence: Long,
    val items: List<GeneratedSessionConversationItem>,
    val nextCursor: String?,
)

data class GeneratedSessionEvent(
    val eventId: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
    val itemId: String? = null,
    val itemRevision: Long? = null,
)

data class GeneratedRuntimeSessionEventFrame(
    val type: String = "event",
    val scope: String = "session",
    val sessionId: String,
    val sessionSequence: Long,
    val event: GeneratedSessionEvent,
)
