package ai.drsai.remote

import ai.drsai.remote.runtime.v2.EngineEvent
import ai.drsai.remote.runtime.v2.EventAppendDecision
import ai.drsai.remote.runtime.v2.EventSequencePolicy
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunJournal
import ai.drsai.remote.runtime.v2.RunTransitionPolicy
import ai.drsai.remote.runtime.v2.RuntimeV2Coordinator
import ai.drsai.remote.runtime.v2.RuntimeV2Engine
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeV2Test {
    @Test fun fullStateTableRejectsTerminalAndIllegalTransitions() {
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.QUEUED, WorkbenchRunStatus.RUNNING)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.RUNNING)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.WAITING_APPROVAL)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.WAITING_APPROVAL, WorkbenchRunStatus.RUNNING)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.PAUSED)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.PAUSED, WorkbenchRunStatus.RUNNING)
        RunTransitionPolicy.requireTransition(WorkbenchRunStatus.RUNNING, WorkbenchRunStatus.COMPLETED)
        assertThrows(IllegalArgumentException::class.java) {
            RunTransitionPolicy.requireTransition(WorkbenchRunStatus.COMPLETED, WorkbenchRunStatus.RUNNING)
        }
        assertThrows(IllegalArgumentException::class.java) {
            RunTransitionPolicy.requireTransition(WorkbenchRunStatus.QUEUED, WorkbenchRunStatus.COMPLETED)
        }
    }

    @Test fun eventPolicyRejectsDuplicateGapOutOfOrderAndCrossRuntime() {
        val checkpoint = RunCheckpoint(command(), WorkbenchRunStatus.RUNNING, lastSequence = 2)
        assertEquals(EventAppendDecision.DUPLICATE, EventSequencePolicy.decide(checkpoint, event(3), true))
        assertEquals(EventAppendDecision.OUT_OF_ORDER, EventSequencePolicy.decide(checkpoint, event(2), false))
        assertEquals(EventAppendDecision.GAP, EventSequencePolicy.decide(checkpoint, event(4), false))
        assertEquals(
            EventAppendDecision.CROSS_RUNTIME,
            EventSequencePolicy.decide(checkpoint, event(3, runtime = "other"), false),
        )
        assertEquals(EventAppendDecision.APPEND, EventSequencePolicy.decide(checkpoint, event(3), false))
    }

    @Test fun coordinatorPersistsEveryBoundaryAndReturnsIdempotentRun() = runTest {
        val journal = MemoryJournal()
        val coordinator = RuntimeV2Coordinator(listOf(FixtureEngine()), journal)
        val command = command()
        val completed = coordinator.execute(command)
        assertEquals(WorkbenchRunStatus.COMPLETED, completed.status)
        assertEquals(4, completed.lastSequence)
        assertEquals(setOf("tool:1"), completed.completedSideEffects)
        assertEquals(listOf(1L, 2L, 3L, 4L), journal.events.map(WorkbenchEvent::sequence))
        assertEquals(completed, coordinator.execute(command.copy(runId = WorkbenchId("ignored-duplicate"))))
        assertEquals(4, journal.events.size)
    }

    @Test fun concurrentDoubleSendUsesOneRunPerIdempotencyKey() = runTest {
        val journal = MemoryJournal()
        val engine = FixtureEngine(delayMillis = 1)
        val coordinator = RuntimeV2Coordinator(listOf(engine), journal)
        val results = listOf(
            async { coordinator.execute(command()) },
            async { coordinator.execute(command().copy(runId = WorkbenchId("run-second"))) },
        ).awaitAll()
        assertEquals(results[0].command.runId, results[1].command.runId)
        assertEquals(1, journal.createdCount)
        assertEquals(1, engine.executionCount)
    }

    @Test fun recoveryReturnsOnlyNonTerminalCheckpoints() = runTest {
        val journal = MemoryJournal()
        journal.items["run"] = RunCheckpoint(command(), WorkbenchRunStatus.PAUSED, 2)
        journal.items["done"] = RunCheckpoint(
            command().copy(runId = WorkbenchId("done"), idempotencyKey = "done-key"),
            WorkbenchRunStatus.COMPLETED, 3,
        )
        val recovered = RuntimeV2Coordinator(listOf(FixtureEngine()), journal).recover("alice")
        assertEquals(listOf("run"), recovered.map { it.command.runId.value })
    }

    @Test fun productionRecorderPausesInterruptedRunThenResumesAndCancels() = runTest {
        val journal = MemoryJournal()
        journal.items["run"] = RunCheckpoint(command(), WorkbenchRunStatus.RUNNING, 2)
        val recorder = RuntimeV2EventRecorder(journal)

        val recovered = recorder.recover("alice").single()
        assertEquals(WorkbenchRunStatus.PAUSED, recovered.status)
        assertEquals(3, recovered.lastSequence)
        assertEquals("run.recovered", journal.events.single().kind)

        recorder.resume(WorkbenchId("run"))
        val running = recorder.record("run", RuntimeEvent.Started("run"))
        assertEquals(WorkbenchRunStatus.RUNNING, running.status)
        val cancelled = recorder.record("run", RuntimeEvent.Cancelled)
        assertEquals(WorkbenchRunStatus.CANCELLED, cancelled.status)
        assertEquals("run.cancelled", journal.events.last().kind)
        assertTrue(cancelled.terminal)
    }

    @Test fun journalFailureNeverAdvancesPastTheLastAtomicBoundary() = runTest {
        val journal = object : MemoryJournal() {
            override suspend fun append(event: WorkbenchEvent, next: RunCheckpoint): EventAppendDecision {
                if (event.sequence == 2L) error("injected_journal_failure")
                return super.append(event, next)
            }
        }
        val failure = runCatching {
            RuntimeV2Coordinator(listOf(FixtureEngine()), journal).execute(command())
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals("injected_journal_failure", failure?.message)
        assertEquals(listOf(1L), journal.events.map(WorkbenchEvent::sequence))
        assertEquals(1L, journal.checkpoint(WorkbenchId("run"))?.lastSequence)
        assertEquals(WorkbenchRunStatus.RUNNING, journal.checkpoint(WorkbenchId("run"))?.status)
    }

    private fun command() = RunCommand(
        "alice", "ihep", RuntimeBinding.AndroidLocal,
        WorkbenchId("local:alice"), WorkbenchId("session"), WorkbenchId("run"),
        "opendrsai", "send-key", "hello",
    )

    private fun event(sequence: Long, runtime: String = "android-local") = WorkbenchEvent(
        WorkbenchId("event-$runtime-$sequence"), WorkbenchId("run"), WorkbenchId(runtime), sequence,
        "2026-07-21T00:00:00Z", "test",
    )

    private class FixtureEngine(private val delayMillis: Long = 0) : RuntimeV2Engine {
        override val authority = RuntimeAuthority.LOCAL_DEVICE
        var executionCount = 0
        override fun execute(command: RunCommand, checkpoint: RunCheckpoint): Flow<EngineEvent> = flow {
            executionCount += 1
            if (delayMillis > 0) delay(delayMillis)
            emit(EngineEvent("run.started", WorkbenchRunStatus.RUNNING, "t1"))
            emit(EngineEvent("approval.requested", WorkbenchRunStatus.WAITING_APPROVAL, "t2"))
            emit(EngineEvent("tool.completed", WorkbenchRunStatus.RUNNING, "t3", sideEffectKey = "tool:1"))
            emit(EngineEvent("run.completed", WorkbenchRunStatus.COMPLETED, "t4"))
        }
        override suspend fun cancel(runId: WorkbenchId) = Unit
    }

    private open class MemoryJournal : RunJournal {
        val items = linkedMapOf<String, RunCheckpoint>()
        val events = mutableListOf<WorkbenchEvent>()
        var createdCount = 0
        override suspend fun createIfAbsent(command: RunCommand): RunCheckpoint {
            items.values.firstOrNull {
                it.command.accountSubject == command.accountSubject && it.command.idempotencyKey == command.idempotencyKey
            }?.let { return it }
            createdCount += 1
            return RunCheckpoint(command, WorkbenchRunStatus.QUEUED).also { items[command.runId.value] = it }
        }
        override suspend fun findByIdempotencyKey(accountSubject: String, idempotencyKey: String) =
            items.values.firstOrNull { it.command.accountSubject == accountSubject && it.command.idempotencyKey == idempotencyKey }
        override suspend fun checkpoint(runId: WorkbenchId) = items[runId.value]
        override suspend fun eventExists(eventId: WorkbenchId) = events.any { it.eventId == eventId }
        override suspend fun append(event: WorkbenchEvent, next: RunCheckpoint): EventAppendDecision {
            val current = items.getValue(next.command.runId.value)
            val decision = EventSequencePolicy.decide(current, event, eventExists(event.eventId))
            if (decision == EventAppendDecision.APPEND) {
                events += event
                items[next.command.runId.value] = next
            }
            return decision
        }
        override suspend fun recoverable(accountSubject: String) =
            items.values.filter { it.command.accountSubject == accountSubject }
    }
}
