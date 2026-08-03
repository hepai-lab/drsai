package ai.drsai.remote.remote.model

import ai.drsai.remote.remote.generated.*
import java.security.MessageDigest

enum class RemoteEventKind {
    QUEUED, STARTED, MESSAGE_DELTA, TOOL_STARTED, TOOL_FINISHED, WORKSPACE_CHANGED,
    APPROVAL_REQUESTED, APPROVAL_RESOLVED, ARTIFACT_CREATED, COMPLETED, FAILED, CANCELLED,
}

data class RemoteTranscriptMessage(
    val id: String,
    val role: String,
    val text: String,
    val progress: String? = null,
    val kind: String = "message",
    val title: String? = null,
    val detail: String? = null,
)

fun projectOaepMessages(items: List<OaepItem>): List<RemoteTranscriptMessage> =
    items.sortedWith(compareBy<OaepItem> { it.runId }.thenBy { it.sequence }).map { item ->
        when (val content = item.content) {
            is OaepMessageContent -> RemoteTranscriptMessage(
                item.id, content.role, sanitizeRemoteTranscriptText(content.text), item.status,
                kind = "message",
            )
            is OaepReasoningContent -> RemoteTranscriptMessage(
                item.id, "reasoning",
                sanitizeRemoteTranscriptText(content.segments.joinToString("\n") { it["text"].orEmpty() }),
                item.status, kind = "reasoning", title = "Reasoning",
            )
            is OaepPlanContent -> RemoteTranscriptMessage(
                item.id, "plan", sanitizeRemoteTranscriptText(content.text), item.status,
                kind = "plan", title = "Plan",
            )
            is OaepCommandExecutionContent -> RemoteTranscriptMessage(
                item.id, "command", sanitizeRemoteTranscriptText(content.output.ifBlank { content.stdoutTail.orEmpty() }),
                item.status, kind = "command_execution", title = "Command",
                detail = sanitizeRemoteTranscriptText(content.displayCommand),
            )
            is OaepToolCallContent -> RemoteTranscriptMessage(
                item.id, "tool", safeToolResult(content.result, item.status), item.status,
                kind = "tool_call", title = content.toolName.ifBlank { "Tool" },
                detail = content.toolKind,
            )
            is OaepFileChangeContent -> RemoteTranscriptMessage(
                item.id, "file", sanitizeRemoteTranscriptText(content.summary), item.status,
                kind = "file_change", title = "File change",
            )
            is OaepArtifactContent -> RemoteTranscriptMessage(
                item.id, "artifact", sanitizeRemoteTranscriptText(content.summary), item.status,
                kind = "artifact", title = content.name.ifBlank { "Artifact" },
                detail = content.mimeType,
            )
            is OaepInteractionContent -> RemoteTranscriptMessage(
                item.id, "interaction", sanitizeRemoteTranscriptText(content.prompt), item.status,
                kind = "interaction", title = content.interactionType.ifBlank { "Interaction" },
                detail = content.operation,
            )
            is OaepSubtaskContent -> RemoteTranscriptMessage(
                item.id, "subtask", sanitizeRemoteTranscriptText(content.summary), item.status,
                kind = "subtask", title = content.title.ifBlank { "Subtask" },
                detail = content.agentName,
            )
            is OaepNoticeContent -> RemoteTranscriptMessage(
                item.id, "system", sanitizeRemoteTranscriptText(content.message), item.status,
                kind = "notice", title = content.code.ifBlank { content.level },
            )
        }
    }.filter { it.text.isNotBlank() || it.progress != null }

private fun safeToolResult(result: Any?, status: String): String = when (result) {
    null -> status
    is String -> sanitizeRemoteTranscriptText(result)
    is Number, is Boolean -> result.toString()
    is Map<*, *> -> sanitizeRemoteTranscriptText(
        (result["summary"] ?: result["message"] ?: result["status"] ?: status).toString(),
    )
    else -> status
}

