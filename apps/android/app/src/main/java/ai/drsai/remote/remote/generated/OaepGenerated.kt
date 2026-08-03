// Generated from cores/protocol/oaep/oaep.schema.json; do not edit.
package ai.drsai.remote.remote.generated

object OaepContract {
    const val SCHEMA_SHA256 = "92020971b3fb9d549ff08e10221bf34db13213e5206a9aa4b5222461a9f011ae"
    const val VERSION = "1.0"
    const val PROFILE = "oaep.session-stream/1"
    val ITEM_TYPES = setOf("message", "reasoning", "plan", "command_execution", "file_change", "tool_call", "artifact", "interaction", "subtask", "notice")
    val ITEM_STATUSES = setOf("pending", "running", "waiting", "completed", "failed", "cancelled")
    val EVENT_TYPES = setOf("event.session.created", "event.session.updated", "event.session.archived", "event.session.unarchived", "event.session.deleted", "event.run.created", "event.run.started", "event.run.waiting", "event.run.resumed", "event.run.completed", "event.run.failed", "event.run.cancelled", "event.item.created", "event.item.started", "event.item.delta", "event.item.updated", "event.item.completed", "event.item.failed", "event.item.cancelled")
}

data class OaepSource(val backend: String, val backendItemId: String? = null, val backendEventId: String? = null, val client: String? = null, val messageId: String? = null, val runtimeId: String? = null, val backendVersion: String? = null, val adapter: String? = null, val adapterVersion: String? = null, val mappingVersion: String? = null, val backendRunId: String? = null, val backendRunIndex: Long? = null)
data class OaepError(val code: String, val message: String, val retryable: Boolean, val details: Map<String, Any?> = emptyMap())
data class OaepOperationRef(val protocol: String = "owop/1", val operationId: String, val workspaceId: String, val operation: String, val correlationId: String)
data class OaepResourceRef(val protocol: String = "owop/1", val workspaceId: String, val resourceType: String, val resourceId: String, val operationId: String? = null, val label: String? = null, val digest: String? = null)
sealed interface OaepItemContent { val operationRef: OaepOperationRef?; val resourceRefs: List<OaepResourceRef> }
data class OaepMessageContent(val role: String, val text: String, val phase: String? = null, val citations: List<Map<String, Any?>> = emptyList(), val parts: List<Map<String, Any?>> = emptyList(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepReasoningContent(val segments: List<Map<String, String>>, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepPlanContent(val text: String, val steps: List<Map<String, Any?>>, val explanation: String? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepCommandExecutionContent(val command: List<String>, val displayCommand: String, val cwd: String, val output: String, val stdoutTail: String? = null, val stderrTail: String? = null, val exitCode: Int? = null, val durationMs: Double? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepToolCallContent(val toolKind: String, val toolName: String, val callId: String, val arguments: Map<String, Any?>, val result: Any?, val server: String? = null, val durationMs: Double? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepFileChangeContent(val changes: List<Map<String, Any?>>, val summary: String, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepArtifactContent(val artifactId: String, val artifactType: String, val name: String, val summary: String, val path: String? = null, val mimeType: String? = null, val size: Long? = null, val sha256: String? = null, val previewable: Boolean = false, val downloadable: Boolean = false, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepInteractionContent(val interactionType: String, val prompt: String, val options: List<Map<String, Any?>>, val approvalId: String? = null, val operation: String? = null, val requestSummary: Map<String, Any?> = emptyMap(), val relatedItemId: String? = null, val response: Any? = null, val deadlineAt: String? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepSubtaskContent(val title: String, val summary: String, val agentName: String? = null, val childRunId: String? = null, val result: Any? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepNoticeContent(val level: String, val code: String, val message: String, val error: OaepError? = null, val details: Map<String, Any?> = emptyMap(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepSession(val id: String, val workspaceId: String, val title: String?, val status: String, val backend: String?, val createdAt: String, val updatedAt: String)
data class OaepRun(val id: String, val sessionId: String, val parentRunId: String?, val sequence: Long? = null, val source: OaepSource? = null, val status: String, val createdAt: String, val updatedAt: String, val completedAt: String?)
data class OaepItem(val id: String, val sessionId: String, val runId: String, val type: String, val status: String, val sequence: Long, val createdAt: String, val updatedAt: String, val source: OaepSource, val content: OaepItemContent)
data class OaepDelta(val kind: String, val text: String? = null, val segmentId: String? = null, val stream: String? = null)
data class OaepEventData(val item: OaepItem? = null, val delta: OaepDelta? = null, val error: OaepError? = null, val extra: Map<String, Any?> = emptyMap())
data class OaepEvent(val version: String, val eventId: String, val sessionId: String, val runId: String?, val itemId: String?, val sequence: Long, val type: String, val timestamp: String, val dedupeKey: String, val source: OaepSource, val data: OaepEventData)
data class OaepSnapshot(val version: String, val session: OaepSession, val runs: List<OaepRun>, val items: List<OaepItem>, val snapshotSequence: Long)
data class OaepEventPage(val version: String, val objectType: String, val data: List<OaepEvent>, val nextSequence: Long, val hasMore: Boolean)
