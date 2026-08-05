package ai.drsai.remote

import ai.drsai.remote.data.*
import ai.drsai.remote.runtime.coordinator.ChatEngine
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.workbench.model.RuntimeAuthority
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SelectableLocalChatEngineTest {
    @Test
    fun `rollout selects Python when gates pass including attachment requests`() = runTest {
        val kotlin = FakeEngine("kotlin")
        val python = FakeEngine("python")
        var state = PythonRuntimeRolloutState(true, true, true, policyEnabled = true)
        val engine = SelectableLocalChatEngine(kotlin, python) { state }

        assertEquals("python", (engine.execute(request()).toList().single() as RuntimeEvent.TextDelta).text)
        assertEquals(
            "python",
            (engine.execute(request(runId = "run-3", attachments = listOf(attachment()))).toList().single() as RuntimeEvent.TextDelta).text,
        )
        state = state.copy(pythonHealthy = false)
        assertEquals("kotlin", (engine.execute(request(runId = "run-2")).toList().single() as RuntimeEvent.TextDelta).text)
    }

    @Test
    fun `retryable Python failure falls back only before visible output or side effects`() = runTest {
        val kotlin = FakeEngine("kotlin")
        val safeFailure = EventEngine(listOf(RuntimeEvent.Started("run-1"), RuntimeEvent.Failed("init", true)))
        val safe = SelectableLocalChatEngine(kotlin, safeFailure) { PythonRuntimeRolloutState(true, true, true, policyEnabled = true) }
        assertEquals(listOf("kotlin"), safe.execute(request()).toList().filterIsInstance<RuntimeEvent.TextDelta>().map { it.text })

        val committedFailure = EventEngine(listOf(RuntimeEvent.Started("run-2"), RuntimeEvent.TextDelta("partial"), RuntimeEvent.Failed("network", true)))
        val committed = SelectableLocalChatEngine(kotlin, committedFailure) { PythonRuntimeRolloutState(true, true, true, policyEnabled = true) }
        val events = committed.execute(request(runId = "run-2")).toList()
        assertEquals(listOf("partial"), events.filterIsInstance<RuntimeEvent.TextDelta>().map { it.text })
        assertEquals(1, events.filterIsInstance<RuntimeEvent.Failed>().size)

        val sideEffectFailure = EventEngine(listOf(RuntimeEvent.Started("run-3"), RuntimeEvent.Failed("tool", false)))
        val protected = SelectableLocalChatEngine(kotlin, sideEffectFailure) {
            PythonRuntimeRolloutState(true, true, true, policyEnabled = true)
        }
        val protectedEvents = protected.execute(request(runId = "run-3")).toList()
        assertEquals(emptyList<String>(), protectedEvents.filterIsInstance<RuntimeEvent.TextDelta>().map { it.text })
        assertEquals(false, protectedEvents.single { it is RuntimeEvent.Failed }.let { (it as RuntimeEvent.Failed).retryable })
    }

    private fun request(runId: String = "run-1", attachments: List<MessageAttachment> = emptyList()) = ChatRunRequest(
        "subject", RuntimeAuthority.LOCAL_DEVICE,
        Conversation("session", "Session", agentId = "agent", agentName = "Agent", agentSource = "local"),
        "hello", attachments, runId, "user-$runId", "assistant-$runId",
    )

    private fun attachment() = MessageAttachment(
        id = "a", messageId = "m", conversationId = "session", remoteId = "r", name = "a.txt",
        mimeType = "text/plain", size = 1, sha256 = "0".repeat(64), localPath = null,
        kind = "document", status = "ready",
    )

    private class FakeEngine(private val label: String) : ChatEngine {
        override val authority = RuntimeAuthority.LOCAL_DEVICE
        override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> = flowOf(RuntimeEvent.TextDelta(label))
        override fun pause(runId: String) = Unit
        override fun stop(runId: String) = Unit
    }

    private class EventEngine(private val events: List<RuntimeEvent>) : ChatEngine {
        override val authority = RuntimeAuthority.LOCAL_DEVICE
        override fun execute(request: ChatRunRequest): Flow<RuntimeEvent> = flowOf(*events.toTypedArray())
        override fun pause(runId: String) = Unit
        override fun stop(runId: String) = Unit
    }
}
