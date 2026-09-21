package ai.drsai.remote

import ai.drsai.remote.workbench.model.SessionModelSwitchPolicy
import org.junit.Assert.*
import org.junit.Test

class SessionModelSwitchPolicyTest {
    @Test fun `model switch affects next run while active run and history remain pinned`() {
        val decision = SessionModelSwitchPolicy.switch("deepseek-v4-pro", "deepseek-v4-flash")
        assertEquals("deepseek-v4-pro", decision.activeRunModelId)
        assertEquals("deepseek-v4-flash", decision.nextRunModelId)
        assertTrue(decision.historyReplayUnchanged)
        assertTrue(decision.userMessage.contains("next message"))
    }
}
