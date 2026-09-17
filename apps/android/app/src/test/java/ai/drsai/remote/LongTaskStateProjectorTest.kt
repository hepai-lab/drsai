package ai.drsai.remote

import ai.drsai.remote.runtime.reliability.LongTaskStateProjector
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LongTaskStateProjectorTest {
    private val command = RunCommand(
        accountSubject = "account", organization = "", binding = RuntimeBinding.AndroidLocal,
        workspaceId = WorkbenchId("workspace"), sessionId = WorkbenchId("session-7"),
        runId = WorkbenchId("run-9"), backendId = "opendrsai", idempotencyKey = "message-1",
        input = "controlled long task",
    )

    @Test fun `five fifteen and thirty minute tasks preserve one step across foreground changes`() {
        listOf(5L, 15L, 30L).forEach { minutes ->
            val projector = LongTaskStateProjector(startedAtMillis = 1_000)
            val checkpoint = RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 4)
            val foreground = projector.project(checkpoint, 1_000 + minutes * 60_000)
            val notification = projector.project(checkpoint, 1_001 + minutes * 60_000)
            assertEquals(foreground.stepId, notification.stepId)
            assertEquals(foreground.stepLabel, notification.stepLabel)
            assertEquals(minutes * 60_000, foreground.elapsedMillis)
        }
    }

    @Test fun `navigation returns to exact original run and session`() {
        val snapshot = LongTaskStateProjector(0).project(
            RunCheckpoint(command, WorkbenchRunStatus.WAITING_APPROVAL, lastSequence = 8), 900_000,
        )
        assertEquals("run-9", snapshot.navigation.runId)
        assertEquals("session-7", snapshot.navigation.sessionId)
        assertEquals("WAITING_APPROVAL:8", snapshot.stepId)
        assertEquals("Waiting for your approval", snapshot.stepLabel)
    }

    @Test fun `heartbeat publication is bounded and step transitions publish immediately`() {
        val projector = LongTaskStateProjector(0, minimumPublishIntervalMillis = 15_000)
        val first = projector.project(RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 1), 0)
        assertTrue(projector.shouldPublish(first, 0))
        repeat(14) { second ->
            val now = (second + 1) * 1_000L
            val same = projector.project(RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 1), now)
            assertFalse(projector.shouldPublish(same, now))
        }
        val next = projector.project(RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 2), 14_001)
        assertTrue(projector.shouldPublish(next, 14_001))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `stale state fails closed`() {
        val projector = LongTaskStateProjector(0)
        projector.project(RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 2), 1)
        projector.project(RunCheckpoint(command, WorkbenchRunStatus.RUNNING, lastSequence = 1), 2)
    }
}
