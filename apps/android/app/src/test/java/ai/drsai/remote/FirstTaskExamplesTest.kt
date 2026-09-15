package ai.drsai.remote

import ai.drsai.remote.runtime.setup.*
import ai.drsai.remote.runtime.readiness.*
import org.junit.Assert.*
import org.junit.Test

class FirstTaskExamplesTest {
    @Test fun `examples follow current capability surface`() {
        val chatOnly = FirstTaskExamples.available(emptySet())
        assertEquals(listOf(FirstTaskKind.CHAT), chatOnly.map(FirstTaskExample::kind))

        val full = FirstTaskExamples.available(setOf("web.search", "get_device_info"))
        assertEquals(listOf(FirstTaskKind.CHAT, FirstTaskKind.RETRIEVAL, FirstTaskKind.LOCAL_SAFE_TOOL), full.map(FirstTaskExample::kind))
        assertEquals(R.string.first_task_retrieval_prompt, full.single { it.kind == FirstTaskKind.RETRIEVAL }.prompt)
        assertEquals(full.size, full.map(FirstTaskExample::prompt).distinct().size)
    }

    @Test fun `failed first task remains recoverable at same step without account transition`() {
        val current = SetupJourney(SetupStep.FIRST_TASK, SetupStatus.ACTIVE, updatedAt = 1)
        val ready = AgentReadiness(ReadinessKind.READY, "ready", "ready", ReadinessAction.NONE, true, "ready")
        // A failed Run does not dispatch firstTaskCompleted. Readiness refresh must keep the same journey.
        assertEquals(current, SetupJourneyReducer.readinessChanged(current, ready, now = 2))
        assertTrue(current.visible)
    }

    @Test fun `successful example completes within product time budget`() {
        val startedAt = 1_000L
        val completedAt = startedAt + 179_999L
        val completed = SetupJourneyReducer.firstTaskCompleted(
            SetupJourney(SetupStep.FIRST_TASK, SetupStatus.ACTIVE, startedAt), completedAt,
        )
        assertEquals(SetupStatus.COMPLETE, completed.status)
        assertTrue(completed.updatedAt - startedAt < 180_000L)
    }
}