fun sanitizeRemoteTranscriptText(value: String): String =
    value
        .replace(Regex("(?i)(token|secret|password|api[_-]?key)=\\S+"), "$1=[REDACTED]")
        .replace(Regex("\\b[A-Za-z]:[\\\\/][^\\s`'\"<>]+"), "[path]")
        .take(20_000)

fun projectConversationMessages(items: List<RemoteConversationItem>): List<RemoteTranscriptMessage> {
    val ordered = items.distinctBy { it.eventId }.sortedBy { it.sequence }
    require(ordered.zipWithNext().all { (left, right) -> left.sequence < right.sequence }) {
        "conversation_sequence_not_strictly_increasing"
    }
    val messages = mutableListOf<RemoteTranscriptMessage>()
    val assistantByRun = linkedMapOf<String, Int>()
    ordered.forEach { item ->
        val runId = item.payload["run_id"]?.toString().orEmpty()
        when (item.kind) {
            "message.user", "message.assistant", "message.system" -> {
                val role = item.kind.substringAfter('.')
                val content = item.payload["content"]?.toString().orEmpty()
                if (content.isNotBlank()) messages += RemoteTranscriptMessage(item.eventId, role, content)
            }
            "reasoning.summary" -> {
                val summary = (
                    item.payload["summary"] ?: item.payload["content"]
                )?.toString().orEmpty().take(20_000)
                if (summary.isNotBlank()) {
                    messages += RemoteTranscriptMessage(
                        item.eventId, "reasoning", summary,
                    )
                }
            }
            "message.delta" -> {
                val delta = item.payload["delta"]?.toString().orEmpty()
                if (delta.isNotEmpty()) {
                    val index = assistantByRun.getOrPut(runId.ifBlank { item.eventId }) {
                        messages.add(RemoteTranscriptMessage("assistant:${runId.ifBlank { item.eventId }}", "assistant", ""))
                        messages.lastIndex
                    }
                    messages[index] = messages[index].copy(text = messages[index].text + delta)
                }
            }
            "tool.started", "tool.finished" -> {
                val key = runId.ifBlank { item.eventId }
                val index = assistantByRun.getOrPut(key) {
                    messages.add(RemoteTranscriptMessage("assistant:$key", "assistant", ""))
                    messages.lastIndex
                }
                messages[index] = messages[index].copy(progress = item.kind)
            }
            "run.completed", "run.failed", "run.cancelled" -> {
                val fallback = when (item.kind) {
                    "run.completed" -> "任务已完成"
                    "run.failed" -> "任务执行失败"
                    else -> "任务已取消"
                }
                val detail = (
                    item.payload["message"] ?: item.payload["summary"]
                )?.toString()?.take(20_000)
                messages += RemoteTranscriptMessage(
                    item.eventId,
                    "system",
                    detail?.takeIf(String::isNotBlank) ?: fallback,
                    item.kind,
                )
            }
            else -> {
                // Unknown future event kinds never crash or expose the whole
                // payload. Only an explicitly textual field is projected.
                val safeText = (
                    item.payload["content"] ?: item.payload["message"]
                    ?: item.payload["summary"]
                )?.toString().orEmpty().take(20_000)
                if (safeText.isNotBlank()) {
                    messages += RemoteTranscriptMessage(
                        item.eventId, "system", safeText, "未知事件：${item.kind.take(80)}",
                    )
                }
            }
        }
    }
    return messages.filter { it.text.isNotBlank() || it.progress != null }
}

fun conversationProjectionDigest(items: List<RemoteConversationItem>): String {
    val canonical = buildString {
        fun appendField(value: String?) {
            if (value == null) {
                append("-1:")
            } else {
                append(value.toByteArray(Charsets.UTF_8).size)
                append(':')
                append(value)
            }
        }
        projectConversationMessages(items).forEach { message ->
            appendField(message.id)
            appendField(message.role)
            appendField(message.text)
            appendField(message.progress)
        }
    }
    return MessageDigest.getInstance("SHA-256")
        .digest(canonical.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
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
