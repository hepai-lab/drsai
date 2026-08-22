package ai.drsai.remote.runtime.coordinator

import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.RemoteAttachment
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.model.RuntimeAuthority
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import java.util.concurrent.ConcurrentHashMap

internal object RunCoordinatorLeaseRegistry {
    private val active = ConcurrentHashMap.newKeySet<String>()
    fun acquire(subject: String, runId: String): Boolean {
        require(subject.isNotBlank() && runId.isNotBlank()) { "run_coordinator_scope_required" }
        return active.add("$subject\u0000$runId")
    }
    fun release(subject: String, runId: String) { active.remove("$subject\u0000$runId") }
}

data class ChatRunRequest(
    val accountSubject: String,
    val authority: RuntimeAuthority,
    val conversation: Conversation,
    val input: String,
    val attachments: List<MessageAttachment>,
    val runId: String,
    val userMessageId: String,
    val assistantMessageId: String,
)

internal interface ChatExecutionPort {
    fun execute(request: ChatRunRequest): Flow<RuntimeEvent>
    fun pause(authority: RuntimeAuthority, runId: String)
    fun stop(authority: RuntimeAuthority, runId: String)
}

enum class ChatLifecycleSignal { ACTIVE, COMPLETED, CANCELLED, PAUSED, FAILED }

/** OAEP UI refresh tick. RuntimeEvent is consumed inside this compatibility adapter. */
data class JournaledChatUpdate(
    val checkpoint: RunCheckpoint,
    val lifecycle: ChatLifecycleSignal,
    val artifact: RemoteAttachment? = null,
)

internal class JournaledChatExecutionCoordinator(
    private val execution: ChatExecutionPort,
    private val recorder: RuntimeV2EventRecorder,
) {
    fun execute(command: RunCommand, request: ChatRunRequest): Flow<JournaledChatUpdate> = flow {
        require(command.accountSubject == request.accountSubject) { "chat_run_subject_mismatch" }
        require(command.binding.authority == request.authority) { "chat_run_authority_mismatch" }
        require(command.runId.value == request.runId) { "chat_run_id_mismatch" }
        require(command.sessionId.value == request.conversation.id) { "chat_run_session_mismatch" }
        recorder.start(command)
        execution.execute(request).collect { event ->
            val checkpoint = recorder.record(request.runId, event)
            emit(JournaledChatUpdate(
                checkpoint = checkpoint,
                lifecycle = when (event) {
                    RuntimeEvent.Completed -> ChatLifecycleSignal.COMPLETED
                    RuntimeEvent.Cancelled -> ChatLifecycleSignal.CANCELLED
                    RuntimeEvent.Paused -> ChatLifecycleSignal.PAUSED
                    is RuntimeEvent.Failed -> ChatLifecycleSignal.FAILED
                    else -> ChatLifecycleSignal.ACTIVE
                },
                artifact = (event as? RuntimeEvent.Artifact)?.attachment,
            ))
        }
    }
}

internal interface ChatEngine {
    val authority: RuntimeAuthority
    fun execute(request: ChatRunRequest): Flow<RuntimeEvent>
    fun pause(runId: String)
    fun stop(runId: String)
}

internal class PlatformChatEngine(private val runtime: PlatformAgentRuntime) : ChatEngine {
    override val authority = RuntimeAuthority.REMOTE_RUNTIME
    override fun execute(request: ChatRunRequest) = runtime.run(
        request.conversation, request.input, request.attachments, request.runId,
        request.userMessageId, request.assistantMessageId,
    )
    override fun pause(runId: String) = runtime.pause(runId)
    override fun stop(runId: String) = runtime.stop(runId)
}

/**
 * The single compatibility boundary between the Runtime V2 presentation path
 * and the two existing chat engines. A Run's authority is supplied on every
 * lifecycle operation, so a disconnect can never silently move it elsewhere.
 */
internal class ChatExecutionRouter(
    engines: List<ChatEngine>,
) : ChatExecutionPort {
    private val engines = engines.associateBy(ChatEngine::authority).also {
        require(it.size == engines.size) { "duplicate_chat_engine_authority" }
    }

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> = engine(request.authority).execute(request)

    override fun pause(authority: RuntimeAuthority, runId: String) = engine(authority).pause(runId)

    override fun stop(authority: RuntimeAuthority, runId: String) = engine(authority).stop(runId)

    private fun engine(authority: RuntimeAuthority): ChatEngine = engines[authority]
        ?: error("chat_engine_unavailable:${authority.name}")
}
