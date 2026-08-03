package ai.drsai.remote.runtime.python

import kotlinx.coroutines.flow.Flow
import org.json.JSONArray
import org.json.JSONObject

enum class PythonRuntimeLifecycleState { FOREGROUND, BACKGROUND, LOW_MEMORY, THERMAL_LIMITED }

data class HostModelRequest(
    val requestId: String,
    val modelId: String,
    val messages: JSONArray,
    val tools: JSONArray = JSONArray(),
)

data class HostModelChunk(
    val requestId: String,
    val delta: String = "",
    val finishReason: String? = null,
    val toolCalls: JSONArray = JSONArray(),
)

data class HostToolCall(
    val callId: String,
    val name: String,
    val arguments: JSONObject,
    val idempotencyKey: String,
    val approved: Boolean = false,
)

data class HostToolResult(
    val callId: String,
    val succeeded: Boolean,
    val content: JSONObject,
    val errorCode: String? = null,
    val artifactIds: List<String> = emptyList(),
)

data class HostApprovalRequest(
    val approvalId: String,
    val callId: String,
    val risk: String,
    val title: String,
    val summary: String,
    val name: String,
    val arguments: JSONObject,
)

data class HostApprovalDecision(val approvalId: String, val decision: String)
data class HostCheckpoint(val runId: String, val sequence: Long, val state: JSONObject)
data class HostArtifactDescriptor(val artifactId: String, val mimeType: String, val size: Long, val sha256: String)
data class HostArtifactMutation(
    val operationId: String,
    val operation: String,
    val artifactId: String?,
    val payload: JSONObject,
)
data class HostArtifactMutationResult(
    val operationId: String,
    val artifactId: String,
    val succeeded: Boolean,
    val details: JSONObject = JSONObject(),
)

interface PythonModelHostPort { fun stream(request: HostModelRequest): Flow<HostModelChunk> }
interface PythonStateStoreHostPort {
    suspend fun saveCheckpoint(checkpoint: HostCheckpoint)
    suspend fun loadCheckpoint(runId: String): HostCheckpoint?
}
interface PythonToolHostPort { suspend fun execute(call: HostToolCall): HostToolResult }
interface PythonApprovalHostPort { suspend fun request(request: HostApprovalRequest): HostApprovalDecision }
interface PythonArtifactHostPort {
    suspend fun describe(artifactId: String): HostArtifactDescriptor
    suspend fun readChunk(artifactId: String, offset: Long, length: Int): ByteArray
    suspend fun mutate(request: HostArtifactMutation): HostArtifactMutationResult =
        error("artifact_mutation_not_supported")
}
interface PythonLifecycleHostPort { suspend fun current(): PythonRuntimeLifecycleState }
data class HostSideEffectAudit(
    val runId: String,
    val operationId: String,
    val kind: String,
    val phase: String,
    val outcome: String,
)
interface PythonSideEffectAuditHostPort {
    suspend fun append(record: HostSideEffectAudit) = Unit
}

data class PythonRuntimeHostPorts(
    val model: PythonModelHostPort,
    val stateStore: PythonStateStoreHostPort,
    val tools: PythonToolHostPort,
    val approval: PythonApprovalHostPort,
    val artifacts: PythonArtifactHostPort,
    val lifecycle: PythonLifecycleHostPort,
    val audit: PythonSideEffectAuditHostPort = object : PythonSideEffectAuditHostPort {},
)
