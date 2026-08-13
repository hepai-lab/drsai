package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteActionableState
import ai.drsai.remote.remote.data.RemoteRecoveryAction

fun localizedRemoteActionableState(
    state: RemoteActionableState,
    language: RemoteUiLanguage,
): RemoteActionableState {
    if (language == RemoteUiLanguage.ZH) return state
    return when (state.action) {
        RemoteRecoveryAction.RETRY -> RemoteActionableState(
            "Temporarily unavailable", "Check your network and retry. Synced content remains available.", state.action, "Retry",
        )
        RemoteRecoveryAction.SIGN_IN -> RemoteActionableState(
            "Sign-in expired", "Sign in again to keep using the existing device authorization.", state.action, "Sign in",
        )
        RemoteRecoveryAction.REASSOCIATE -> RemoteActionableState(
            "Reconnect this computer", "Generate a new QR code on the computer.", state.action, "Scan again",
        )
        RemoteRecoveryAction.UPDATE_APP -> RemoteActionableState(
            "Version incompatible", "Update OpenDrSai before reconnecting.", state.action, "Check for updates",
        )
        RemoteRecoveryAction.CONTACT_ADMIN -> RemoteActionableState(
            "Could not complete the action", "If retrying fails, contact your administrator with the association reference.",
            state.action, "Contact administrator",
        )
        RemoteRecoveryAction.RESUME_ON_COMPUTER -> RemoteActionableState(
            "Computer paused", "Mobile access is paused on the computer. Existing authorization is preserved.",
            state.action, "Retry after resuming",
        )
        RemoteRecoveryAction.NONE -> RemoteActionableState(
            "Connecting", "Loading the remote workspace.", state.action, null,
        )
    }
}
