package ai.drsai.remote.remote.data

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteActionableStateTest {
    @Test fun everyRecoverableLifecycleHasExactlyOneExpectedAction() {
        val expected = mapOf(
            RemoteLifecycleState.STALE to RemoteRecoveryAction.RETRY,
            RemoteLifecycleState.OFFLINE to RemoteRecoveryAction.RETRY,
            RemoteLifecycleState.AUTH_REQUIRED to RemoteRecoveryAction.SIGN_IN,
            RemoteLifecycleState.REVOKED to RemoteRecoveryAction.REASSOCIATE,
            RemoteLifecycleState.INCOMPATIBLE to RemoteRecoveryAction.UPDATE_APP,
        )
        expected.forEach { (lifecycle, action) ->
            val state = requireNotNull(remoteActionableState(lifecycle))
            assertEquals(action, state.action)
            assertFalse(state.actionLabel.isNullOrBlank())
            assertFalse(state.reason.contains("http", ignoreCase = true))
        }
        assertNull(remoteActionableState(RemoteLifecycleState.ONLINE))
        assertEquals(RemoteRecoveryAction.RESUME_ON_COMPUTER,
            remoteActionableState(RemoteLifecycleState.OFFLINE, paused = true)?.action)
    }

    @Test fun rawExceptionDetailsNeverReachUserMessage() {
        val message = safeRemoteFailureMessage(IOException("https://internal/token?secret=value"))
        assertEquals("网络连接失败", message)
        assertFalse(message.contains("http"))
        assertFalse(message.contains("secret"))
    }
}
