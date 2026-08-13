package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.RelayContractGenerated
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

    @Test fun everyGeneratedRelayErrorHasExactlyOneSafeUserAction() {
        val expectedActions = setOf(
            RemoteRecoveryAction.RETRY,
            RemoteRecoveryAction.SIGN_IN,
            RemoteRecoveryAction.REASSOCIATE,
            RemoteRecoveryAction.UPDATE_APP,
            RemoteRecoveryAction.CONTACT_ADMIN,
        )
        val mapped = RelayContractGenerated.ERROR_ACTIONS.map { (code, _) ->
            val state = remoteActionableFailure(RelayHttpException(400, "corr", code))
            assertFalse(state.title.contains("http", ignoreCase = true))
            assertFalse(state.reason.contains("token", ignoreCase = true))
            assertFalse(state.reason.contains("/"))
            assertFalse(state.actionLabel.isNullOrBlank())
            state.action
        }.toSet()
        assertEquals(expectedActions, mapped)
    }

    @Test fun unknownErrorsFailClosedAndTransientFallbackRetries() {
        assertEquals(
            RemoteRecoveryAction.CONTACT_ADMIN,
            remoteActionableFailure(RelayHttpException(400, null, "new_unknown_error")).action,
        )
        assertEquals(
            RemoteRecoveryAction.RETRY,
            remoteActionableFailure(RelayHttpException(503, null, "new_unknown_error")).action,
        )
        assertEquals(
            RemoteRecoveryAction.SIGN_IN,
            remoteActionableFailure(RelayHttpException(401, null)).action,
        )
        assertEquals(
            RemoteRecoveryAction.REASSOCIATE,
            remoteActionableFailure(RelayHttpException(403, null)).action,
        )
    }
}
