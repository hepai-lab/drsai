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
        "approval_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals",
        "association_create" to "POST /v1/associations",
        "association_revoke" to "DELETE /v1/associations/{runtime_id}",
        "conversation_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation",
        "event_list" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events",
        "event_stream" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream",
        "file_raw" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw",
        "run_cancel" to "POST /v1/runtimes/{runtime_id}/runs/{run_id}/cancel",
        "run_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_read" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}",
        "runtime_association_list" to "GET /v1/runtimes/{runtime_id}/associations",
        "runtime_association_revoke" to "DELETE /v1/runtimes/{runtime_id}/associations/{association_id}",
        "runtime_capabilities" to "GET /v1/runtimes/{runtime_id}/capabilities",
        "runtime_connect" to "WS /v1/runtime-connect",
        "runtime_enrollment_revoke" to "DELETE /v1/runtimes/{runtime_id}/enrollment",
        "runtime_identity" to "GET /v1/runtimes/{runtime_id}/runtime",
        "runtime_list" to "GET /v1/runtimes",
        "runtime_rename" to "PATCH /v1/runtimes/{runtime_id}",
        "session_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_read" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}",
        "workspace_list" to "GET /v1/runtimes/{runtime_id}/workspaces"
    )
    val CAPABILITIES: Set<String> = setOf(
        "approval.decide",
        "approval.list",
        "association.list",
        "association.revoke",
        "conversation.read",
        "enrollment.revoke",
        "event.cursor_expired",
        "event.resume",
        "event.stream",
        "file.raw.read",
        "run.cancel",
        "run.create",
        "run.list",
        "run.read",
        "runtime.capabilities",
        "runtime.identity",
        "runtime.rename",
        "session.create",
        "session.list",
        "session.read",
        "workspace.list"
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
