package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.ModelGateway
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.toEntity
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.workbench.model.RuntimeAuthority
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject

fun interface PythonHostPortsFactory {
    fun create(request: ChatRunRequest): PythonRuntimeHostPorts
}

/** Runtime V2 chat engine backed by the shared Python Core. */
class PythonSharedCoreChatEngine(
    private val bridge: PythonRuntimeBridge,
    private val modelGateway: ModelGateway,
    private val dao: ChatDao,
    private val portsFactory: PythonHostPortsFactory,
    private val toolSchemas: (String) -> JSONArray = { JSONArray().put(JSONObject().put("enabled", true)) },
    private val skillSchemas: (ChatRunRequest) -> JSONArray = { JSONArray() },
    private val onFailure: (Throwable) -> Unit = {},
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
) : ChatEngine {
    override val authority = RuntimeAuthority.LOCAL_DEVICE
    private val jobs = ConcurrentHashMap<String, Job>()

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> {
        val sideEffectEvidence = AtomicBoolean(false)
        return flow {
        val job = currentCoroutineContext()[Job] ?: error("python_runtime_job_required")
        jobs[request.runId] = job
        val model = modelGateway.selectModel(modelGateway.listModels())
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
        val ports = portsFactory.create(request)
        val recoveryStartedAt = System.nanoTime()
        val recovering = ports.stateStore.loadCheckpoint(request.runId) != null
        val start = if (recovering) {
            PythonRunRecovery.resumeEnvelope(request.runId, request.conversation.id, ports.stateStore)
        } else PythonRuntimeEnvelope(
            messageType = PythonRuntimeMessageType.START_RUN,
            requestId = "${request.runId}:host:0",
            runId = request.runId,
            sessionId = request.conversation.id,
            sequence = 0,
            idempotencyKey = "${request.runId}:start",
            payload = JSONObject()
                .put("input", request.input)
                .put("model_id", model.id)
                .put("history", JSONArray(history.map { message ->
                    JSONObject().put("role", message.role).put("content", message.content).apply {
                        if (message.toolCallId != null) put("tool_call_id", message.toolCallId)
                        if (message.toolPayload != null) {
                            runCatching { JSONArray(message.toolPayload) }.getOrNull()?.let { put("tool_calls", it) }
                        }
                    }
                }))
                .put("tools", toolSchemas(request.accountSubject))
                .put("skills", skillSchemas(request))
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
        emit(RuntimeEvent.Failed(error.message ?: "python_runtime_failed", retryable = !sideEffectEvidence.get()))
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

class SelectableLocalChatEngine(
    private val kotlin: ChatEngine,
    private val python: ChatEngine,
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val rollout: () -> PythonRuntimeRolloutState,
) : ChatEngine {
    override val authority = RuntimeAuthority.LOCAL_DEVICE
    private val selectedByRun = ConcurrentHashMap<String, ChatEngine>()

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> {
        val selected = if (
            PythonRuntimeRolloutPolicy.select(rollout()) == LocalRuntimeImplementation.PYTHON_SHARED_CORE
        ) python else kotlin
        selectedByRun[request.runId] = selected
        val execution = if (selected === python) safePythonFallback(request) else selected.execute(request)
        return execution.onTerminal { selectedByRun.remove(request.runId) }
    }

    private fun safePythonFallback(request: ChatRunRequest): Flow<RuntimeEvent> = flow {
        val buffered = mutableListOf<RuntimeEvent>()
        var committed = false
        var retryWithKotlin = false
        python.execute(request).collect { event ->
            if (!committed && event is RuntimeEvent.Failed && event.retryable) {
                retryWithKotlin = true
                return@collect
            }
            if (!committed && event is RuntimeEvent.Started) {
                buffered += event
                return@collect
            }
            if (!committed) {
                committed = true
                buffered.forEach { emit(it) }
                buffered.clear()
            }
            emit(event)
        }
        if (retryWithKotlin && !committed) {
            metrics.safeFallback()
            selectedByRun[request.runId] = kotlin
            kotlin.execute(request).collect { emit(it) }
        } else if (!committed) {
            buffered.forEach { emit(it) }
        }
    }

    override fun pause(runId: String) = (selectedByRun[runId] ?: kotlin).pause(runId)
    override fun stop(runId: String) = (selectedByRun[runId] ?: kotlin).stop(runId)
}

private fun Flow<RuntimeEvent>.onTerminal(block: () -> Unit): Flow<RuntimeEvent> = flow {
    try { collect { emit(it) } } finally { block() }
}
