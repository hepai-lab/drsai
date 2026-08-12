package ai.drsai.remote.remote.ui

enum class RemoteDiagnosticCheck { OK, FAILED, UNKNOWN }

enum class RemoteDiagnosticAction {
    NONE, START_COMPUTER, RETRY_CONNECTION, SIGN_IN, REPAIR_DEVICE, UPDATE, ENABLE_NOTIFICATIONS,
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
    val title: String,
    val reason: String,
    val action: RemoteDiagnosticAction,
    val actionLabel: String?,
    val checks: RemoteConnectionDiagnosticInput,
)

/** Chooses exactly one repair at the earliest failed user boundary. UNKNOWN is informational. */
fun diagnoseRemoteConnection(checks: RemoteConnectionDiagnosticInput): RemoteConnectionDiagnostic {
    val result = when {
        checks.computer == RemoteDiagnosticCheck.FAILED -> Triple(
            "电脑未连接", "请确认电脑已开机并打开 OpenDrSai。", RemoteDiagnosticAction.START_COMPUTER,
        )
        checks.account == RemoteDiagnosticCheck.FAILED -> Triple(
            "需要重新登录", "当前登录已失效。", RemoteDiagnosticAction.SIGN_IN,
        )
        checks.deviceIdentity == RemoteDiagnosticCheck.FAILED -> Triple(
            "设备连接已失效", "请重新扫描电脑上的二维码。", RemoteDiagnosticAction.REPAIR_DEVICE,
        )
        checks.platform == RemoteDiagnosticCheck.FAILED -> Triple(
            "网络连接异常", "暂时无法连接远程服务。", RemoteDiagnosticAction.RETRY_CONNECTION,
        )
        checks.protocol == RemoteDiagnosticCheck.FAILED -> Triple(
            "版本需要更新", "手机与电脑版本不兼容。", RemoteDiagnosticAction.UPDATE,
        )
        checks.notifications == RemoteDiagnosticCheck.FAILED -> Triple(
            "后台通知未启用", "打开通知后，离开应用也能收到进度提醒。", RemoteDiagnosticAction.ENABLE_NOTIFICATIONS,
        )
        else -> Triple("连接正常", "远程工作区的关键连接均可用。", RemoteDiagnosticAction.NONE)
    }
    val label = when (result.third) {
        RemoteDiagnosticAction.NONE -> null
        RemoteDiagnosticAction.START_COMPUTER -> "检查电脑"
        RemoteDiagnosticAction.RETRY_CONNECTION -> "重试"
        RemoteDiagnosticAction.SIGN_IN -> "重新登录"
        RemoteDiagnosticAction.REPAIR_DEVICE -> "重新扫码"
        RemoteDiagnosticAction.UPDATE -> "检查更新"
        RemoteDiagnosticAction.ENABLE_NOTIFICATIONS -> "启用通知"
    }
    return RemoteConnectionDiagnostic(result.first, result.second, result.third, label, checks)
}
