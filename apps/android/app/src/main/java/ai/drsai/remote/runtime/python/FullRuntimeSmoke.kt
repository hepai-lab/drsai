package ai.drsai.remote.runtime.python

import android.content.Context
import java.security.MessageDigest
import java.time.OffsetDateTime
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import org.json.JSONArray
import org.json.JSONObject

data class FullRuntimeSmokeIdentity(
    val accountSubject: String,
    val providerId: String,
    val providerRevision: Long,
    val modelId: String,
    val runtimeVersion: String,
    val credentialGeneration: Long,
) {
    fun fingerprint(): String = sha256(
        listOf(accountSubject, providerId, providerRevision.toString(), modelId, runtimeVersion, credentialGeneration.toString()).joinToString("\u0000"),
    )
}

data class FullRuntimeSmokeReport(
    val modelRequests: Int,
    val toolCalls: Int,
    val successfulToolResults: Int,
    val finalAnswers: Int,
    val runCompleted: Boolean,
    val runFailed: Boolean,
) {
    val passed: Boolean get() = modelRequests >= 2 && toolCalls >= 1 &&
        successfulToolResults == toolCalls && finalAnswers >= 1 && runCompleted && !runFailed
}

class FullRuntimeSmokeStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("p10_full_runtime_smoke_v1", Context.MODE_PRIVATE)

    fun isVerified(identity: FullRuntimeSmokeIdentity): Boolean =
        preferences.getBoolean("verified:${identity.fingerprint()}", false)

    fun saveVerified(identity: FullRuntimeSmokeIdentity, report: FullRuntimeSmokeReport, checkedAt: Long) {
        require(report.passed) { "full_runtime_smoke_incomplete" }
        check(preferences.edit()
            .putBoolean("verified:${identity.fingerprint()}", true)
            .putLong("checked:${identity.fingerprint()}", checkedAt)
            .commit()) { "full_runtime_smoke_write_failed" }
    }
}

/** Executes the shared Python kernel and its real Host Port boundary with one read-only clock tool. */
class FullRuntimeSmokeRunner(
    private val bridge: PythonRuntimeBridge,
    private val model: PythonModelHostPort,
) {
    suspend fun run(modelId: String): FullRuntimeSmokeReport {
        require(modelId.isNotBlank()) { "full_runtime_smoke_model_required" }
        val runId = "p10-smoke-${UUID.randomUUID()}"
        var checkpoint: HostCheckpoint? = null
        var modelRequests = 0
        var toolCalls = 0
        var successfulToolResults = 0
        var finalAnswers = 0
        var runCompleted = false
        var runFailed = false
        val countingModel = object : PythonModelHostPort {
            override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
                modelRequests += 1
                return model.stream(request)
            }
        }
        val ports = PythonRuntimeHostPorts(
            model = countingModel,
            stateStore = object : PythonStateStoreHostPort {
                override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
                override suspend fun loadCheckpoint(runId: String) = checkpoint?.takeIf { it.runId == runId }
            },
            tools = object : PythonToolHostPort {
                override fun authoritativeRisk(toolName: String) = "read_only".takeIf { toolName == "get_current_time" }
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    require(call.name == "get_current_time") { "full_runtime_smoke_unexpected_tool" }
                    toolCalls += 1
                    return HostToolResult(call.callId, true, JSONObject().put("time", OffsetDateTime.now().toString()))
                        .also { successfulToolResults += 1 }
                }
            },
            approval = object : PythonApprovalHostPort {
                override suspend fun request(request: HostApprovalRequest): HostApprovalDecision =
                    error("full_runtime_smoke_approval_forbidden")
            },
            artifacts = object : PythonArtifactHostPort {
                override suspend fun describe(artifactId: String): HostArtifactDescriptor = error("full_runtime_smoke_artifact_forbidden")
                override suspend fun readChunk(artifactId: String, offset: Long, length: Int): ByteArray = error("full_runtime_smoke_artifact_forbidden")
            },
            lifecycle = object : PythonLifecycleHostPort {
                override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
            },
        )
        val tool = JSONObject()
            .put("name", "get_current_time").put("version", 1).put("source", "android-host")
            .put("classification", "local-equivalent").put("description", "Read the current time for a side-effect-free Full Runtime check")
            .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
            .put("required_capabilities", JSONArray()).put("risk", "read_only").put("requires_approval", false)
        val start = PythonRuntimeEnvelope(
            PythonRuntimeMessageType.START_RUN, "$runId:start", runId, "$runId:session", 0, "$runId:start",
            JSONObject()
                .put("input", "This is an Android Full Runtime functional check. You must call get_current_time, then confirm completion in one sentence using the tool result.")
                .put("model_id", modelId)
                .put("host_capabilities", JSONArray(listOf("chat", "streaming")))
                .put("tools", JSONArray().put(tool)),
        )
        PythonAgentLoopCoordinator(bridge, ports).execute(start).collect { envelope ->
            when (envelope.payload.optString("kind")) {
                "message.completed" -> if (envelope.payload.optString("text").isNotBlank()) finalAnswers += 1
                "run.completed" -> runCompleted = true
                "run.failed", "run.cancelled" -> runFailed = true
            }
        }
        return FullRuntimeSmokeReport(
            modelRequests, toolCalls, successfulToolResults, finalAnswers, runCompleted, runFailed,
        )
    }
}

private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
