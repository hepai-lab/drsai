package ai.drsai.remote.runtime.coordinator

import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.LocalAgentRuntime
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.model.RuntimeAuthority
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow

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

interface ChatExecutionPort {
    fun execute(request: ChatRunRequest): Flow<RuntimeEvent>
    fun pause(authority: RuntimeAuthority, runId: String)
    fun stop(authority: RuntimeAuthority, runId: String)
}

data class JournaledChatEvent(val event: RuntimeEvent, val checkpoint: RunCheckpoint)

class JournaledChatExecutionCoordinator(
    private val execution: ChatExecutionPort,
    private val recorder: RuntimeV2EventRecorder,
) {
    fun execute(command: RunCommand, request: ChatRunRequest): Flow<JournaledChatEvent> = flow {
        require(command.accountSubject == request.accountSubject) { "chat_run_subject_mismatch" }
        require(command.binding.authority == request.authority) { "chat_run_authority_mismatch" }
        require(command.runId.value == request.runId) { "chat_run_id_mismatch" }
        require(command.sessionId.value == request.conversation.id) { "chat_run_session_mismatch" }
        recorder.start(command)
        execution.execute(request).collect { event ->
            emit(JournaledChatEvent(event, recorder.record(request.runId, event)))
        }
    }
}

interface ChatEngine {
    val authority: RuntimeAuthority
    fun execute(request: ChatRunRequest): Flow<RuntimeEvent>
    fun pause(runId: String)
    fun stop(runId: String)
}

private class LocalChatEngine(private val runtime: LocalAgentRuntime) : ChatEngine {
    override val authority = RuntimeAuthority.LOCAL_DEVICE
    override fun execute(request: ChatRunRequest) = runtime.run(
        request.accountSubject, request.conversation, request.input, request.attachments,
        request.runId, request.userMessageId,
    )
    override fun pause(runId: String) = runtime.pause(runId)
    override fun stop(runId: String) = runtime.stop(runId)
}

private class PlatformChatEngine(private val runtime: PlatformAgentRuntime) : ChatEngine {
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
class ChatExecutionRouter(
    engines: List<ChatEngine>,
) : ChatExecutionPort {
    private val engines = engines.associateBy(ChatEngine::authority).also {
        require(it.size == engines.size) { "duplicate_chat_engine_authority" }
    }

    constructor(local: LocalAgentRuntime, platform: PlatformAgentRuntime) : this(
        listOf(LocalChatEngine(local), PlatformChatEngine(platform)),
    )

    override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> = engine(request.authority).execute(request)

    override fun pause(authority: RuntimeAuthority, runId: String) = engine(authority).pause(runId)

    override fun stop(authority: RuntimeAuthority, runId: String) = engine(authority).stop(runId)

    private fun engine(authority: RuntimeAuthority): ChatEngine = engines[authority]
        ?: error("chat_engine_unavailable:${authority.name}")
}
