package ai.drsai.remote

import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.coordinator.ChatExecutionRouter
import ai.drsai.remote.runtime.coordinator.JournaledChatExecutionCoordinator
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.coordinator.ChatLifecycleSignal
import ai.drsai.remote.runtime.coordinator.RunCoordinatorLeaseRegistry
import ai.drsai.remote.runtime.v2.EventAppendDecision
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunJournal
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.single
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ChatExecutionRouterTest {
    @Test fun coordinatorLeaseAllowsOneOwnerPerAccountRunAndReleasesDeterministically() {
        assertEquals(true, RunCoordinatorLeaseRegistry.acquire("alice", "run"))
        assertEquals(false, RunCoordinatorLeaseRegistry.acquire("alice", "run"))
        assertEquals(true, RunCoordinatorLeaseRegistry.acquire("bob", "run"))
        RunCoordinatorLeaseRegistry.release("alice", "run")
        assertEquals(true, RunCoordinatorLeaseRegistry.acquire("alice", "run"))
        RunCoordinatorLeaseRegistry.release("alice", "run")
        RunCoordinatorLeaseRegistry.release("bob", "run")
    }
    @Test fun executionAndLifecycleStayOnTheRunAuthority() = runTest {
        val local = FakeEngine(RuntimeAuthority.LOCAL_DEVICE)
        val remote = FakeEngine(RuntimeAuthority.REMOTE_RUNTIME)
        val router = ChatExecutionRouter(listOf(local, remote))
        val request = request(RuntimeAuthority.REMOTE_RUNTIME)

        assertEquals(RuntimeEvent.Started("run"), router.execute(request).single())
        router.pause(request.authority, request.runId)
        router.stop(request.authority, request.runId)

        assertEquals(listOf("execute:run", "pause:run", "stop:run"), remote.calls)
        assertEquals(emptyList<String>(), local.calls)
    }

    @Test fun missingAndDuplicateAuthoritiesFailClosed() {
        val local = FakeEngine(RuntimeAuthority.LOCAL_DEVICE)
        val router = ChatExecutionRouter(listOf(local))
        assertThrows(IllegalStateException::class.java) {
            router.execute(request(RuntimeAuthority.REMOTE_RUNTIME))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ChatExecutionRouter(listOf(local, FakeEngine(RuntimeAuthority.LOCAL_DEVICE)))
        }
    }

    @Test fun journaledCoordinatorPersistsEveryEventBeforeExposingIt() = runTest {
        val engine = FakeEngine(RuntimeAuthority.LOCAL_DEVICE, listOf(
            RuntimeEvent.Started("run"), RuntimeEvent.TextDelta("hello"), RuntimeEvent.Completed,
        ))
        val journal = MemoryJournal()
        val command = RunCommand(
            "alice", "", RuntimeBinding.AndroidLocal, WorkbenchId("local"), WorkbenchId("session"),
            WorkbenchId("run"), "opendrsai", "once", "hello",
        )
        val events = JournaledChatExecutionCoordinator(
            ChatExecutionRouter(listOf(engine)), RuntimeV2EventRecorder(journal),
        ).execute(command, request(RuntimeAuthority.LOCAL_DEVICE)).toList()

        assertEquals(3, events.size)
        assertEquals(listOf(1L, 2L, 3L), events.map { it.checkpoint.lastSequence })
        assertEquals(
            listOf(ChatLifecycleSignal.ACTIVE, ChatLifecycleSignal.ACTIVE, ChatLifecycleSignal.COMPLETED),
            events.map { it.lifecycle },
        )
        assertEquals(WorkbenchRunStatus.COMPLETED, journal.checkpoint(command.runId)?.status)
        assertEquals(3, journal.events.size)
    }

    private fun request(authority: RuntimeAuthority) = ChatRunRequest(
        accountSubject = "alice",
        authority = authority,
        conversation = Conversation("session", "title"),
        input = "hello",
        attachments = emptyList(),
        runId = "run",
        userMessageId = "user-message",
        assistantMessageId = "assistant-message",
    )

    private class FakeEngine(
        override val authority: RuntimeAuthority,
        private val emitted: List<RuntimeEvent> = listOf(RuntimeEvent.Started("run")),
    ) : ChatEngine {
        val calls = mutableListOf<String>()
        override fun execute(request: ChatRunRequest) = flowOf(*emitted.toTypedArray())
            .also { calls += "execute:${request.runId}" }
        override fun pause(runId: String) { calls += "pause:$runId" }
        override fun stop(runId: String) { calls += "stop:$runId" }
    }

    private class MemoryJournal : RunJournal {
        private val checkpoints = mutableMapOf<WorkbenchId, RunCheckpoint>()
        val events = mutableListOf<WorkbenchEvent>()
        override suspend fun createIfAbsent(command: RunCommand): RunCheckpoint = checkpoints.getOrPut(command.runId) {
            RunCheckpoint(command, WorkbenchRunStatus.QUEUED)
        }
        override suspend fun findByIdempotencyKey(accountSubject: String, idempotencyKey: String) =
            checkpoints.values.firstOrNull { it.command.accountSubject == accountSubject && it.command.idempotencyKey == idempotencyKey }
        override suspend fun checkpoint(runId: WorkbenchId) = checkpoints[runId]
        override suspend fun eventExists(eventId: WorkbenchId) = events.any { it.eventId == eventId }
        override suspend fun append(event: WorkbenchEvent, next: RunCheckpoint): EventAppendDecision {
            events += event
            checkpoints[next.command.runId] = next
            return EventAppendDecision.APPEND
        }
        override suspend fun recoverable(accountSubject: String) = checkpoints.values.filter {
            it.command.accountSubject == accountSubject && !it.terminal
        }
    }
}
