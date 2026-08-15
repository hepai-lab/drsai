package ai.drsai.remote

import ai.drsai.remote.runtime.device.RunNotificationAction
import ai.drsai.remote.runtime.device.RunNotificationActionPolicy
import ai.drsai.remote.runtime.device.RunNotificationActionScope
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunNotificationActionPolicyTest {
    @Test fun `all actions bind account run session and optional interaction`() {
        RunNotificationAction.entries.forEach { action ->
            val interaction = if (action in setOf(RunNotificationAction.OPEN_APPROVAL, RunNotificationAction.OPEN_RESULT)) "item-1" else null
            val scope = RunNotificationActionScope(action, "account-1", "run-1", "session-1", interaction)
            assertTrue(RunNotificationActionPolicy.authorize(scope, "account-1", "run-1", "session-1", interaction))
        }
    }

    @Test fun `scope mismatch fails closed`() {
        val scope = RunNotificationActionScope(RunNotificationAction.OPEN_APPROVAL, "account-1", "run-1", "session-1", "approval-1")
        assertFalse(RunNotificationActionPolicy.authorize(scope, "account-2", "run-1", "session-1", "approval-1"))
        assertFalse(RunNotificationActionPolicy.authorize(scope, "account-1", "run-2", "session-1", "approval-1"))
        assertFalse(RunNotificationActionPolicy.authorize(scope, "account-1", "run-1", "session-2", "approval-1"))
        assertFalse(RunNotificationActionPolicy.authorize(scope, "account-1", "run-1", "session-1", "approval-2"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `approval without interaction is rejected`() {
        RunNotificationActionScope(RunNotificationAction.OPEN_APPROVAL, "account", "run", "session")
    }
}
