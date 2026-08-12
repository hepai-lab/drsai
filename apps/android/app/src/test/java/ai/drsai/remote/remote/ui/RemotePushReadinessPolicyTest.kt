package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemotePushReadiness
import ai.drsai.remote.remote.device.RemotePushProviderStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class RemotePushReadinessPolicyTest {
    @Test fun `local readiness matrix never claims end to end ready`() {
        assertEquals(
            RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED,
            localRemoteNotificationReadiness(RemotePushProviderStatus.NOT_CONFIGURED, true),
        )
        assertEquals(
            RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE,
            localRemoteNotificationReadiness(RemotePushProviderStatus.PLAY_SERVICES_UNAVAILABLE, true),
        )
        assertEquals(
            RemoteNotificationReadiness.PERMISSION_REQUIRED,
            localRemoteNotificationReadiness(RemotePushProviderStatus.READY, false),
        )
        assertEquals(
            RemoteNotificationReadiness.CHECKING,
            localRemoteNotificationReadiness(RemotePushProviderStatus.READY, true),
        )
    }

    @Test fun `platform matrix is ready only when provider and worker are ready`() {
        val local = RemoteNotificationReadiness.CHECKING
        assertEquals(
            RemoteNotificationReadiness.READY,
            resolvedRemoteNotificationReadiness(local, RemotePushReadiness(true, true, true)),
        )
        listOf(
            RemotePushReadiness(false, false, false),
            RemotePushReadiness(false, true, false),
            null,
        ).forEach { platform ->
            assertEquals(
                RemoteNotificationReadiness.PLATFORM_UNAVAILABLE,
                resolvedRemoteNotificationReadiness(local, platform),
            )
        }
    }

    @Test fun `platform result cannot override a newer local denial`() {
        listOf(
            RemoteNotificationReadiness.PERMISSION_REQUIRED,
            RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED,
            RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE,
        ).forEach { local ->
            assertEquals(
                local,
                resolvedRemoteNotificationReadiness(local, RemotePushReadiness(true, true, true)),
            )
        }
    }
}
