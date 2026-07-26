package ai.drsai.remote.remote.model

private val REMOTE_ID_PATTERN = Regex("^[A-Za-z0-9_.:-]{1,200}$")

private fun requireRemoteId(kind: String, value: String) {
    require(REMOTE_ID_PATTERN.matches(value) && value != "." && value != "..") { "invalid_${kind}_id" }
}

@JvmInline
value class RuntimeId(val value: String) {
    init { requireRemoteId("runtime", value) }
}

@JvmInline
value class WorkspaceId(val value: String) {
    init { requireRemoteId("workspace", value) }
}

@JvmInline
value class SessionId(val value: String) {
    init { requireRemoteId("session", value) }
}

@JvmInline
value class RunId(val value: String) {
    init { requireRemoteId("run", value) }
}

@JvmInline
value class EventId(val value: String) {
    init { requireRemoteId("event", value) }
}

@JvmInline
value class ApprovalId(val value: String) {
    init { requireRemoteId("approval", value) }
}

data class RemoteRuntimeRef(
    val runtimeId: RuntimeId,
    val displayName: String,
)

enum class RemoteResourceLifecycle {
    ACTIVE,
    ARCHIVED,
    REMOVED;

    companion object {
        fun fromWire(value: String): RemoteResourceLifecycle = when (value.lowercase()) {
            "active" -> ACTIVE
            "archived" -> ARCHIVED
            "removed" -> REMOVED
            else -> throw IllegalArgumentException("remote_resource_lifecycle_invalid")
        }
    }

    fun toWire(): String = name.lowercase()
}

data class RemoteWorkspaceRef(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val displayName: String,
    val lifecycle: RemoteResourceLifecycle = RemoteResourceLifecycle.ACTIVE,
    val revision: Long = 1,
    val updatedAt: String = "",
) {
    init {
        require(revision > 0) { "workspace_revision_invalid" }
    }
}

@JvmName("activeWorkspacesOnly")
fun Iterable<RemoteWorkspaceRef>.activeOnly(): List<RemoteWorkspaceRef> =
    filter { it.lifecycle == RemoteResourceLifecycle.ACTIVE }

@JvmName("activeSessionsOnly")
fun Iterable<RemoteSessionRef>.activeOnly(): List<RemoteSessionRef> =
    filter { it.lifecycle == RemoteResourceLifecycle.ACTIVE }

data class RemoteConversationItem(
    val eventId: String,
    val sequence: Long,
    val kind: String,
    val timestamp: String,
    val payload: Map<String, Any?>,
) {
    init {
        require(eventId.isNotBlank()) { "conversation_event_id_required" }
        require(sequence > 0) { "conversation_sequence_invalid" }
        require(kind.isNotBlank()) { "conversation_kind_required" }
        require(timestamp.isNotBlank()) { "conversation_timestamp_required" }
    }
}

data class RemoteConversationProjection(
    val items: List<RemoteConversationItem>,
    val nextCursor: String?,
) {
    init {
        require(items.zipWithNext().all { (left, right) -> left.sequence < right.sequence }) {
            "conversation_sequence_not_strictly_increasing"
        }
        require(items.distinctBy { it.eventId }.size == items.size) { "conversation_event_duplicate" }
    }
}

data class RemoteSessionRef(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val title: String,
    val backendId: String,
    val lifecycle: RemoteResourceLifecycle = RemoteResourceLifecycle.ACTIVE,
    val updatedAt: String = "",
) {
    init {
        require(backendId.isNotBlank()) { "backend_id_required" }
    }
}

class RemoteRunIdentity(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val runId: RunId,
    val backendId: String,
) {
    init {
        require(backendId.isNotBlank()) { "backend_id_required" }
    }

    fun requireSameScope(other: RemoteRunIdentity) {
        require(runtimeId == other.runtimeId) { "runtime_identity_mismatch" }
        require(workspaceId == other.workspaceId) { "workspace_identity_mismatch" }
        require(sessionId == other.sessionId) { "session_identity_mismatch" }
        require(runId == other.runId) { "run_identity_mismatch" }
        require(backendId == other.backendId) { "backend_identity_mismatch" }
    }

    override fun equals(other: Any?): Boolean = other is RemoteRunIdentity &&
        runtimeId == other.runtimeId && workspaceId == other.workspaceId &&
        sessionId == other.sessionId && runId == other.runId && backendId == other.backendId

    override fun hashCode(): Int {
        var result = runtimeId.hashCode()
        result = 31 * result + workspaceId.hashCode()
        result = 31 * result + sessionId.hashCode()
        result = 31 * result + runId.hashCode()
        result = 31 * result + backendId.hashCode()
        return result
    }

    override fun toString(): String =
        "RemoteRunIdentity(runtimeId=$runtimeId, workspaceId=$workspaceId, sessionId=$sessionId, runId=$runId, backendId=$backendId)"
}

enum class RemoteRunStatus {
    QUEUED,
    RUNNING,
    WAITING_APPROVAL,
    COMPLETED,
    FAILED,
    CANCELLED,
}

enum class RemoteConnectionState {
    CONNECTING,
    ONLINE,
    DEGRADED,
    OFFLINE,
    AUTH_REQUIRED,
    INCOMPATIBLE,
}

data class RemoteRuntimeEvent(
    val eventId: EventId,
    val identity: RemoteRunIdentity,
    val sequence: Long,
    val type: String,
    val timestamp: String,
    val status: RemoteRunStatus? = null,
) {
    init {
        require(sequence > 0) { "event_sequence_invalid" }
        require(type.isNotBlank()) { "event_type_required" }
        require(timestamp.isNotBlank()) { "event_timestamp_required" }
    }
}

/**
 * A local projection of Runtime-owned state. Android is never authoritative for
 * a remote Run; only a verified Runtime event or state response can advance it.
 */
data class RemoteRunProjection(
    val identity: RemoteRunIdentity,
    val status: RemoteRunStatus,
    val lastSequence: Long = 0,
    val lastSyncedAt: Long? = null,
    val authoritative: Boolean = false,
    val connectionState: RemoteConnectionState = RemoteConnectionState.CONNECTING,
) {
    init {
        require(lastSequence >= 0) { "last_sequence_invalid" }
        require(!authoritative) { "android_remote_projection_cannot_be_authoritative" }
    }

    fun applyRuntimeEvent(event: RemoteRuntimeEvent, syncedAt: Long): RemoteRunProjection {
        identity.requireSameScope(event.identity)
        require(event.sequence > lastSequence) { "event_sequence_not_advanced" }
        return copy(
            status = event.status ?: status,
            lastSequence = event.sequence,
            lastSyncedAt = syncedAt,
            connectionState = RemoteConnectionState.ONLINE,
        )
    }

    /** Transport loss changes connectivity only; it cannot fail a remote Run. */
    fun markConnection(state: RemoteConnectionState): RemoteRunProjection = copy(connectionState = state)
}

data class RemoteDelegationRef(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val remoteSessionId: SessionId,
    val remoteRunId: RunId,
    val lastSequence: Long,
) {
    init { require(lastSequence >= 0) { "last_sequence_invalid" } }
}

data class PendingRemoteApproval(
    val approvalId: ApprovalId,
    val identity: RemoteRunIdentity,
    val operation: String,
    val expiresAt: String,
) {
    init {
        require(operation.isNotBlank()) { "approval_operation_required" }
        require(expiresAt.isNotBlank()) { "approval_expiry_required" }
    }
}
