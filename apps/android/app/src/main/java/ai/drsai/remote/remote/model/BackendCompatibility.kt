package ai.drsai.remote.remote.model

data class RemoteBackendDescriptor(
    val backendId: String,
    val displayName: String,
    val version: String,
    val health: String,
    val capabilities: Set<String>,
)

enum class UnifiedBackendError { AUTH_REQUIRED, INCOMPATIBLE, UNAVAILABLE, SCHEMA_DRIFT, CAPABILITY_UNSUPPORTED }

fun mapBackendError(backendId: String, reason: String): UnifiedBackendError {
    require(backendId in setOf("opendrsai", "codex")) { "backend_unknown" }
    return when (reason) {
        "not_authenticated", "logged_out" -> UnifiedBackendError.AUTH_REQUIRED
        "version_incompatible" -> UnifiedBackendError.INCOMPATIBLE
        "app_server_dead", "closed", "not_configured" -> UnifiedBackendError.UNAVAILABLE
        "schema_drift" -> UnifiedBackendError.SCHEMA_DRIFT
        else -> UnifiedBackendError.CAPABILITY_UNSUPPORTED
    }
}

data class BackendBoundSession(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val backend: RemoteBackendDescriptor,
) {
    fun createRun(runId: RunId, requestedBackendId: String): RemoteRunIdentity {
        require(requestedBackendId == backend.backendId) { "backend_switch_requires_new_session" }
        return RemoteRunIdentity(runtimeId, workspaceId, sessionId, runId, backend.backendId)
    }
}

data class UnifiedRemoteTimelineItem(val type: String, val text: String?, val operation: String?, val status: String?) {
    init { require(type in setOf("message", "tool", "workspace_change", "approval", "cancel", "terminal")) }
}

class BackendIsolationIndex {
    private val keys = mutableSetOf<List<String>>()
    fun insert(runtimeId: String, workspaceId: String, sessionId: String, backendId: String, resourceId: String): Boolean =
        keys.add(listOf(runtimeId, workspaceId, sessionId, backendId, resourceId))
    fun size(): Int = keys.size
}
