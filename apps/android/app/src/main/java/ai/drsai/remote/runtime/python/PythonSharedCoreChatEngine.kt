package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.ModelGateway
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.PinnedModelRoute
import ai.drsai.remote.data.PinnedModelRouteGateway
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.toEntity
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.oaep.AndroidOaepNormalizedSink
import ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitch
import ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitchSnapshot
import ai.drsai.remote.workbench.model.RuntimeAuthority
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject

fun interface PythonHostPortsFactory {
    fun create(request: ChatRunRequest): PythonRuntimeHostPorts
}

internal object ProjectInstructionEnvelope {
    fun merge(agent: JSONObject, fields: JSONObject): JSONObject {
        require(fields.keys().asSequence().all {
            it in setOf("project_instructions", "project_instruction_versions")
        }) { "project_instruction_agent_fields_invalid" }
        fields.optString("project_instructions").takeIf(String::isNotBlank)
            ?.let { agent.put("project_instructions", it) }
        fields.optJSONObject("project_instruction_versions")
            ?.let { agent.put("project_instruction_versions", it) }
        return agent
    }
}

internal object ModelContextBudgetEnvelope {
    fun from(model: ModelInfo?): JSONObject {
        val window = model?.contextTokens?.takeIf { it >= 1_024 } ?: 32_768
        // HaiModelClient currently requests at most 2K output tokens. Never reserve less
        // than the actual Host request even if provider metadata is incomplete or stale.
        val requestedReserve = maxOf(2_048, model?.maxOutputTokens?.takeIf { it > 0 } ?: 4_096)
        val reserve = requestedReserve.coerceAtMost(window - 1)
        return JSONObject()
            .put("policy_version", "p9-context-budget-v1")
            .put("context_window_tokens", window)
            .put("reserved_output_tokens", reserve)
            .put("max_messages", 40)
            .put("summary_tokens", minOf(1_024, maxOf(0, (window - reserve) / 8)))
    }
}

internal object MemoryCandidateEnvelope {
    private fun contentId(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(content.trim().toByteArray(Charsets.UTF_8))
        return "memory-${digest.joinToString("") { "%02x".format(it) }.take(24)}"
    }

    fun from(accountSubject: String, enabled: Boolean, memories: List<MemoryEntity>): JSONArray =
        JSONArray().apply {
            if (enabled) memories.forEach { memory ->
                require(memory.userId == accountSubject) { "memory_candidate_subject_mismatch" }
                put(JSONObject()
                    .put("id", contentId(memory.content))
                    .put("content", memory.content))
            }
        }
}

