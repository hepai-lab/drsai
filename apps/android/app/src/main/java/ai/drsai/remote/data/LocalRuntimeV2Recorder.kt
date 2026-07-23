package ai.drsai.remote.data

import ai.drsai.remote.runtime.v2.EventAppendDecision
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunJournal
import ai.drsai.remote.runtime.v2.RunTransitionPolicy
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * Compatibility bridge used while the proven LocalAgentRuntime tool/model loop
 * is moved behind RuntimeV2Engine. It makes current production runs durable in
 * the unified Run/Event journal without changing their user-visible behavior.
 */
class RuntimeV2EventRecorder(private val journal: RunJournal) {
    private val checkpoints = ConcurrentHashMap<String, RunCheckpoint>()

    suspend fun start(command: RunCommand): RunCheckpoint =
        journal.createIfAbsent(command).also { checkpoints[command.runId.value] = it }

    suspend fun recover(accountSubject: String): List<RunCheckpoint> = journal.recoverable(accountSubject).map { current ->
        when (current.status) {
            WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.WAITING_APPROVAL ->
                transition(current, WorkbenchRunStatus.PAUSED, "run.recovered", "{\"reason\":\"process_restart\"}")
            else -> current
        }.also { checkpoints[it.command.runId.value] = it }
    }

    suspend fun resume(runId: WorkbenchId): RunCheckpoint {
        val checkpoint = checkpoints[runId.value] ?: journal.checkpoint(runId) ?: error("run_checkpoint_missing")
        require(checkpoint.status in setOf(WorkbenchRunStatus.PAUSED, WorkbenchRunStatus.QUEUED)) {
            "run_not_resumable"
        }
        checkpoints[runId.value] = checkpoint
        return checkpoint
    }

    suspend fun cancel(runId: WorkbenchId): RunCheckpoint {
        val checkpoint = checkpoints[runId.value] ?: journal.checkpoint(runId) ?: error("run_checkpoint_missing")
        if (checkpoint.terminal) return checkpoint
        return transition(checkpoint, WorkbenchRunStatus.CANCELLED, "run.cancelled", "{\"source\":\"user\"}")
    }

    suspend fun pause(runId: WorkbenchId): RunCheckpoint {
        val checkpoint = checkpoints[runId.value] ?: journal.checkpoint(runId) ?: error("run_checkpoint_missing")
        if (checkpoint.status == WorkbenchRunStatus.PAUSED || checkpoint.terminal) return checkpoint
        return transition(checkpoint, WorkbenchRunStatus.PAUSED, "run.paused", "{\"source\":\"lifecycle\"}")
    }

    suspend fun record(runId: String, event: RuntimeEvent): RunCheckpoint {
        val current = checkpoints[runId] ?: journal.checkpoint(WorkbenchId(runId))
            ?: error("run_checkpoint_missing")
        val nextStatus = event.status()
        RunTransitionPolicy.requireTransition(current.status, nextStatus)
        val sequence = current.lastSequence + 1
        val envelope = WorkbenchEvent(
            eventId = WorkbenchId("$runId:$sequence"),
            runId = current.command.runId,
            runtimeId = current.command.binding.runtimeId,
            sequence = sequence,
            timestamp = Instant.now().toString(),
            kind = event.kind(),
            payloadJson = event.payload(),
        )
        val next = current.copy(
            status = nextStatus,
            lastSequence = sequence,
            failureCode = (event as? RuntimeEvent.Failed)?.message,
        )
        return when (journal.append(envelope, next)) {
            EventAppendDecision.APPEND -> next.also { checkpoints[runId] = it }
            EventAppendDecision.DUPLICATE, EventAppendDecision.OUT_OF_ORDER -> current
            EventAppendDecision.GAP -> error("runtime_event_sequence_gap")
            EventAppendDecision.CROSS_RUNTIME -> error("runtime_event_authority_mismatch")
        }.also { if (it.terminal) checkpoints.remove(runId) }
    }

    private suspend fun transition(
        current: RunCheckpoint,
        status: WorkbenchRunStatus,
        kind: String,
        payload: String,
    ): RunCheckpoint {
        RunTransitionPolicy.requireTransition(current.status, status)
        val sequence = current.lastSequence + 1
        val event = WorkbenchEvent(
            WorkbenchId("${current.command.runId.value}:$sequence"),
            current.command.runId,
            current.command.binding.runtimeId,
            sequence,
            Instant.now().toString(),
            kind,
            payloadJson = payload,
        )
        val next = current.copy(status = status, lastSequence = sequence)
        check(journal.append(event, next) == EventAppendDecision.APPEND) { "run_transition_not_appended" }
        if (next.terminal) checkpoints.remove(current.command.runId.value)
        else checkpoints[current.command.runId.value] = next
        return next
    }

    private fun RuntimeEvent.status(): WorkbenchRunStatus = when (this) {
        is RuntimeEvent.Started -> WorkbenchRunStatus.RUNNING
        RuntimeEvent.Paused -> WorkbenchRunStatus.PAUSED
        RuntimeEvent.Cancelled -> WorkbenchRunStatus.CANCELLED
        RuntimeEvent.Completed -> WorkbenchRunStatus.COMPLETED
        is RuntimeEvent.Failed -> WorkbenchRunStatus.FAILED
        else -> WorkbenchRunStatus.RUNNING
    }

    private fun RuntimeEvent.kind(): String = when (this) {
        is RuntimeEvent.Started -> "run.started"
        is RuntimeEvent.TextDelta -> "message.delta"
        is RuntimeEvent.ToolStarted -> "tool.started"
        is RuntimeEvent.ToolFinished -> "tool.completed"
        is RuntimeEvent.ToolFailed -> "tool.error"
        is RuntimeEvent.ToolDowngraded -> "tool.downgraded"
        is RuntimeEvent.Artifact -> "artifact.created"
        RuntimeEvent.Completed -> "run.completed"
        RuntimeEvent.Paused -> "run.paused"
        RuntimeEvent.Cancelled -> "run.cancelled"
        is RuntimeEvent.Failed -> "run.failed"
    }

    private fun RuntimeEvent.payload(): String = when (this) {
        is RuntimeEvent.TextDelta -> JSONObject().put("text", text).toString()
        is RuntimeEvent.ToolStarted -> JSONObject().put("name", name).toString()
        is RuntimeEvent.ToolFinished -> JSONObject().put("name", name).toString()
        is RuntimeEvent.ToolFailed -> JSONObject().put("name", name).put("code", code).toString()
        is RuntimeEvent.ToolDowngraded -> JSONObject().put("reason", reason).toString()
        is RuntimeEvent.Artifact -> JSONObject().put("attachmentId", attachment.id).toString()
        is RuntimeEvent.Failed -> JSONObject().put("message", message).put("retryable", retryable).toString()
        else -> "{}"
    }
}
