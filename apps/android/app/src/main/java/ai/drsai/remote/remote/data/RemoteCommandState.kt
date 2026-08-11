package ai.drsai.remote.remote.data

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

fun RemoteDeliveryState.userLabel(): String = when (this) {
    RemoteDeliveryState.OPTIMISTIC -> "准备发送"
    RemoteDeliveryState.SENDING -> "发送中"
    RemoteDeliveryState.ACCEPTED -> "已接收"
    RemoteDeliveryState.RUNNING -> "运行中"
    RemoteDeliveryState.COMPLETED -> "已完成"
    RemoteDeliveryState.UNCERTAIN -> "结果待确认"
    RemoteDeliveryState.FAILED -> "发送失败"
}

enum class RemoteApprovalDecisionState { PENDING, DECIDING, APPROVED, DENIED, CANCELLED, EXPIRED }

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

fun RemoteApprovalDecisionState.userLabel(): String = when (this) {
    RemoteApprovalDecisionState.PENDING -> "等待确认"
    RemoteApprovalDecisionState.DECIDING -> "正在提交决定…"
    RemoteApprovalDecisionState.APPROVED -> "已同意"
    RemoteApprovalDecisionState.DENIED -> "已拒绝"
    RemoteApprovalDecisionState.CANCELLED -> "已取消"
    RemoteApprovalDecisionState.EXPIRED -> "已过期"
}

enum class RemoteRunControlState { IDLE, CANCELLING, RETRYING }
