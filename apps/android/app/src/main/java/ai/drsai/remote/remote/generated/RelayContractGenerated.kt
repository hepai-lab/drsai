// Generated from protocol/relay/runtime-relay.schema.json. Do not edit.
package ai.drsai.remote.remote.generated

object RelayContractGenerated {
    const val SCHEMA_VERSION: String = "1.0.0"
    const val PROTOCOL_VERSION: String = "owop/1"
    val ENDPOINTS: Map<String, String> = mapOf(
        "access_grant_create" to "POST /v1/runtimes/{runtime_id}/access-grants",
        "access_grant_read" to "GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "access_grant_revoke" to "DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}",
        "event_list" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}/events",
        "file_raw" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw",
        "run_cancel" to "POST /v1/runtimes/{runtime_id}/runs/{run_id}/cancel",
        "run_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
        "run_read" to "GET /v1/runtimes/{runtime_id}/runs/{run_id}",
        "runtime_capabilities" to "GET /v1/runtimes/{runtime_id}/capabilities",
        "runtime_identity" to "GET /v1/runtimes/{runtime_id}/runtime",
        "runtime_list" to "GET /v1/runtimes",
        "session_create" to "POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "session_list" to "GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions",
        "workspace_list" to "GET /v1/runtimes/{runtime_id}/workspaces"
    )
    val CAPABILITIES: Set<String> = setOf(
        "event.resume",
        "file.raw.read",
        "run.cancel",
        "run.create",
        "run.read",
        "runtime.capabilities",
        "runtime.identity",
        "session.create",
        "session.list",
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
