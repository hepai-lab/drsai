package ai.drsai.remote.remote.device

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import ai.drsai.remote.ExternalEntryActivity
import ai.drsai.remote.R
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId

const val ACTION_REMOTE_WORKSPACE_NOTIFICATION = "ai.drsai.remote.action.REMOTE_WORKSPACE_NOTIFICATION"
private const val REMOTE_NOTIFICATION_CHANNEL = "remote-workspace-events"

data class RemoteNotificationPayload(
    val kind: String,
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
    val sessionId: SessionId,
    val eventId: String,
    val itemId: String?,
) {
    init {
        require(kind in KINDS) { "remote_notification_kind_invalid" }
        require(OPAQUE_ID.matches(eventId) && eventId != "." && eventId != "..") {
            "remote_notification_event_id_invalid"
        }
        require(itemId == null || OPAQUE_ID.matches(itemId) && itemId != "." && itemId != "..") {
            "remote_notification_item_id_invalid"
        }
    }

    companion object {
        val KINDS = setOf("run_completed", "run_failed", "run_cancelled", "approval_required")
        private val OPAQUE_ID = Regex("^[A-Za-z0-9_.:-]{1,200}$")
        private val REQUIRED_KEYS = setOf(
            "version", "kind", "runtime_id", "workspace_id", "session_id", "event_id",
        )
        private val ALLOWED_KEYS = REQUIRED_KEYS + "item_id"

        fun from(intent: Intent): RemoteNotificationPayload {
            require(intent.action == ACTION_REMOTE_WORKSPACE_NOTIFICATION) { "remote_notification_action_invalid" }
            require(intent.getStringExtra("version") == "1") { "remote_notification_version_invalid" }
            return from(listOf("kind", "runtime_id", "workspace_id", "session_id", "event_id", "item_id")
                .associateWith { intent.getStringExtra(it).orEmpty() } + ("version" to "1"))
        }

        fun from(data: Map<String, String>): RemoteNotificationPayload {
            require(data.keys.all { it in ALLOWED_KEYS } && REQUIRED_KEYS.all(data::containsKey)) {
                "remote_notification_envelope_invalid"
            }
            require(data["version"] == "1") { "remote_notification_version_invalid" }
            return RemoteNotificationPayload(
                kind = requireNotNull(data["kind"]),
                runtimeId = RuntimeId(requireNotNull(data["runtime_id"])),
                workspaceId = WorkspaceId(requireNotNull(data["workspace_id"])),
                sessionId = SessionId(requireNotNull(data["session_id"])),
                eventId = requireNotNull(data["event_id"]),
                itemId = data["item_id"]?.takeIf(String::isNotBlank),
            )
        }
    }
}

internal fun remoteNotificationOpenIntent(context: Context, payload: RemoteNotificationPayload): Intent {
    val uri = Uri.Builder().scheme("opendrsai").authority("session")
        .appendPath(payload.runtimeId.value)
        .appendPath(payload.workspaceId.value)
        .appendPath(payload.sessionId.value)
        .appendQueryParameter("event_id", payload.eventId)
        .apply { payload.itemId?.let { appendQueryParameter("item_id", it) } }
        .build()
    return Intent(context, ExternalEntryActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .setData(uri)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}

class RemoteWorkspaceNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val payload = runCatching { RemoteNotificationPayload.from(intent) }.getOrNull() ?: return
        showRemoteWorkspaceNotification(context, payload)
    }
}

internal fun showRemoteWorkspaceNotification(context: Context, payload: RemoteNotificationPayload) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(
            REMOTE_NOTIFICATION_CHANNEL, "远程工作区任务", NotificationManager.IMPORTANCE_DEFAULT,
        ))
        val title = when (payload.kind) {
            "approval_required" -> "任务需要处理"
            "run_completed" -> "任务已完成"
            "run_failed" -> "任务需要查看"
            else -> "任务已停止"
        }
        val open = PendingIntent.getActivity(
            context,
            payload.eventId.hashCode(),
            remoteNotificationOpenIntent(context, payload),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, REMOTE_NOTIFICATION_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText("打开 OpenDrSai 查看详情")
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        runCatching {
            NotificationManagerCompat.from(context).notify(payload.eventId.hashCode(), notification)
        }
}
