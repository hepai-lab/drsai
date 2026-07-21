package ai.drsai.remote.remote.model

enum class RemoteEventKind {
    QUEUED, STARTED, MESSAGE_DELTA, TOOL_STARTED, TOOL_FINISHED, WORKSPACE_CHANGED,
    APPROVAL_REQUESTED, APPROVAL_RESOLVED, ARTIFACT_CREATED, COMPLETED, FAILED, CANCELLED,
}

fun remoteEventKind(value: String): RemoteEventKind = when (value) {
    "run.queued" -> RemoteEventKind.QUEUED
    "run.started" -> RemoteEventKind.STARTED
    "message.delta" -> RemoteEventKind.MESSAGE_DELTA
    "tool.started" -> RemoteEventKind.TOOL_STARTED
    "tool.finished" -> RemoteEventKind.TOOL_FINISHED
    "workspace.changed" -> RemoteEventKind.WORKSPACE_CHANGED
    "approval.requested" -> RemoteEventKind.APPROVAL_REQUESTED
    "approval.resolved" -> RemoteEventKind.APPROVAL_RESOLVED
    "artifact.created" -> RemoteEventKind.ARTIFACT_CREATED
    "run.completed" -> RemoteEventKind.COMPLETED
    "run.failed" -> RemoteEventKind.FAILED
    "run.cancelled" -> RemoteEventKind.CANCELLED
    else -> error("unsupported_remote_event_kind")
}

data class RemoteRunRequest(
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val message: String,
    val attachmentRefs: List<String>,
    val idempotencyKey: String,
    val retryOf: RunId? = null,
) {
    init {
        require(idempotencyKey.length >= 8) { "idempotency_key_invalid" }
        require(attachmentRefs.none { it.contains('/') || it.contains('\\') || it.startsWith("file:") }) {
            "android_local_path_forbidden"
        }
    }
}

enum class ApprovalRisk { COMMAND, FILE_WRITE, PATCH, GIT_WRITE, USER_INPUT, UNKNOWN }

data class RemoteApprovalCard(
    val approvalId: ApprovalId,
    val identity: RemoteRunIdentity,
    val runtimeName: String,
    val workspaceName: String,
    val agentName: String,
    val operation: String,
    val riskSummary: String,
    val scope: String,
    val expiresAt: String,
    val correlationId: String,
) {
    val risk: ApprovalRisk = when {
        operation.startsWith("shell.") -> ApprovalRisk.COMMAND
        operation.startsWith("file.write") -> ApprovalRisk.FILE_WRITE
        operation.contains("patch") -> ApprovalRisk.PATCH
        operation.startsWith("git.") -> ApprovalRisk.GIT_WRITE
        operation.contains("input") -> ApprovalRisk.USER_INPUT
        else -> ApprovalRisk.UNKNOWN
    }
    val safeSummary: String = riskSummary.replace(Regex("(?i)(token|secret|password)=\\S+"), "$1=[REDACTED]").take(512)
    val safeScope: String = scope.take(256)
}

class RemoteRunEventAccumulator(private val identity: RemoteRunIdentity, initialSequence: Long = 0) {
    var lastSequence: Long = initialSequence
        private set
    var text: String = ""
        private set
    var status: RemoteRunStatus = RemoteRunStatus.QUEUED
        private set

    fun apply(event: RemoteRuntimeEvent, delta: String? = null) {
        identity.requireSameScope(event.identity)
        require(event.sequence == lastSequence + 1) { "remote_event_sequence_gap" }
        val kind = remoteEventKind(event.type)
        if (kind == RemoteEventKind.MESSAGE_DELTA) text += delta.orEmpty()
        status = when (kind) {
            RemoteEventKind.STARTED -> RemoteRunStatus.RUNNING
            RemoteEventKind.APPROVAL_REQUESTED -> RemoteRunStatus.WAITING_APPROVAL
            RemoteEventKind.COMPLETED -> RemoteRunStatus.COMPLETED
            RemoteEventKind.FAILED -> RemoteRunStatus.FAILED
            RemoteEventKind.CANCELLED -> RemoteRunStatus.CANCELLED
            else -> status
        }
        lastSequence = event.sequence
    }
}
