package ai.drsai.remote.runtime.device

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import ai.drsai.remote.MainActivity
import ai.drsai.remote.R

const val ACTION_STOP_LOCAL_RUN = "ai.drsai.remote.action.STOP_LOCAL_RUN"
const val EXTRA_RUN_ID = "run_id"
private const val EXTRA_STATUS = "status"
private const val ACTION_SHOW_LOCAL_RUN = "ai.drsai.remote.action.SHOW_LOCAL_RUN"
private const val ACTION_DISMISS_LOCAL_RUN = "ai.drsai.remote.action.DISMISS_LOCAL_RUN"
private const val CHANNEL_ID = "agent-runs"

internal fun localRunNotification(context: Context, runId: String, status: String) =
    NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle("OpenDrSai 正在运行")
        .setContentText(status)
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .setProgress(0, 0, true)
        .addAction(
            0,
            "停止",
            PendingIntent.getActivity(
                context,
                LocalRunNotificationController.stableNotificationId(runId),
                Intent(context, MainActivity::class.java)
                    .setAction(ACTION_STOP_LOCAL_RUN)
                    .putExtra(EXTRA_RUN_ID, runId)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        .build()

class LocalRunForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val runId = intent?.getStringExtra(EXTRA_RUN_ID)
        if (intent?.action == ACTION_DISMISS_LOCAL_RUN || runId.isNullOrBlank()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val status = intent.getStringExtra(EXTRA_STATUS).orEmpty().ifBlank { "正在思考…" }
        startForeground(LocalRunNotificationController.stableNotificationId(runId), localRunNotification(this, runId, status))
        return START_NOT_STICKY
    }
}

class LocalRunNotificationController(private val context: Context) {
    private val active = mutableSetOf<String>()
    init {
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Agent 任务", NotificationManager.IMPORTANCE_LOW),
        )
    }

    fun show(runId: String, status: String) {
        active += runId
        val intent = Intent(context, LocalRunForegroundService::class.java)
            .setAction(ACTION_SHOW_LOCAL_RUN)
            .putExtra(EXTRA_RUN_ID, runId)
            .putExtra(EXTRA_STATUS, status)
        runCatching { ContextCompat.startForegroundService(context, intent) }
    }

    fun dismiss(runId: String) {
        active -= runId
        context.startService(
            Intent(context, LocalRunForegroundService::class.java)
                .setAction(ACTION_DISMISS_LOCAL_RUN)
                .putExtra(EXTRA_RUN_ID, runId),
        )
    }

    fun isActive(runId: String): Boolean = runId in active

    companion object {
        internal fun stableNotificationId(runId: String): Int = 0x52000000 or (runId.hashCode() and 0x00ffffff)
    }
}
