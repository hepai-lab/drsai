package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import ai.drsai.remote.remote.data.RemoteActionableKind
import ai.drsai.remote.remote.data.RemoteActionableState
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

@Composable
fun localizedRemoteActionableState(state: RemoteActionableState): RemoteActionableState {
    if (state.kind == RemoteActionableKind.CUSTOM) return state
    val title = stringResource(when (state.kind) {
        RemoteActionableKind.PAUSED -> R.string.actionable_paused_title
        RemoteActionableKind.LOADING -> R.string.remote_status_connecting
        RemoteActionableKind.STALE -> R.string.actionable_stale_title
        RemoteActionableKind.OFFLINE -> R.string.actionable_offline_title
        RemoteActionableKind.AUTH_REQUIRED, RemoteActionableKind.SIGN_IN_FAILURE -> R.string.actionable_auth_title
        RemoteActionableKind.REVOKED -> R.string.actionable_revoked_title
        RemoteActionableKind.INCOMPATIBLE, RemoteActionableKind.UPDATE_FAILURE -> R.string.actionable_incompatible_title
        RemoteActionableKind.RETRY_FAILURE -> R.string.actionable_retry_title
        RemoteActionableKind.REASSOCIATE_FAILURE -> R.string.actionable_reassociate_title
        RemoteActionableKind.CONTACT_ADMIN_FAILURE -> R.string.actionable_contact_admin_title
        RemoteActionableKind.CUSTOM -> error("custom handled above")
    })
    val reason = stringResource(when (state.kind) {
        RemoteActionableKind.PAUSED -> R.string.actionable_paused_reason
        RemoteActionableKind.LOADING -> R.string.actionable_loading_reason
        RemoteActionableKind.STALE -> R.string.actionable_stale_reason
        RemoteActionableKind.OFFLINE -> R.string.actionable_offline_reason
        RemoteActionableKind.AUTH_REQUIRED, RemoteActionableKind.SIGN_IN_FAILURE -> R.string.actionable_auth_reason
        RemoteActionableKind.REVOKED, RemoteActionableKind.REASSOCIATE_FAILURE -> R.string.actionable_reassociate_reason
        RemoteActionableKind.INCOMPATIBLE -> R.string.actionable_incompatible_reason
        RemoteActionableKind.RETRY_FAILURE -> R.string.actionable_retry_reason
        RemoteActionableKind.UPDATE_FAILURE -> R.string.actionable_update_reason
        RemoteActionableKind.CONTACT_ADMIN_FAILURE -> R.string.actionable_contact_admin_reason
        RemoteActionableKind.CUSTOM -> error("custom handled above")
    })
    val actionLabel = when (state.action) {
        RemoteRecoveryAction.NONE -> null
        RemoteRecoveryAction.RETRY -> stringResource(R.string.retry)
        RemoteRecoveryAction.SIGN_IN -> stringResource(R.string.sign_in_again)
        RemoteRecoveryAction.UPDATE_APP -> stringResource(R.string.check_for_updates)
        RemoteRecoveryAction.REASSOCIATE -> stringResource(R.string.diagnostic_scan_again)
        RemoteRecoveryAction.CONTACT_ADMIN -> stringResource(R.string.contact_administrator)
        RemoteRecoveryAction.RESUME_ON_COMPUTER -> stringResource(R.string.retry_after_resuming)
    }
    return state.copy(title = title, reason = reason, actionLabel = actionLabel)
}
