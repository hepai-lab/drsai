package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.CompletedToolCall
import ai.drsai.remote.data.ModelDelta
import ai.drsai.remote.data.ModelGateway
import ai.drsai.remote.data.ToolChoiceAwareModelGateway
import ai.drsai.remote.data.PinnedModelRouteGateway
import ai.drsai.remote.data.RuntimeMessage
import ai.drsai.remote.data.LocalToolRegistry
import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.ApiException
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.PowerManager
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class HaiPythonModelHostPort(
    private val gateway: ModelGateway,
    private val capabilityResolver: (String) -> ModelRuntimeCapabilities? = { null },
) : PythonModelHostPort {
    override fun stream(request: HostModelRequest): Flow<HostModelChunk> = channelFlow {
        val modelCapabilities = capabilityResolver(request.modelId)
        modelCapabilities?.requireRunSupport(request.tools.length())
        val calls = StreamedToolCallAssembler()
        var finishReason: String? = null
        var receivedDelta = false
        suspend fun complete(tools: JSONArray) {
            val messages = request.messages.toRuntimeMessages()
            val consume: suspend (ModelDelta) -> Unit = { delta ->
                if (!delta.content.isNullOrEmpty() || delta.toolCalls.isNotEmpty()) receivedDelta = true
                delta.content?.takeIf(String::isNotEmpty)?.let {
                    send(HostModelChunk(request.requestId, delta = it))
                }
                delta.reasoningSummary?.takeIf(String::isNotEmpty)?.let {
                    send(HostModelChunk(request.requestId, reasoningSummary = it))
                }
                delta.toolCalls.forEach { part ->
                    calls.append(part)
                }
                if (delta.finishReason != null) finishReason = delta.finishReason
            }
            if (gateway is PinnedModelRouteGateway && request.modelRouteSnapshot != null) {
                gateway.streamCompletionWithPinnedRoute(
                    request.modelId, request.modelRouteSnapshot, messages, tools, request.toolChoice, consume,
                )
            } else if (gateway is ToolChoiceAwareModelGateway) {
                gateway.streamCompletionWithToolChoice(
                    request.modelId, messages, tools, request.toolChoice, consume,
                )
            } else {
                gateway.streamCompletionWithTools(request.modelId, messages, tools, consume)
            }
        }
        try {
            complete(request.tools)
        } catch (error: ApiException) {
            if (error.code != null) throw error
            if (error.status != 400 || request.tools.length() == 0 || receivedDelta) throw error
            throw ApiException(
                status = error.status,
                message = "model_tools_unsupported:${request.modelId}:${error.message}",
                retryable = false,
                code = "model_tools_unsupported",
            )
        }
        val completedCalls = calls.finish()
        modelCapabilities?.requireToolCallBatch(completedCalls.length())
        send(
            HostModelChunk(
                requestId = request.requestId,
                finishReason = finishReason ?: "stop",
                toolCalls = JSONArray((0 until completedCalls.length()).map { index ->
                    completedCalls.getJSONObject(index).also { call ->
                        request.tools.findTool(call.getString("name"))?.let { schema ->
                            call.put("requires_approval", schema.optBoolean("requires_approval"))
                                .put("risk", schema.optString("risk", "sensitive"))
                                .put("title", schema.optString("title", call.getString("name")))
                                .put("summary", schema.optString("summary", schema.optString("description")))
                                .putOpt("oaep_output_type", schema.optString("oaep_output_type").takeIf(String::isNotBlank))
                        }
                    }
                }),
            )
        )
    }

}

fun interface PythonToolExecutor {
    suspend fun execute(call: HostToolCall): HostToolResult
}

class AndroidPythonToolHostPort(
    private val executor: PythonToolExecutor,
    private val riskResolver: (String) -> String? = { null },
) : PythonToolHostPort {
    override suspend fun execute(call: HostToolCall): HostToolResult = executor.execute(call)
    override fun authoritativeRisk(toolName: String): String? = riskResolver(toolName)
}

class LocalToolRegistryPythonExecutor(
    private val registry: LocalToolRegistry,
    private val accountSubject: String,
    private val runId: String,
    private val sessionId: String,
    private val approvals: PythonApprovalGrantTracker,
) : PythonToolExecutor {
    override suspend fun execute(call: HostToolCall): HostToolResult {
        val result = registry.executeDetailed(
            accountSubject,
            CompletedToolCall(call.callId, call.name, call.arguments.toString()),
            runId,
            sessionId,
            approved = call.approved || approvals.consume(call.callId),
        )
        val content = runCatching { JSONObject(result.output) }
            .getOrElse { JSONObject().put("text", result.output) }
        return HostToolResult(
            callId = call.callId,
            succeeded = result.succeeded,
            content = content,
            errorCode = result.code,
            artifactIds = listOfNotNull(content.optString("artifact_id").takeIf(String::isNotBlank)),
        )
    }
}

class PythonApprovalGrantTracker {
    private val approved = ConcurrentHashMap.newKeySet<String>()
    fun approve(callId: String) { approved += callId }
    fun consume(callId: String): Boolean = approved.remove(callId)
}

