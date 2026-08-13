package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteLifecycleState
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.data.remoteActionableState
import ai.drsai.remote.remote.model.RemoteConnectionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteHostStatusPresentationTest {
    @Test fun sixProductStatesExplainReasonAndActionWithoutTransportTerms() {
        val states = listOf(
            remoteHostStatusPresentation(RemoteConnectionState.ONLINE),
            remoteHostStatusPresentation(RemoteConnectionState.OFFLINE),
            remoteHostStatusPresentation(RemoteConnectionState.PAUSED),
            requireNotNull(remoteActionableState(RemoteLifecycleState.REVOKED)).let {
                RemoteHostStatusPresentation(it.title, it.reason, it.action, it.actionLabel)
            },
            remoteHostStatusPresentation(RemoteConnectionState.INCOMPATIBLE),
            requireNotNull(remoteNotificationPresentation(RemoteNotificationReadiness.PERMISSION_REQUIRED)),
        )
        assertEquals(
            listOf("在线", "离线", "已暂停", "此设备已解除关联", "需要更新", "通知未启用"),
            states.map { it.title },
        )
        states.forEach { state ->
            assertFalse(state.reason.isBlank())
            assertFalse(Regex("generation|wss|issuer|runtime", RegexOption.IGNORE_CASE).containsMatchIn(
                state.accessibilityDescription,
            ))
        }
        assertEquals(RemoteRecoveryAction.RETRY, states[1].action)
        assertEquals(RemoteRecoveryAction.RESUME_ON_COMPUTER, states[2].action)
        assertEquals(RemoteRecoveryAction.REASSOCIATE, states[3].action)
        assertEquals(RemoteRecoveryAction.UPDATE_APP, states[4].action)
        assertNotNull(states[5].actionLabel)
    }

    @Test fun notificationReadyHasNoWarning() {
        assertNull(remoteNotificationPresentation(RemoteNotificationReadiness.READY))
    }

    @Test fun unavailablePushPromisesForegroundCatchUpInsteadOfFakeBackgroundSuccess() {
        listOf(
            RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED,
            RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE,
            RemoteNotificationReadiness.PLATFORM_UNAVAILABLE,
        ).forEach { state ->
            val presentation = requireNotNull(remoteNotificationPresentation(state))
            assertEquals("后台通知", presentation.title.take(4))
            assertTrue(presentation.reason.contains("打开 App 后会自动同步"))
        }
    }

    @Test fun englishHostAndNotificationStatesAreCompleteAndAccessible() {
        val offline = remoteHostStatusPresentation(
            RemoteConnectionState.OFFLINE, language = RemoteUiLanguage.EN,
        )
        assertEquals("Offline", offline.title)
        assertEquals("Retry", offline.actionLabel)
        assertTrue(offline.accessibilityDescription.startsWith("Computer status: Offline."))
        val notification = requireNotNull(remoteNotificationPresentation(
            RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED, RemoteUiLanguage.EN,
        ))
        assertTrue(notification.reason.contains("Opening the app syncs"))
        assertFalse(notification.reason.contains("后台"))
    }

    @Test fun localeSelectionFailsSafeToEnglishOutsideChinese() {
        assertEquals(RemoteUiLanguage.ZH, remoteUiLanguage("zh-CN"))
        assertEquals(RemoteUiLanguage.EN, remoteUiLanguage("en-US"))
        assertEquals(RemoteUiLanguage.EN, remoteUiLanguage(null))
    }

    @Test fun actionableStatesUseStableActionInsteadOfTranslatingRawErrorText() {
        val source = requireNotNull(remoteActionableState(RemoteLifecycleState.REVOKED))
        val localized = localizedRemoteActionableState(source, RemoteUiLanguage.EN)
        assertEquals(RemoteRecoveryAction.REASSOCIATE, localized.action)
        assertEquals("Reconnect this computer", localized.title)
        assertEquals("Scan again", localized.actionLabel)
        assertFalse(localized.reason.contains(source.reason))
    }
}
