package ai.drsai.remote.runtime.v2

import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class RunCommand(
    val accountSubject: String,
    val organization: String,
    val binding: RuntimeBinding,
    val workspaceId: WorkbenchId,
    val sessionId: WorkbenchId,
    val runId: WorkbenchId,
    val backendId: String,
    val idempotencyKey: String,
    val input: String,
    val skillVersions: Map<String, Int> = emptyMap(),
) {
    init {
        require(accountSubject.isNotBlank()) { "account_subject_required" }
        require(backendId.isNotBlank()) { "backend_id_required" }
        require(idempotencyKey.isNotBlank()) { "idempotency_key_required" }
        require(input.isNotBlank()) { "run_input_required" }
        require(skillVersions.all { (id, version) -> id.isNotBlank() && version > 0 }) { "skill_versions_invalid" }
    }
}

data class RunCheckpoint(
    val command: RunCommand,
    val status: WorkbenchRunStatus,
    val lastSequence: Long = 0,
    val completedSideEffects: Set<String> = emptySet(),
    val failureCode: String? = null,
) {
    init { require(lastSequence >= 0) { "last_sequence_invalid" } }
    val terminal: Boolean
        get() = status in setOf(
            WorkbenchRunStatus.COMPLETED,
            WorkbenchRunStatus.FAILED,
            WorkbenchRunStatus.CANCELLED,
        )
}

object RunTransitionPolicy {
    private val transitions = mapOf(
        WorkbenchRunStatus.QUEUED to setOf(
            WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.FAILED, WorkbenchRunStatus.CANCELLED,
        ),
        WorkbenchRunStatus.RUNNING to setOf(
            WorkbenchRunStatus.WAITING_APPROVAL, WorkbenchRunStatus.PAUSED,
            WorkbenchRunStatus.COMPLETED, WorkbenchRunStatus.FAILED, WorkbenchRunStatus.CANCELLED,
        ),
        WorkbenchRunStatus.WAITING_APPROVAL to setOf(
            WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.PAUSED,
            WorkbenchRunStatus.FAILED, WorkbenchRunStatus.CANCELLED,
        ),
        WorkbenchRunStatus.PAUSED to setOf(
            WorkbenchRunStatus.QUEUED, WorkbenchRunStatus.RUNNING,
            WorkbenchRunStatus.FAILED, WorkbenchRunStatus.CANCELLED,
        ),
    )

    fun requireTransition(from: WorkbenchRunStatus, to: WorkbenchRunStatus) {
        if (from == to && from !in setOf(
                WorkbenchRunStatus.COMPLETED,
                WorkbenchRunStatus.FAILED,
                WorkbenchRunStatus.CANCELLED,
            )
        ) return
        require(to in transitions[from].orEmpty()) { "invalid_run_transition:${from.name}->${to.name}" }
    }
}

enum class EventAppendDecision { APPEND, DUPLICATE, OUT_OF_ORDER, GAP, CROSS_RUNTIME }

object EventSequencePolicy {
    fun decide(
        checkpoint: RunCheckpoint,
        event: WorkbenchEvent,
        existingEventId: Boolean,
    ): EventAppendDecision = when {
        event.runtimeId != checkpoint.command.binding.runtimeId -> EventAppendDecision.CROSS_RUNTIME
        existingEventId -> EventAppendDecision.DUPLICATE
        event.sequence <= checkpoint.lastSequence -> EventAppendDecision.OUT_OF_ORDER
        event.sequence != checkpoint.lastSequence + 1 -> EventAppendDecision.GAP
        else -> EventAppendDecision.APPEND
    }
}

/** Atomic persistence port. Room owns the production transaction. */
interface RunJournal {
    suspend fun createIfAbsent(command: RunCommand): RunCheckpoint
    suspend fun findByIdempotencyKey(accountSubject: String, idempotencyKey: String): RunCheckpoint?
    suspend fun checkpoint(runId: WorkbenchId): RunCheckpoint?
    suspend fun eventExists(eventId: WorkbenchId): Boolean
    suspend fun append(event: WorkbenchEvent, next: RunCheckpoint): EventAppendDecision
    suspend fun recoverable(accountSubject: String): List<RunCheckpoint>
}

interface RuntimeV2Engine {
    val authority: RuntimeAuthority
    fun execute(command: RunCommand, checkpoint: RunCheckpoint): Flow<EngineEvent>
    suspend fun cancel(runId: WorkbenchId)
}

data class EngineEvent(
    val kind: String,
    val status: WorkbenchRunStatus,
    val timestamp: String,
    val payloadJson: String = "{}",
    val sideEffectKey: String? = null,
    val failureCode: String? = null,
)

class RuntimeV2Coordinator(
    engines: List<RuntimeV2Engine>,
    private val journal: RunJournal,
    private val eventIdFactory: (RunCommand, Long) -> WorkbenchId = { command, sequence ->
        WorkbenchId("${command.runId.value}:$sequence")
    },
) {
    private val enginesByAuthority = engines.associateBy(RuntimeV2Engine::authority)
    private val sessionLocks = ConcurrentHashMap<String, Mutex>()

    suspend fun execute(command: RunCommand): RunCheckpoint {
        val key = listOf(command.accountSubject, command.binding.runtimeId.value, command.sessionId.value).joinToString(":")
        return sessionLocks.getOrPut(key) { Mutex() }.withLock {
            val duplicate = journal.findByIdempotencyKey(command.accountSubject, command.idempotencyKey)
            if (duplicate != null) return@withLock duplicate
            var checkpoint = journal.createIfAbsent(command)
            if (checkpoint.terminal) return@withLock checkpoint
            val engine = enginesByAuthority[command.binding.authority]
                ?: error("runtime_engine_unavailable:${command.binding.authority}")
            engine.execute(command, checkpoint).collect { engineEvent ->
                RunTransitionPolicy.requireTransition(checkpoint.status, engineEvent.status)
                val sequence = checkpoint.lastSequence + 1
                val event = WorkbenchEvent(
                    eventId = eventIdFactory(command, sequence),
                    runId = command.runId,
                    runtimeId = command.binding.runtimeId,
                    sequence = sequence,
                    timestamp = engineEvent.timestamp,
                    kind = engineEvent.kind,
                    payloadJson = engineEvent.payloadJson,
                )
                val next = checkpoint.copy(
                    status = engineEvent.status,
                    lastSequence = sequence,
                    completedSideEffects = checkpoint.completedSideEffects + listOfNotNull(engineEvent.sideEffectKey),
                    failureCode = engineEvent.failureCode,
                )
                when (journal.append(event, next)) {
                    EventAppendDecision.APPEND -> checkpoint = next
                    EventAppendDecision.DUPLICATE, EventAppendDecision.OUT_OF_ORDER -> Unit
                    EventAppendDecision.GAP -> error("runtime_event_sequence_gap")
                    EventAppendDecision.CROSS_RUNTIME -> error("runtime_event_authority_mismatch")
                }
            }
            checkpoint
        }
    }

    suspend fun cancel(runId: WorkbenchId) {
        val checkpoint = journal.checkpoint(runId) ?: return
        if (checkpoint.terminal) return
        enginesByAuthority[checkpoint.command.binding.authority]?.cancel(runId)
    }

    suspend fun recover(accountSubject: String): List<RunCheckpoint> =
        journal.recoverable(accountSubject).filterNot(RunCheckpoint::terminal)
}