class LocalToolRegistryPythonApprovalPort(
    private val registry: LocalToolRegistry,
    private val accountSubject: String,
    private val runId: String,
    private val sessionId: String,
    private val grants: PythonApprovalGrantTracker,
) : PythonApprovalHostPort {
    override suspend fun request(request: HostApprovalRequest): HostApprovalDecision {
        val approved = registry.awaitApproval(
            accountSubject,
            CompletedToolCall(request.callId, request.name, request.arguments.toString()),
            runId,
            sessionId,
        )
        if (approved) grants.approve(request.callId)
        return HostApprovalDecision(request.approvalId, if (approved) "approved" else "rejected")
    }
}

/** Exposes only artifacts explicitly scoped to the current account/run/session. */
class ScopedPythonArtifactHostPort(
    private val dao: ChatDao,
    private val accountSubject: String,
    private val runId: String,
    private val sessionId: String,
    attachments: List<MessageAttachment>,
) : PythonArtifactHostPort {
    private val attachments = attachments.associateBy(MessageAttachment::id)

    override suspend fun describe(artifactId: String): HostArtifactDescriptor {
        val source = source(artifactId)
        return HostArtifactDescriptor(artifactId, source.mimeType, source.size, source.sha256())
    }

    override suspend fun readChunk(artifactId: String, offset: Long, length: Int): ByteArray {
        require(offset >= 0 && length in 0..65_536) { "artifact_chunk_invalid" }
        return source(artifactId).read(offset, length)
    }

    private suspend fun source(artifactId: String): ArtifactSource {
        attachments[artifactId]?.let { attachment ->
            require(attachment.conversationId == sessionId) { "artifact_scope_mismatch" }
            val path = requireNotNull(attachment.localPath) { "artifact_local_content_unavailable" }
            require(!path.startsWith("content://")) { "artifact_uri_exposure_forbidden" }
            val file = File(path)
            require(file.isFile) { "artifact_file_missing" }
            return FileArtifactSource(attachment.mimeType, file, attachment.sha256.takeIf { it.matches(Regex("^[a-fA-F0-9]{64}$")) })
        }
        val artifact = dao.toolArtifacts(accountSubject, runId)
            .firstOrNull { it.id == artifactId && it.sessionId == sessionId }
            ?: error("artifact_not_found")
        return ByteArtifactSource("text/plain", artifact.content.toByteArray(Charsets.UTF_8))
    }

    private sealed interface ArtifactSource {
        val mimeType: String
        val size: Long
        fun sha256(): String
        fun read(offset: Long, length: Int): ByteArray
    }

    private data class FileArtifactSource(
        override val mimeType: String,
        val file: File,
        val knownSha256: String?,
    ) : ArtifactSource {
        override val size: Long get() = file.length()
        override fun sha256(): String = knownSha256?.lowercase() ?: MessageDigest.getInstance("SHA-256").let { digest ->
            file.inputStream().buffered().use { input ->
                val buffer = ByteArray(32 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }
        override fun read(offset: Long, length: Int): ByteArray {
            if (offset >= size || length == 0) return ByteArray(0)
            return RandomAccessFile(file, "r").use { input ->
                input.seek(offset)
                val buffer = ByteArray(minOf(length.toLong(), size - offset).toInt())
                val count = input.read(buffer)
                if (count <= 0) ByteArray(0) else buffer.copyOf(count)
            }
        }
    }

    private data class ByteArtifactSource(override val mimeType: String, val bytes: ByteArray) : ArtifactSource {
        override val size: Long get() = bytes.size.toLong()
        override fun sha256(): String = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        override fun read(offset: Long, length: Int): ByteArray {
            if (offset >= size || length == 0) return ByteArray(0)
            val start = offset.toInt()
            return bytes.copyOfRange(start, minOf(bytes.size, start + length))
        }
    }
}

class AndroidPythonLifecycleHostPort(context: Context) : PythonLifecycleHostPort {
    private val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    private val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager

    override suspend fun current(): PythonRuntimeLifecycleState {
        val memory = ActivityManager.MemoryInfo().also(activity::getMemoryInfo)
        if (memory.lowMemory) return PythonRuntimeLifecycleState.LOW_MEMORY
        if (Build.VERSION.SDK_INT >= 29 && power.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) {
            return PythonRuntimeLifecycleState.THERMAL_LIMITED
        }
        return if (ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) {
            PythonRuntimeLifecycleState.FOREGROUND
        } else PythonRuntimeLifecycleState.BACKGROUND
    }
}

private fun JSONArray.findTool(name: String): JSONObject? {
    repeat(length()) { index ->
        getJSONObject(index).takeIf { it.optString("name") == name }?.let { return it }
    }
    return null
}

private fun JSONArray.toRuntimeMessages(): List<RuntimeMessage> = buildList {
    repeat(length()) { index ->
        val row = getJSONObject(index)
        val role = row.getString("role")
        val rawContent = row.opt("content")
        val content = when (rawContent) {
            null, JSONObject.NULL -> ""
            is String -> rawContent
            else -> rawContent.toString()
        }
        val toolCalls = row.optJSONArray("tool_calls")?.let { values ->
            buildList {
                repeat(values.length()) { callIndex ->
                    val call = values.getJSONObject(callIndex)
                    add(
                        CompletedToolCall(
                            call.getString("call_id"),
                            call.getString("name"),
                            call.optJSONObject("arguments")?.toString() ?: "{}",
                        )
                    )
                }
            }
        }.orEmpty()
        add(
            RuntimeMessage(
                role = role,
                content = content,
                toolCallId = row.optString("tool_call_id").ifBlank { null },
                toolCalls = toolCalls,
            )
        )
    }
}
