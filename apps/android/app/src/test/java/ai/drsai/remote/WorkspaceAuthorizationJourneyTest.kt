package ai.drsai.remote

import ai.drsai.remote.runtime.device.WorkspaceAuthorizationJourney
import ai.drsai.remote.runtime.device.WorkspaceAuthorizationStep
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceAuthorizationJourneyTest {
    @Test fun deniedAndRevokedJourneysPreserveOriginalRunUntilGrant() {
        val requested = WorkspaceAuthorizationJourney().request("run-original")
        assertTrue(requested.visible)
        assertEquals("run-original", requested.runId)
        val picker = requested.openPicker()
        assertEquals(WorkspaceAuthorizationStep.PICKING_DIRECTORY, picker.step)
        assertEquals("run-original", picker.runId)
        assertEquals(WorkspaceAuthorizationStep.IDLE, picker.denied().step)

        val reauthorized = WorkspaceAuthorizationJourney().request("run-original").openPicker()
        assertEquals("run-original", reauthorized.runId)
        assertFalse(reauthorized.granted().visible)
    }

    @Test fun pickerCannotOpenWithoutExplicitScopeExplanation() {
        assertEquals(WorkspaceAuthorizationStep.IDLE, WorkspaceAuthorizationJourney().openPicker().step)
    }
}
