package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.model.RemoteConnectionState

/** User-facing host state. Transport and identity implementation details never enter this model. */
data class RemoteHostStatusPresentation(
    val title: String,
    val reason: String,
    val action: RemoteRecoveryAction = RemoteRecoveryAction.NONE,
    val actionLabel: String? = null,
) {
    val accessibilityDescription: String = buildString {
        append("电脑状态：")
        append(title)
        append("。")
        append(reason.trimEnd('。'))
        if (actionLabel == null) append("。") else {
            append("。可执行：")
            append(actionLabel)
        }
    }
}

fun remoteHostStatusPresentation(
    state: RemoteConnectionState,
    lastSeenLabel: String = "",
): RemoteHostStatusPresentation = when (state) {
    RemoteConnectionState.ONLINE -> RemoteHostStatusPresentation(
        title = "在线",
        reason = "电脑可用，工作区与会话会保持同步。",
    )
    RemoteConnectionState.CONNECTING -> RemoteHostStatusPresentation(
        title = "正在连接",
        reason = "正在确认电脑是否可用，请稍候。",
    )
    RemoteConnectionState.DEGRADED -> RemoteHostStatusPresentation(
        title = "连接不稳定",
        reason = "当前显示上次同步的内容，恢复连接后会自动更新。",
        action = RemoteRecoveryAction.RETRY,
        actionLabel = "重试",
    )
    RemoteConnectionState.OFFLINE -> RemoteHostStatusPresentation(
        title = "离线",
        reason = lastSeenLabel.takeIf(String::isNotBlank)?.let { "暂时无法联系电脑；$it。" }
            ?: "暂时无法联系电脑，请确认电脑已开机并联网。",
        action = RemoteRecoveryAction.RETRY,
        actionLabel = "重试",
    )
    RemoteConnectionState.PAUSED -> RemoteHostStatusPresentation(
        title = "已暂停",
        reason = "电脑端暂停了移动访问，现有授权仍保留。",
        action = RemoteRecoveryAction.RESUME_ON_COMPUTER,
        actionLabel = "恢复后重试",
    )
    RemoteConnectionState.AUTH_REQUIRED -> RemoteHostStatusPresentation(
        title = "需要登录",
        reason = "登录已过期，重新登录后可继续使用原有授权。",
        action = RemoteRecoveryAction.SIGN_IN,
        actionLabel = "重新登录",
    )
    RemoteConnectionState.INCOMPATIBLE -> RemoteHostStatusPresentation(
        title = "需要更新",
        reason = "手机或电脑端版本不兼容，更新后才能打开工作区。",
        action = RemoteRecoveryAction.UPDATE_APP,
        actionLabel = "检查更新",
    )
}

fun remoteNotificationPresentation(state: RemoteNotificationReadiness): RemoteHostStatusPresentation? = when (state) {
    RemoteNotificationReadiness.READY -> null
    RemoteNotificationReadiness.CHECKING -> RemoteHostStatusPresentation(
        title = "正在确认后台通知",
        reason = "正在检查通知服务；打开 App 后仍会自动同步最新进度。",
    )
    RemoteNotificationReadiness.PERMISSION_REQUIRED -> RemoteHostStatusPresentation(
        title = "通知未启用",
        reason = "允许系统通知后，应用关闭时也能收到任务结果和审批提醒。",
        action = RemoteRecoveryAction.NONE,
        actionLabel = "启用通知",
    )
    RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED -> RemoteHostStatusPresentation(
        title = "后台通知不可用",
        reason = "此安装包尚未配置后台通知；打开 App 后会自动同步最新进度。",
    )
    RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE -> RemoteHostStatusPresentation(
        title = "后台通知不可用",
        reason = "此设备缺少通知服务；打开 App 后会自动同步最新进度。",
    )
    RemoteNotificationReadiness.PLATFORM_UNAVAILABLE -> RemoteHostStatusPresentation(
        title = "后台通知暂不可用",
        reason = "通知服务尚未就绪；打开 App 后会自动同步最新进度。",
    )
}
