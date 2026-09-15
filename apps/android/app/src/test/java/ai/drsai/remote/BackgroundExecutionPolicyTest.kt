package ai.drsai.remote

import ai.drsai.remote.runtime.reliability.*
import org.junit.Assert.*
import org.junit.Test

class BackgroundExecutionPolicyTest {
    private val healthy = BackgroundExecutionConditions(true, true, false, false, false, false)

    @Test fun `doze saver restriction and foreground timeout never fake online`() {
        val fixtures = listOf(
            healthy.copy(doze = true) to "device_doze",
            healthy.copy(appForeground = false, batterySaver = true) to "battery_saver_background",
            healthy.copy(backgroundRestricted = true) to "background_execution_restricted",
            healthy.copy(foregroundServiceTimedOut = true) to "foreground_service_timeout",
            healthy.copy(appForeground = false, foregroundServiceActive = false) to "foreground_service_required",
        )
        fixtures.forEach { (input, reason) ->
            val decision = BackgroundExecutionPolicy.decide(input)
            assertNotEquals(BackgroundExecutionAction.CONTINUE_FOREGROUND, decision.action)
            assertEquals(reason, decision.reason)
            assertTrue(decision.preserveRun)
            assertNull(decision.periodicWakeupMillis)
        }
    }

    @Test fun `foreground execution remains allowed when constraints are healthy`() {
        assertEquals(BackgroundExecutionAction.CONTINUE_FOREGROUND, BackgroundExecutionPolicy.decide(healthy).action)
    }
}
