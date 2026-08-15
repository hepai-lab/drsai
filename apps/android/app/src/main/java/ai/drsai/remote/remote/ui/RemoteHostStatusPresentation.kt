package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.model.RemoteConnectionState
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

enum class RemoteHostStatusKind { ONLINE, CONNECTING, DEGRADED, OFFLINE, PAUSED, AUTH_REQUIRED, INCOMPATIBLE }

data class RemoteHostStatusPresentation(
    val title: String,
    val reason: String,
    val action: RemoteRecoveryAction = RemoteRecoveryAction.NONE,
    val actionLabel: String? = null,
    val accessibilityDescription: String,
)

fun remoteHostStatusKind(state: RemoteConnectionState): RemoteHostStatusKind = when (state) {
    RemoteConnectionState.ONLINE -> RemoteHostStatusKind.ONLINE
    RemoteConnectionState.CONNECTING -> RemoteHostStatusKind.CONNECTING
    RemoteConnectionState.DEGRADED -> RemoteHostStatusKind.DEGRADED
    RemoteConnectionState.OFFLINE -> RemoteHostStatusKind.OFFLINE
    RemoteConnectionState.PAUSED -> RemoteHostStatusKind.PAUSED
    RemoteConnectionState.AUTH_REQUIRED -> RemoteHostStatusKind.AUTH_REQUIRED
    RemoteConnectionState.INCOMPATIBLE -> RemoteHostStatusKind.INCOMPATIBLE
}

@Composable
fun remoteHostStatusPresentation(
    state: RemoteConnectionState,
    lastSeenLabel: String = "",
): RemoteHostStatusPresentation {
    val kind = remoteHostStatusKind(state)
    val title = stringResource(when (kind) {
        RemoteHostStatusKind.ONLINE -> R.string.remote_status_online
        RemoteHostStatusKind.CONNECTING -> R.string.remote_status_connecting
        RemoteHostStatusKind.DEGRADED -> R.string.remote_status_degraded
        RemoteHostStatusKind.OFFLINE -> R.string.remote_status_offline
        RemoteHostStatusKind.PAUSED -> R.string.remote_status_paused
        RemoteHostStatusKind.AUTH_REQUIRED -> R.string.remote_status_auth_required
        RemoteHostStatusKind.INCOMPATIBLE -> R.string.remote_status_incompatible
    })
    val reason = when (kind) {
        RemoteHostStatusKind.ONLINE -> stringResource(R.string.remote_reason_online)
        RemoteHostStatusKind.CONNECTING -> stringResource(R.string.remote_reason_connecting)
        RemoteHostStatusKind.DEGRADED -> stringResource(R.string.remote_reason_degraded)
        RemoteHostStatusKind.OFFLINE -> if (lastSeenLabel.isBlank()) stringResource(R.string.remote_reason_offline)
            else stringResource(R.string.remote_reason_offline_last_seen, lastSeenLabel)
        RemoteHostStatusKind.PAUSED -> stringResource(R.string.remote_reason_paused)
        RemoteHostStatusKind.AUTH_REQUIRED -> stringResource(R.string.remote_reason_auth_required)
        RemoteHostStatusKind.INCOMPATIBLE -> stringResource(R.string.remote_reason_incompatible)
    }
    val action = when (kind) {
        RemoteHostStatusKind.DEGRADED, RemoteHostStatusKind.OFFLINE -> RemoteRecoveryAction.RETRY
        RemoteHostStatusKind.PAUSED -> RemoteRecoveryAction.RESUME_ON_COMPUTER
        RemoteHostStatusKind.AUTH_REQUIRED -> RemoteRecoveryAction.SIGN_IN
        RemoteHostStatusKind.INCOMPATIBLE -> RemoteRecoveryAction.UPDATE_APP
        else -> RemoteRecoveryAction.NONE
    }
    val actionLabel = when (action) {
        RemoteRecoveryAction.RETRY -> stringResource(R.string.retry)
        RemoteRecoveryAction.RESUME_ON_COMPUTER -> stringResource(R.string.retry_after_resuming)
        RemoteRecoveryAction.SIGN_IN -> stringResource(R.string.sign_in_again)
        RemoteRecoveryAction.UPDATE_APP -> stringResource(R.string.check_for_updates)
        else -> null
    }
    return RemoteHostStatusPresentation(
        title, reason, action, actionLabel,
        stringResource(R.string.remote_status_accessibility, title, reason.trimEnd('。', '.')) +
            (actionLabel?.let { stringResource(R.string.remote_status_action_accessibility, it) } ?: ""),
    )
}

fun remoteNotificationKind(state: RemoteNotificationReadiness): RemoteNotificationReadiness? =
    state.takeUnless { it == RemoteNotificationReadiness.READY }

@Composable
fun remoteNotificationPresentation(state: RemoteNotificationReadiness): RemoteHostStatusPresentation? {
    remoteNotificationKind(state) ?: return null
    val title = stringResource(when (state) {
        RemoteNotificationReadiness.CHECKING -> R.string.notification_status_checking
        RemoteNotificationReadiness.PERMISSION_REQUIRED -> R.string.notification_status_disabled
        RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED, RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE -> R.string.notification_status_unavailable
        RemoteNotificationReadiness.PLATFORM_UNAVAILABLE -> R.string.notification_status_temporarily_unavailable
        RemoteNotificationReadiness.READY -> error("ready_has_no_presentation")
    })
    val reason = stringResource(when (state) {
        RemoteNotificationReadiness.CHECKING -> R.string.notification_reason_checking
        RemoteNotificationReadiness.PERMISSION_REQUIRED -> R.string.notification_reason_permission
        RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED -> R.string.notification_reason_provider
        RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE -> R.string.notification_reason_play_services
        RemoteNotificationReadiness.PLATFORM_UNAVAILABLE -> R.string.notification_reason_platform
        RemoteNotificationReadiness.READY -> error("ready_has_no_presentation")
    })
    val actionLabel = if (state == RemoteNotificationReadiness.PERMISSION_REQUIRED) stringResource(R.string.enable_notifications) else null
    return RemoteHostStatusPresentation(
        title, reason, actionLabel = actionLabel,
        accessibilityDescription = stringResource(R.string.remote_status_accessibility, title, reason.trimEnd('。', '.')) +
            (actionLabel?.let { stringResource(R.string.remote_status_action_accessibility, it) } ?: ""),
    )
}
