package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.model.RemoteConnectionState

/** User-facing host state. Transport and identity implementation details never enter this model. */
data class RemoteHostStatusPresentation(
    val title: String,
    val reason: String,
    val action: RemoteRecoveryAction = RemoteRecoveryAction.NONE,
    val actionLabel: String? = null,
    val language: RemoteUiLanguage = RemoteUiLanguage.ZH,
) {
    val accessibilityDescription: String = buildString {
        append(if (language == RemoteUiLanguage.ZH) "电脑状态：" else "Computer status: ")
        append(title)
        append(if (language == RemoteUiLanguage.ZH) "。" else ". ")
        append(reason.trimEnd('。', '.'))
        if (actionLabel == null) append(if (language == RemoteUiLanguage.ZH) "。" else ".") else {
            append(if (language == RemoteUiLanguage.ZH) "。可执行：" else ". Action: ")
            append(actionLabel)
        }
    }
}

fun remoteHostStatusPresentation(
    state: RemoteConnectionState,
    lastSeenLabel: String = "",
    language: RemoteUiLanguage = RemoteUiLanguage.ZH,
): RemoteHostStatusPresentation = when (language) {
    RemoteUiLanguage.ZH -> remoteHostStatusPresentationZh(state, lastSeenLabel)
    RemoteUiLanguage.EN -> remoteHostStatusPresentationEn(state, lastSeenLabel)
}

private fun remoteHostStatusPresentationZh(
    state: RemoteConnectionState,
    lastSeenLabel: String,
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

private fun remoteHostStatusPresentationEn(
    state: RemoteConnectionState,
    lastSeenLabel: String,
): RemoteHostStatusPresentation = when (state) {
    RemoteConnectionState.ONLINE -> RemoteHostStatusPresentation(
        "Online", "This computer is available. Workspaces and sessions stay in sync.", language = RemoteUiLanguage.EN,
    )
    RemoteConnectionState.CONNECTING -> RemoteHostStatusPresentation(
        "Connecting", "Checking whether this computer is available.", language = RemoteUiLanguage.EN,
    )
    RemoteConnectionState.DEGRADED -> RemoteHostStatusPresentation(
        "Unstable connection", "Showing the last synced content. It will update automatically after reconnecting.",
        RemoteRecoveryAction.RETRY, "Retry", RemoteUiLanguage.EN,
    )
    RemoteConnectionState.OFFLINE -> RemoteHostStatusPresentation(
        "Offline",
        lastSeenLabel.takeIf(String::isNotBlank)?.let { "This computer is unavailable; $it." }
            ?: "This computer is unavailable. Make sure it is on and connected.",
        RemoteRecoveryAction.RETRY, "Retry", RemoteUiLanguage.EN,
    )
    RemoteConnectionState.PAUSED -> RemoteHostStatusPresentation(
        "Paused", "Mobile access is paused on the computer. Existing authorization is preserved.",
        RemoteRecoveryAction.RESUME_ON_COMPUTER, "Retry after resuming", RemoteUiLanguage.EN,
    )
    RemoteConnectionState.AUTH_REQUIRED -> RemoteHostStatusPresentation(
        "Sign-in required", "Your sign-in expired. Sign in again to keep using the existing authorization.",
        RemoteRecoveryAction.SIGN_IN, "Sign in", RemoteUiLanguage.EN,
    )
    RemoteConnectionState.INCOMPATIBLE -> RemoteHostStatusPresentation(
        "Update required", "The phone and computer versions are incompatible.",
        RemoteRecoveryAction.UPDATE_APP, "Check for updates", RemoteUiLanguage.EN,
    )
}

fun remoteNotificationPresentation(
    state: RemoteNotificationReadiness,
    language: RemoteUiLanguage = RemoteUiLanguage.ZH,
): RemoteHostStatusPresentation? = if (language == RemoteUiLanguage.ZH) when (state) {
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
} else when (state) {
    RemoteNotificationReadiness.READY -> null
    RemoteNotificationReadiness.CHECKING -> RemoteHostStatusPresentation(
        "Checking background notifications", "Checking notification services. Opening the app still syncs the latest progress.",
        language = RemoteUiLanguage.EN,
    )
    RemoteNotificationReadiness.PERMISSION_REQUIRED -> RemoteHostStatusPresentation(
        "Notifications are off", "Allow notifications to receive task results and approval reminders while the app is closed.",
        actionLabel = "Enable notifications", language = RemoteUiLanguage.EN,
    )
    RemoteNotificationReadiness.PROVIDER_NOT_CONFIGURED -> RemoteHostStatusPresentation(
        "Background notifications unavailable", "This build has no background notification provider. Opening the app syncs the latest progress.",
        language = RemoteUiLanguage.EN,
    )
    RemoteNotificationReadiness.PLAY_SERVICES_UNAVAILABLE -> RemoteHostStatusPresentation(
        "Background notifications unavailable", "This device lacks the notification service. Opening the app syncs the latest progress.",
        language = RemoteUiLanguage.EN,
    )
    RemoteNotificationReadiness.PLATFORM_UNAVAILABLE -> RemoteHostStatusPresentation(
        "Background notifications temporarily unavailable", "The notification service is not ready. Opening the app syncs the latest progress.",
        language = RemoteUiLanguage.EN,
    )
}
