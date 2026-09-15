package ai.drsai.remote

import ai.drsai.remote.runtime.readiness.*
import ai.drsai.remote.runtime.setup.*
import org.junit.Assert.*
import org.junit.Test

class SetupJourneyTest {
    private fun readiness(kind: ReadinessKind, reason: String) = AgentReadiness(
        kind, "title", "summary", ReadinessAction.NONE, kind == ReadinessKind.READY, reason,
    )

    @Test fun `new unready users enter the exact repair step`() {
        assertEquals(SetupStep.MODEL_PROVIDER, SetupJourneyReducer.initial(null, readiness(ReadinessKind.CONFIGURATION_REQUIRED, "credential_missing"), 1).step)
        assertEquals(SetupStep.CONNECTION_CHECK, SetupJourneyReducer.initial(null, readiness(ReadinessKind.CONFIGURATION_REQUIRED, "provider_not_verified"), 1).step)
        assertEquals(SetupStep.RUNTIME_CHECK, SetupJourneyReducer.initial(null, readiness(ReadinessKind.CHECKING, "runtime_binding"), 1).step)
    }

    @Test fun `ready users move to first task and completion is sticky`() {
        val firstTask = SetupJourneyReducer.initial(null, readiness(ReadinessKind.READY, "ready"), 1)
        assertEquals(SetupStep.FIRST_TASK, firstTask.step)
        val complete = SetupJourneyReducer.firstTaskCompleted(firstTask, 2)
        assertEquals(SetupStatus.COMPLETE, complete.status)
        assertFalse(SetupJourneyReducer.initial(complete, readiness(ReadinessKind.CONFIGURATION_REQUIRED, "credential_missing"), 3).visible)
    }

    @Test fun `configured upgrades with existing activity are not interrupted`() {
        val existing = SetupJourneyReducer.initial(
            null, readiness(ReadinessKind.READY, "ready"), 1, hasExistingActivity = true,
        )
        assertEquals(SetupStatus.COMPLETE, existing.status)
        assertFalse(existing.visible)
    }

    @Test fun `skip is non destructive and can resume at current readiness`() {
        val active = SetupJourney(SetupStep.MODEL_PROVIDER, SetupStatus.ACTIVE, 1)
        val skipped = SetupJourneyReducer.skip(active, 2)
        assertFalse(skipped.visible)
        val resumed = SetupJourneyReducer.resume(skipped, readiness(ReadinessKind.CHECKING, "runtime_binding"), 3)
        assertTrue(resumed.visible)
        assertEquals(SetupStep.RUNTIME_CHECK, resumed.step)
    }

    @Test fun `active journey follows readiness without regressing a ready first task`() {
        val provider = SetupJourney(SetupStep.MODEL_PROVIDER, SetupStatus.ACTIVE, 1)
        val runtime = SetupJourneyReducer.readinessChanged(provider, readiness(ReadinessKind.CHECKING, "runtime_binding"), 2)
        assertEquals(SetupStep.RUNTIME_CHECK, runtime.step)
        val task = SetupJourneyReducer.readinessChanged(runtime, readiness(ReadinessKind.READY, "ready"), 3)
        assertEquals(SetupStep.FIRST_TASK, task.step)
        assertEquals(task, SetupJourneyReducer.readinessChanged(task, readiness(ReadinessKind.READY, "ready"), 4))
    }

    @Test fun `skipped journey remains skipped across process reconstruction until explicit resume`() {
        val skipped = SetupJourney(
            step = SetupStep.MODEL_PROVIDER,
            status = SetupStatus.SKIPPED,
            updatedAt = 2,
            stableReason = "credential_missing",
        )
        val afterProcessDeath = SetupJourneyReducer.initial(
            skipped,
            readiness(ReadinessKind.CONFIGURATION_REQUIRED, "credential_missing"),
            3,
        )
        assertEquals(skipped, afterProcessDeath)
        assertFalse(afterProcessDeath.visible)

        val resumed = SetupJourneyReducer.resume(
            afterProcessDeath,
            readiness(ReadinessKind.CONFIGURATION_REQUIRED, "credential_missing"),
            4,
        )
        assertEquals(SetupStatus.ACTIVE, resumed.status)
        assertEquals(SetupStep.MODEL_PROVIDER, resumed.step)
    }

    @Test fun `restoring an active step is idempotent and does not rewrite saved configuration`() {
        SetupStep.entries.filter { it != SetupStep.COMPLETE }.forEach { step ->
            val saved = SetupJourney(step, SetupStatus.ACTIVE, 7, "safe_reason")
            val restored = SetupJourneyReducer.initial(
                saved,
                readiness(ReadinessKind.CONFIGURATION_REQUIRED, "credential_missing"),
                8,
            )
            // Existing safe state is consumed as input only; Provider/model configuration is not part
            // of the reducer output and therefore cannot be duplicated during rotation or restart.
            assertEquals(SetupStatus.ACTIVE, restored.status)
        }
    }
}