/** Runtime V2 chat engine backed by the shared Python Core. */
internal class PythonSharedCoreChatEngine(
    private val bridge: PythonRuntimeBridge,
    private val modelGateway: ModelGateway,
    private val dao: ChatDao,
    private val portsFactory: PythonHostPortsFactory,
    private val toolSchemas: (String) -> JSONArray = { JSONArray() },
    private val skillSchemas: (ChatRunRequest) -> JSONArray = { JSONArray() },
    private val hostCapabilities: (String) -> JSONArray = { JSONArray() },
    private val capabilityDiagnostics: (ChatRunRequest) -> JSONObject = { JSONObject() },
    private val projectInstructions: (ChatRunRequest) -> JSONObject = { JSONObject() },
    private val memoryEnabled: (ChatRunRequest) -> Boolean = { true },
    private val onFailure: (Throwable) -> Unit = {},
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val normalizedSink: AndroidOaepNormalizedSink = AndroidOaepNormalizedSink { _, _, _ -> },
    private val readiness: FullRuntimeReadiness = FullRuntimeReadiness.AlwaysReady,
    private val killSwitchSnapshot: () -> AndroidRuntimeKillSwitchSnapshot = { AndroidRuntimeKillSwitchSnapshot.NONE },
) : ChatEngine {
    override val authority = RuntimeAuthority.LOCAL_DEVICE
    private val jobs = ConcurrentHashMap<String, Job>()

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> {
        val sideEffectEvidence = AtomicBoolean(false)
        return flow {
        val operationalPolicy = killSwitchSnapshot()
        require(!operationalPolicy.isDisabled(AndroidRuntimeKillSwitch.KERNEL)) {
            "android_full_runtime_kernel_disabled"
        }
        // Binding is established before a Run or user item is created. A failure is explicit;
        // there is no second local engine to receive this request.
        readiness.ensureReady(request.accountSubject)
        val job = currentCoroutineContext()[Job] ?: error("python_runtime_job_required")
        jobs[request.runId] = job
        val ports = portsFactory.create(request)
        val existingCheckpoint = ports.stateStore.loadCheckpoint(request.runId)
        val recovering = existingCheckpoint != null
        // The UI already resolved and persisted the exact provider model on the
        // conversation. Re-selecting from the HAI catalog here silently replaced
        // custom-provider IDs with an unrelated HAI model.
        val models = if (recovering) emptyList() else modelGateway.listModels()
        val configuredModelId = if (recovering) {
            existingCheckpoint!!.state.optString("model_id").takeIf(String::isNotBlank)
                ?: error("model_route_checkpoint_model_missing")
        } else request.conversation.modelId.takeIf(String::isNotBlank)
        val selectedModel = configuredModelId?.let { configured ->
            models.firstOrNull { it.id == configured || it.upstreamId == configured }
        } ?: if (configuredModelId == null) modelGateway.selectModel(models) else null
        val modelId = configuredModelId ?: requireNotNull(selectedModel).id
        val modelRouteSnapshot = if (recovering) {
            existingCheckpoint!!.state.optJSONObject("model_route_snapshot")
                ?: error("model_route_checkpoint_missing")
        } else if (modelGateway is PinnedModelRouteGateway) {
            modelGateway.pinModelRoute(modelId)
        } else {
            PinnedModelRoute.create(
                modelId, "legacy", modelId, "https://invalid.local", "openai", 0, "oidc",
            )
        }
        val history = dao.runtimeMessageSnapshot(request.conversation.id)
        dao.saveMessage(
            MessageEntity(
                id = request.userMessageId,
                conversationId = request.conversation.id,
                role = "user",
                content = request.input,
            )
        )
        if (request.attachments.isNotEmpty()) dao.saveAttachments(request.attachments.map { it.toEntity() })
        dao.updateConversation(request.conversation.id, request.conversation.title, System.currentTimeMillis())
        val runHostCapabilities = hostCapabilities(request.accountSubject)
        val hostPortCapabilities = JSONArray().apply {
            for (index in 0 until runHostCapabilities.length()) {
                put(JSONObject()
                    .put("id", runHostCapabilities.getString(index))
                    .put("version", 1)
                    .put("required", false))
            }
        }
        val recoveryStartedAt = System.nanoTime()
        val runMemoryEnabled = memoryEnabled(request)
        val memoryCandidates = MemoryCandidateEnvelope.from(
            request.accountSubject,
            runMemoryEnabled,
            if (runMemoryEnabled) dao.memorySnapshot(request.accountSubject, 100) else emptyList(),
        )
        val agentPayload = ProjectInstructionEnvelope.merge(
            JSONObject()
                .put("schema_version", 1)
                .put("prompt_version", "p9-agent-kernel-v1"),
            projectInstructions(request),
        )
        val currentToolSchemas = operationalPolicy.toolSchemas(toolSchemas(request.accountSubject))
        val start = if (recovering) {
            val allowedToolNames = (0 until currentToolSchemas.length())
                .mapTo(linkedSetOf()) { currentToolSchemas.getJSONObject(it).getString("name") }
            PythonRunRecovery.resumeEnvelope(
                request.runId, request.conversation.id, ports.stateStore, allowedToolNames,
            )
        } else PythonRuntimeEnvelope(
            messageType = PythonRuntimeMessageType.START_RUN,
            requestId = "${request.runId}:host:0",
            runId = request.runId,
            sessionId = request.conversation.id,
            sequence = 0,
            idempotencyKey = "${request.runId}:start",
            payload = JSONObject()
                .put("input", request.input)
                .put("model_id", modelId)
                .put("model_route_snapshot", modelRouteSnapshot)
                .put("memory_enabled", runMemoryEnabled)
                .put("memory_candidates", memoryCandidates)
                .put("context_budget", ModelContextBudgetEnvelope.from(selectedModel))
                .put("agent", agentPayload)
                .put("history", JSONArray(history.map { message ->
                    JSONObject().put("role", message.role).put("content", message.content).apply {
                        if (message.toolCallId != null) put("tool_call_id", message.toolCallId)
                        if (message.toolPayload != null) {
                            runCatching { JSONArray(message.toolPayload) }.getOrNull()?.let { put("tool_calls", it) }
                        }
                    }
                }))
                .put("tools", currentToolSchemas)
                .put("skills", operationalPolicy.skillSchemas(skillSchemas(request)))
                .put("host_capabilities", runHostCapabilities)
                .put("capability_diagnostics", capabilityDiagnostics(request))
                .put("host_port", JSONObject()
                    .put("schema_version", 1)
                    .put("protocol_version", "p9-host-port-v1")
                    .put("surface", "android")
                    .put("capabilities", hostPortCapabilities))
                .put("artifacts", JSONArray(request.attachments.map { it.id }))
        )
        val assistant = StringBuilder()
        metrics.runtimeStarted()
        var completed = false
        try {
            PythonAgentLoopCoordinator(
                bridge, ports, metrics = metrics, onSideEffectEvidence = { sideEffectEvidence.set(true) },
            ).execute(start).collect { envelope ->
                currentCoroutineContext().ensureActive()
                normalizedSink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
                val event = PythonRuntimeEventMapper.map(envelope)
                when (event) {
                    is RuntimeEvent.TextDelta -> assistant.append(event.text)
                    RuntimeEvent.Completed -> {
                        completed = true
                        dao.saveMessage(
                        MessageEntity(
                            id = request.assistantMessageId,
                            conversationId = request.conversation.id,
                            role = "assistant",
                            content = assistant.toString(),
                        )
                        )
                    }
                    else -> Unit
                }
                if (event != null) emit(event)
            }
        } finally {
            if (recovering) metrics.recoveryFinished((System.nanoTime() - recoveryStartedAt) / 1_000_000, completed)
            jobs.remove(request.runId, job)
        }
        }.catch { error ->
        onFailure(error)
        val failure = error.message.orEmpty()
        val reconciliation = PythonRuntimeReconciliation.envelope(request, failure)
        if (reconciliation != null) {
            val envelope = reconciliation
            normalizedSink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
            emit(RuntimeEvent.Paused)
        } else {
            val message = failure.ifBlank { "python_runtime_failed" }
            val retryable = !sideEffectEvidence.get()
            val envelope = PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.RUNTIME_EVENT,
                requestId = "host-failure:${request.runId.take(100)}",
                runId = request.runId,
                sessionId = request.conversation.id,
                sequence = 0,
                idempotencyKey = "${request.runId}:terminal-failure",
                payload = JSONObject()
                    .put("kind", "run.failed")
                    .put("code", "python_runtime_failed")
                    .put("message", message.take(400))
                    .put("retryable", retryable),
            )
            normalizedSink.accept(request, envelope, PythonRuntimeEventMapper.decodeAll(envelope))
            emit(RuntimeEvent.Failed(message, retryable = retryable))
        }
        }
    }

    override fun pause(runId: String) {
        modelGateway.cancelActive()
        jobs.remove(runId)?.cancel()
    }

    override fun stop(runId: String) {
        modelGateway.cancelActive()
        jobs.remove(runId)?.cancel()
    }
}
