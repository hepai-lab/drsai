package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteLifecycleState
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.data.RemoteActionableKind
import ai.drsai.remote.remote.data.remoteActionableState
import ai.drsai.remote.remote.model.RemoteConnectionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteHostStatusPresentationTest {
    @Test fun connectionStatesMapToStableKinds() {
        assertEquals(RemoteHostStatusKind.ONLINE, remoteHostStatusKind(RemoteConnectionState.ONLINE))
        assertEquals(RemoteHostStatusKind.OFFLINE, remoteHostStatusKind(RemoteConnectionState.OFFLINE))
        assertEquals(RemoteHostStatusKind.PAUSED, remoteHostStatusKind(RemoteConnectionState.PAUSED))
        assertEquals(RemoteHostStatusKind.AUTH_REQUIRED, remoteHostStatusKind(RemoteConnectionState.AUTH_REQUIRED))
        assertEquals(RemoteHostStatusKind.INCOMPATIBLE, remoteHostStatusKind(RemoteConnectionState.INCOMPATIBLE))
    }

    @Test fun notificationReadyHasNoPresentationKind() {
        assertNull(remoteNotificationKind(RemoteNotificationReadiness.READY))
        assertNotNull(remoteNotificationKind(RemoteNotificationReadiness.PERMISSION_REQUIRED))
    }

    @Test fun localeSelectionFailsSafeToEnglishOutsideChinese() {
        assertEquals(RemoteUiLanguage.ZH, remoteUiLanguage("zh-CN"))
        assertEquals(RemoteUiLanguage.EN, remoteUiLanguage("en-US"))
        assertEquals(RemoteUiLanguage.EN, remoteUiLanguage(null))
    }

    @Test fun actionableStatesUseStableActionInsteadOfTranslatingRawErrorText() {
        val source = requireNotNull(remoteActionableState(RemoteLifecycleState.REVOKED))
        assertEquals(RemoteRecoveryAction.REASSOCIATE, source.action)
        assertEquals(RemoteActionableKind.REVOKED, source.kind)
    }
}
