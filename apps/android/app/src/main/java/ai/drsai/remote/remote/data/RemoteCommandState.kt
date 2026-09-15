package ai.drsai.remote.remote.data

import ai.drsai.remote.R
import androidx.annotation.StringRes

enum class RemoteDeliveryState {
    OPTIMISTIC, SENDING, ACCEPTED, RUNNING, COMPLETED, UNCERTAIN, FAILED,
}

private val DELIVERY_TRANSITIONS = mapOf(
    RemoteDeliveryState.OPTIMISTIC to setOf(RemoteDeliveryState.SENDING, RemoteDeliveryState.FAILED),
    RemoteDeliveryState.SENDING to setOf(RemoteDeliveryState.ACCEPTED, RemoteDeliveryState.UNCERTAIN, RemoteDeliveryState.FAILED),
    RemoteDeliveryState.UNCERTAIN to setOf(RemoteDeliveryState.ACCEPTED, RemoteDeliveryState.RUNNING,
        RemoteDeliveryState.COMPLETED, RemoteDeliveryState.FAILED),
    RemoteDeliveryState.ACCEPTED to setOf(RemoteDeliveryState.RUNNING, RemoteDeliveryState.COMPLETED, RemoteDeliveryState.FAILED),
    RemoteDeliveryState.RUNNING to setOf(RemoteDeliveryState.COMPLETED, RemoteDeliveryState.FAILED),
    RemoteDeliveryState.COMPLETED to emptySet(),
    RemoteDeliveryState.FAILED to setOf(RemoteDeliveryState.SENDING),
)

fun canTransitionDelivery(from: RemoteDeliveryState, to: RemoteDeliveryState): Boolean =
    from == to || to in DELIVERY_TRANSITIONS.getValue(from)

fun deliveryFailureState(
    sideEffectRequestStarted: Boolean,
    transportOutcomeUnknown: Boolean,
): RemoteDeliveryState = if (sideEffectRequestStarted && transportOutcomeUnknown) {
    RemoteDeliveryState.UNCERTAIN
} else {
    RemoteDeliveryState.FAILED
}

@StringRes fun RemoteDeliveryState.labelResource(): Int = when (this) {
    RemoteDeliveryState.OPTIMISTIC -> R.string.remote_delivery_optimistic
    RemoteDeliveryState.SENDING -> R.string.remote_delivery_sending
    RemoteDeliveryState.ACCEPTED -> R.string.remote_delivery_accepted
    RemoteDeliveryState.RUNNING -> R.string.remote_delivery_running
    RemoteDeliveryState.COMPLETED -> R.string.remote_delivery_completed
    RemoteDeliveryState.UNCERTAIN -> R.string.remote_delivery_uncertain
    RemoteDeliveryState.FAILED -> R.string.remote_delivery_failed
}

enum class RemoteApprovalDecisionState { PENDING, DECIDING, APPROVED, DENIED, CANCELLED, EXPIRED }

data class RemoteApprovalProjectionState(
    val decisionState: RemoteApprovalDecisionState,
    val outcome: String?,
)

fun convergeApprovalProjection(
    currentApprovalId: String?,
    currentState: RemoteApprovalDecisionState,
    currentOutcome: String?,
    pendingApprovalId: String?,
): RemoteApprovalProjectionState = when {
    pendingApprovalId == null || pendingApprovalId == currentApprovalId ->
        RemoteApprovalProjectionState(currentState, currentOutcome)
    else -> RemoteApprovalProjectionState(RemoteApprovalDecisionState.PENDING, null)
}

fun approvalDecisionState(statusOrAction: String?): RemoteApprovalDecisionState? = when (
    statusOrAction?.trim()?.lowercase()
) {
    "approved", "approve", "approval.approved" -> RemoteApprovalDecisionState.APPROVED
    "denied", "deny", "approval.denied" -> RemoteApprovalDecisionState.DENIED
    "cancelled", "canceled", "cancel", "approval.cancelled", "approval.canceled" ->
        RemoteApprovalDecisionState.CANCELLED
    "expired", "approval.expired" -> RemoteApprovalDecisionState.EXPIRED
    "pending", "approval.requested" -> RemoteApprovalDecisionState.PENDING
    else -> null
}

@StringRes fun RemoteApprovalDecisionState.labelResource(): Int = when (this) {
    RemoteApprovalDecisionState.PENDING -> R.string.remote_approval_pending
    RemoteApprovalDecisionState.DECIDING -> R.string.remote_approval_deciding
    RemoteApprovalDecisionState.APPROVED -> R.string.remote_approval_approved
    RemoteApprovalDecisionState.DENIED -> R.string.remote_approval_denied
    RemoteApprovalDecisionState.CANCELLED -> R.string.remote_approval_cancelled
    RemoteApprovalDecisionState.EXPIRED -> R.string.remote_approval_expired_label
}

enum class RemoteRunControlState { IDLE, CANCELLING, RETRYING, RECONCILING }
