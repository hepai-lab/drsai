package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.RelayContractGenerated

enum class RemoteRecoveryAction {
    NONE, RETRY, SIGN_IN, UPDATE_APP, REASSOCIATE, CONTACT_ADMIN, RESUME_ON_COMPUTER,
}

data class RemoteActionableState(
    val title: String,
    val reason: String,
    val action: RemoteRecoveryAction,
    val actionLabel: String?,
)

/** Stable, user-facing recovery state. Never accepts or exposes raw exception text. */
fun remoteActionableState(
    lifecycle: RemoteLifecycleState,
    paused: Boolean = false,
): RemoteActionableState? = when {
    paused -> RemoteActionableState("此电脑已暂停", "电脑端暂停了移动访问。已有授权仍然保留。",
        RemoteRecoveryAction.RESUME_ON_COMPUTER, "在电脑端恢复后重试")
    lifecycle == RemoteLifecycleState.LOADING ->
        RemoteActionableState("正在连接", "正在读取远程工作区。", RemoteRecoveryAction.NONE, null)
    lifecycle == RemoteLifecycleState.STALE ->
        RemoteActionableState("当前显示缓存内容", "连接暂时不可用，历史内容仍可查看。",
            RemoteRecoveryAction.RETRY, "重试")
    lifecycle == RemoteLifecycleState.OFFLINE ->
        RemoteActionableState("无法连接远程电脑", "请检查手机和电脑网络，然后重试。",
            RemoteRecoveryAction.RETRY, "重试")
    lifecycle == RemoteLifecycleState.AUTH_REQUIRED ->
        RemoteActionableState("登录已过期", "重新登录后可继续使用原有设备授权。",
            RemoteRecoveryAction.SIGN_IN, "重新登录")
    lifecycle == RemoteLifecycleState.REVOKED ->
        RemoteActionableState("此设备已解除关联", "请在电脑端生成新的二维码。",
            RemoteRecoveryAction.REASSOCIATE, "重新扫码")
    lifecycle == RemoteLifecycleState.INCOMPATIBLE ->
        RemoteActionableState("版本不兼容", "请先更新 OpenDrSai Android。",
            RemoteRecoveryAction.UPDATE_APP, "检查更新")
    else -> null
}

fun safeRemoteFailureMessage(failure: Throwable): String = when {
    failure is RelayHttpException && failure.status == 401 -> "登录已过期"
    failure is RelayHttpException && failure.status == 403 -> "此设备已无权访问"
    failure is RelayHttpException && failure.errorCode == "runtime_paused" -> "此电脑已暂停"
    failure is RelayHttpException && failure.errorCode == "protocol_incompatible" -> "版本不兼容"
    failure is java.net.SocketTimeoutException -> "连接超时"
    failure is java.io.IOException -> "网络连接失败"
    else -> "远程操作失败"
}

fun safeRemoteFailureMessage(failure: OwopResult.Failure): String = when (failure.code) {
    "auth_required", "invalid_token" -> "登录已过期"
    "permission_denied", "association_required", "insufficient_scope" -> "此设备已无权访问"
    "runtime_paused" -> "此电脑已暂停"
    "runtime_offline", "runtime_owner_unavailable" -> "远程电脑离线"
    "timeout", "gateway_timeout" -> "连接超时"
    else -> if (failure.retryable) "远程操作暂时不可用" else "远程操作失败"
}

fun remoteRecoveryAction(code: String?, retryable: Boolean = false, status: Int? = null): RemoteRecoveryAction {
    val normalizedCode = code ?: when (status) {
        401 -> "invalid_token"
        403 -> "association_required"
        else -> null
    }
    val transient = retryable || status == 408 || status == 429 || (status ?: 0) >= 500
    return when (RelayContractGenerated.errorAction(normalizedCode, transient)) {
        "retry" -> RemoteRecoveryAction.RETRY
        "login" -> RemoteRecoveryAction.SIGN_IN
        "re-pair" -> RemoteRecoveryAction.REASSOCIATE
        "update" -> RemoteRecoveryAction.UPDATE_APP
        else -> RemoteRecoveryAction.CONTACT_ADMIN
    }
}

/** A single safe CTA derived from the generated cross-client error contract. */
fun remoteActionableFailure(failure: Throwable): RemoteActionableState {
    val action = when (failure) {
        is RelayHttpException -> remoteRecoveryAction(failure.errorCode, failure.retryable, failure.status)
        is java.io.IOException -> RemoteRecoveryAction.RETRY
        else -> RemoteRecoveryAction.CONTACT_ADMIN
    }
    return remoteActionableFailure(action)
}

fun remoteActionableFailure(failure: OwopResult.Failure): RemoteActionableState =
    remoteActionableFailure(remoteRecoveryAction(failure.code, failure.retryable))

private fun remoteActionableFailure(action: RemoteRecoveryAction): RemoteActionableState = when (action) {
    RemoteRecoveryAction.RETRY -> RemoteActionableState(
        "暂时无法连接", "请检查网络后重试；已同步的内容仍可查看。", action, "重试",
    )
    RemoteRecoveryAction.SIGN_IN -> RemoteActionableState(
        "登录已过期", "重新登录后可继续使用原有设备授权。", action, "重新登录",
    )
    RemoteRecoveryAction.REASSOCIATE -> RemoteActionableState(
        "需要重新连接电脑", "请在电脑端生成新的二维码。", action, "重新扫码",
    )
    RemoteRecoveryAction.UPDATE_APP -> RemoteActionableState(
        "版本不兼容", "请先更新 OpenDrSai，再重新连接。", action, "检查更新",
    )
    RemoteRecoveryAction.CONTACT_ADMIN -> RemoteActionableState(
        "暂时无法完成操作", "重试仍失败时，请联系管理员并提供关联编号。", action, "联系管理员",
    )
    else -> error("remote_error_action_invalid")
}
