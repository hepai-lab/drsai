package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepError
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import java.util.ArrayDeque
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import org.json.JSONObject

/** Normalized OAEP boundary for legacy platform chat adapters. */
internal class OaepNormalizingChatEngine(
    private val delegate: ChatEngine,
    private val sink: AndroidOaepNormalizedSink,
) : ChatEngine {
    override val authority = delegate.authority

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> = flow {
        require(request.authority == authority) { "oaep_legacy_engine_authority_mismatch" }
        var sequence = 0L
        var toolSequence = 0L
        val assistant = StringBuilder()
        val pendingTools = mutableMapOf<String, ArrayDeque<String>>()
        suspend fun project(events: List<NormalizedAgentEvent>) {
            if (events.isEmpty()) return
            sequence += 1
            val envelope = PythonRuntimeEnvelope(
                PythonRuntimeMessageType.RUNTIME_EVENT,
                "compat-${request.runId.take(96)}-$sequence",
                request.runId,
                request.conversation.id,
                sequence,
                "compat:${request.runId}:$sequence",
                JSONObject().put("kind", "normalized.compatibility"),
            )
            sink.accept(request, envelope, events)
        }
        delegate.execute(request).collect { event ->
            when (event) {
                is RuntimeEvent.Started -> project(listOf(NormalizedAgentEvent.RunStarted))
                is RuntimeEvent.TextDelta -> {
                    assistant.append(event.text)
                    project(listOf(NormalizedAgentEvent.ItemDelta(
                        request.assistantMessageId, "text", event.text, "message",
                    )))
                }
                is RuntimeEvent.ToolStarted -> {
                    val id = "compat-tool-${++toolSequence}"
                    pendingTools.getOrPut(event.name) { ArrayDeque() }.addLast(id)
                    project(listOf(NormalizedAgentEvent.ItemStarted(
                        id, "tool_call", OaepToolCallContent(
                            toolKind = if (authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "android" else "platform",
                            toolName = event.name, callId = id, arguments = emptyMap(), result = null,
                        ),
                    )))
                }
                is RuntimeEvent.ToolFinished -> {
                    val id = pendingTools[event.name]?.pollFirst() ?: "compat-tool-${++toolSequence}"
                    project(listOf(NormalizedAgentEvent.ItemCompleted(
                        id, "tool_call", OaepToolCallContent(
                            toolKind = if (authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "android" else "platform",
                            toolName = event.name, callId = id, arguments = emptyMap(), result = mapOf("status" to "completed"),
                        ),
                    )))
                }
                is RuntimeEvent.ToolFailed -> {
                    val id = pendingTools[event.name]?.pollFirst() ?: "compat-tool-${++toolSequence}"
                    val content = OaepToolCallContent(
                        toolKind = if (authority == ai.drsai.remote.workbench.model.RuntimeAuthority.LOCAL_DEVICE) "android" else "platform",
                        toolName = event.name, callId = id, arguments = emptyMap(), result = null,
                    )
                    project(listOf(NormalizedAgentEvent.ItemFailed(
                        id, "tool_call", content, OaepError(event.code, "Tool execution failed", false),
                    )))
                }
                is RuntimeEvent.ToolDowngraded -> project(listOf(NormalizedAgentEvent.ItemCompleted(
                    "compat-notice-$sequence", "notice", OaepNoticeContent(
                        "warning", "legacy_tool_downgraded", event.reason.take(512),
                    ),
                )))
                is RuntimeEvent.Artifact -> project(listOf(NormalizedAgentEvent.ItemCompleted(
                    "compat-artifact:${event.attachment.id}", "artifact", OaepArtifactContent(
                        event.attachment.id, event.attachment.kind, event.attachment.name, "Runtime artifact",
                        mimeType = event.attachment.mimeType, size = event.attachment.size,
                        sha256 = event.attachment.sha256, previewable = true, downloadable = true,
                    ),
                )))
                RuntimeEvent.Completed -> project(listOf(
                    NormalizedAgentEvent.ItemCompleted(
                        request.assistantMessageId, "message", OaepMessageContent("assistant", assistant.toString(), "final"),
                    ),
                    NormalizedAgentEvent.RunCompleted,
                ))
                RuntimeEvent.Paused -> project(listOf(NormalizedAgentEvent.RunWaiting("legacy_engine_paused", null)))
                RuntimeEvent.Cancelled -> project(listOf(NormalizedAgentEvent.RunCancelled))
                is RuntimeEvent.Failed -> project(listOf(NormalizedAgentEvent.RunFailed(OaepError(
                    "legacy_engine_failed", event.message.take(512), event.retryable,
                ))))
            }
            emit(event)
        }
    }

    override fun pause(runId: String) = delegate.pause(runId)
    override fun stop(runId: String) = delegate.stop(runId)
}
