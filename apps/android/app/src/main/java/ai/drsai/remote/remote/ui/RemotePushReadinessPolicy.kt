package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemotePushReadiness
import ai.drsai.remote.remote.device.RemotePushProviderStatus

/** Honest product state: local SDK readiness alone never implies end-to-end push readiness. */
fun localRemoteNotificationReadiness(
    provider: RemotePushProviderStatus,
    notificationsEnabled: Boolean,
): RemoteNotificationReadiness = when {
    provider == RemotePushProviderStatus.NOT_CONFIGURED ->
        RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED
    provider == RemotePushProviderStatus.PLAY_SERVICES_UNAVAILABLE ->
        RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE
    !notificationsEnabled -> RemoteNotificationReadiness.PERMISSION_REQUIRED
    else -> RemoteNotificationReadiness.CHECKING
}

fun resolvedRemoteNotificationReadiness(
    local: RemoteNotificationReadiness,
    platform: RemotePushReadiness?,
): RemoteNotificationReadiness = when {
    local != RemoteNotificationReadiness.CHECKING -> local
    platform?.ready == true -> RemoteNotificationReadiness.READY
    else -> RemoteNotificationReadiness.PLATFORM_UNAVAILABLE
}
