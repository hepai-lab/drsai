package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

enum class RemoteDiagnosticCheck { OK, FAILED, UNKNOWN }

enum class RemoteDiagnosticAction {
    NONE, START_COMPUTER, RETRY_CONNECTION, SIGN_IN, REPAIR_DEVICE, UPDATE, ENABLE_NOTIFICATIONS,
}

enum class RemoteDiagnosticKind {
    HEALTHY, COMPUTER_OFFLINE, SIGN_IN_REQUIRED, DEVICE_EXPIRED, NETWORK_ERROR, UPDATE_REQUIRED,
    NOTIFICATIONS_DISABLED,
}

data class RemoteConnectionDiagnosticInput(
    val computer: RemoteDiagnosticCheck,
    val platform: RemoteDiagnosticCheck,
    val account: RemoteDiagnosticCheck,
    val deviceIdentity: RemoteDiagnosticCheck,
    val protocol: RemoteDiagnosticCheck,
    val notifications: RemoteDiagnosticCheck,
)

data class RemoteConnectionDiagnostic(
    val kind: RemoteDiagnosticKind,
    val action: RemoteDiagnosticAction,
    val checks: RemoteConnectionDiagnosticInput,
)

data class RemoteConnectionDiagnosticPresentation(
    val title: String,
    val reason: String,
    val actionLabel: String?,
)

/** Chooses exactly one repair at the earliest failed user boundary. UNKNOWN is informational. */
fun diagnoseRemoteConnection(checks: RemoteConnectionDiagnosticInput): RemoteConnectionDiagnostic {
    val (kind, action) = when {
        checks.computer == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.COMPUTER_OFFLINE to RemoteDiagnosticAction.START_COMPUTER
        checks.account == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.SIGN_IN_REQUIRED to RemoteDiagnosticAction.SIGN_IN
        checks.deviceIdentity == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.DEVICE_EXPIRED to RemoteDiagnosticAction.REPAIR_DEVICE
        checks.platform == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.NETWORK_ERROR to RemoteDiagnosticAction.RETRY_CONNECTION
        checks.protocol == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.UPDATE_REQUIRED to RemoteDiagnosticAction.UPDATE
        checks.notifications == RemoteDiagnosticCheck.FAILED ->
            RemoteDiagnosticKind.NOTIFICATIONS_DISABLED to RemoteDiagnosticAction.ENABLE_NOTIFICATIONS
        else -> RemoteDiagnosticKind.HEALTHY to RemoteDiagnosticAction.NONE
    }
    return RemoteConnectionDiagnostic(kind, action, checks)
}

@Composable
fun remoteConnectionDiagnosticPresentation(
    diagnostic: RemoteConnectionDiagnostic,
): RemoteConnectionDiagnosticPresentation {
    val title = stringResource(when (diagnostic.kind) {
        RemoteDiagnosticKind.HEALTHY -> R.string.diagnostic_healthy_title
        RemoteDiagnosticKind.COMPUTER_OFFLINE -> R.string.diagnostic_computer_offline_title
        RemoteDiagnosticKind.SIGN_IN_REQUIRED -> R.string.diagnostic_sign_in_title
        RemoteDiagnosticKind.DEVICE_EXPIRED -> R.string.diagnostic_device_expired_title
        RemoteDiagnosticKind.NETWORK_ERROR -> R.string.diagnostic_network_error_title
        RemoteDiagnosticKind.UPDATE_REQUIRED -> R.string.diagnostic_update_title
        RemoteDiagnosticKind.NOTIFICATIONS_DISABLED -> R.string.diagnostic_notifications_title
    })
    val reason = stringResource(when (diagnostic.kind) {
        RemoteDiagnosticKind.HEALTHY -> R.string.diagnostic_healthy_reason
        RemoteDiagnosticKind.COMPUTER_OFFLINE -> R.string.diagnostic_computer_offline_reason
        RemoteDiagnosticKind.SIGN_IN_REQUIRED -> R.string.diagnostic_sign_in_reason
        RemoteDiagnosticKind.DEVICE_EXPIRED -> R.string.diagnostic_device_expired_reason
        RemoteDiagnosticKind.NETWORK_ERROR -> R.string.diagnostic_network_error_reason
        RemoteDiagnosticKind.UPDATE_REQUIRED -> R.string.diagnostic_update_reason
        RemoteDiagnosticKind.NOTIFICATIONS_DISABLED -> R.string.diagnostic_notifications_reason
    })
    val actionLabel = when (diagnostic.action) {
        RemoteDiagnosticAction.NONE -> null
        RemoteDiagnosticAction.START_COMPUTER -> stringResource(R.string.diagnostic_check_computer)
        RemoteDiagnosticAction.RETRY_CONNECTION -> stringResource(R.string.retry)
        RemoteDiagnosticAction.SIGN_IN -> stringResource(R.string.sign_in_again)
        RemoteDiagnosticAction.REPAIR_DEVICE -> stringResource(R.string.diagnostic_scan_again)
        RemoteDiagnosticAction.UPDATE -> stringResource(R.string.check_for_updates)
        RemoteDiagnosticAction.ENABLE_NOTIFICATIONS -> stringResource(R.string.enable_notifications)
    }
    return RemoteConnectionDiagnosticPresentation(title, reason, actionLabel)
}
