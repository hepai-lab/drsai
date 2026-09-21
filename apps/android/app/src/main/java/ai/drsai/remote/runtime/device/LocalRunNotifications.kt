package ai.drsai.remote.runtime.device

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.WorkManager
import ai.drsai.remote.MainActivity
import ai.drsai.remote.R
import ai.drsai.remote.runtime.reliability.RunRecoveryScheduler
import ai.drsai.remote.workbench.model.WorkbenchId

const val ACTION_STOP_LOCAL_RUN = "ai.drsai.remote.action.STOP_LOCAL_RUN"
const val ACTION_CONTINUE_LOCAL_RUN = "ai.drsai.remote.action.CONTINUE_LOCAL_RUN"
const val ACTION_OPEN_OAEP_RUN = "ai.drsai.remote.action.OPEN_OAEP_RUN"
const val ACTION_OPEN_RUN_APPROVAL = "ai.drsai.remote.action.OPEN_RUN_APPROVAL"
const val ACTION_OPEN_RUN_RESULT = "ai.drsai.remote.action.OPEN_RUN_RESULT"
const val EXTRA_RUN_ID = "run_id"
const val EXTRA_SESSION_ID = "session_id"
const val EXTRA_INTERACTION_ID = "interaction_id"
const val EXTRA_ACCOUNT_SUBJECT = "account_subject"
private const val EXTRA_STATUS = "status"
private const val ACTION_SHOW_LOCAL_RUN = "ai.drsai.remote.action.SHOW_LOCAL_RUN"
private const val ACTION_DISMISS_LOCAL_RUN = "ai.drsai.remote.action.DISMISS_LOCAL_RUN"
private const val CHANNEL_ID = "agent-runs"

internal fun ensureLocalRunNotificationChannel(context: Context) {
    context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, context.getString(R.string.local_run_channel_name), NotificationManager.IMPORTANCE_LOW),
    )
}

internal fun oaepRunOpenIntent(
    context: Context,
    runId: String,
    sessionId: String,
    subject: String,
    interactionId: String? = null,
    action: String = ACTION_OPEN_OAEP_RUN,
): Intent {
    require(subject.isNotBlank() && runId.isNotBlank() && sessionId.isNotBlank()) { "oaep_notification_scope_required" }
    require(action in setOf(ACTION_OPEN_OAEP_RUN, ACTION_OPEN_RUN_APPROVAL, ACTION_OPEN_RUN_RESULT, ai.drsai.remote.runtime.reliability.ACTION_OPEN_RECOVERABLE_RUN)) {
        "oaep_notification_action_invalid"
    }
    return Intent(context, MainActivity::class.java)
        .setAction(action)
        .putExtra(EXTRA_ACCOUNT_SUBJECT, subject)
        .putExtra(EXTRA_RUN_ID, runId)
        .putExtra(EXTRA_SESSION_ID, sessionId)
        .putExtra(EXTRA_INTERACTION_ID, interactionId)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
}

internal fun localRunActionIntent(context: Context, action: String, subject: String, runId: String, sessionId: String): Intent {
    require(action in setOf(ACTION_CONTINUE_LOCAL_RUN, ACTION_STOP_LOCAL_RUN)) { "local_run_action_invalid" }
    require(subject.isNotBlank() && runId.isNotBlank() && sessionId.isNotBlank()) { "local_run_action_scope_required" }
    return Intent(context, MainActivity::class.java).setAction(action)
        .putExtra(EXTRA_ACCOUNT_SUBJECT, subject).putExtra(EXTRA_RUN_ID, runId).putExtra(EXTRA_SESSION_ID, sessionId)
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
}

internal fun localRunNotification(context: Context, subject: String, runId: String, sessionId: String, status: String) =
    NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle(context.getString(R.string.local_run_notification_title))
        .setContentText(status)
        .setOnlyAlertOnce(true)
        .setOngoing(true)
        .setProgress(0, 0, true)
        .setContentIntent(PendingIntent.getActivity(
            context, LocalRunNotificationController.stableNotificationId(runId) xor 0x01000000,
            oaepRunOpenIntent(context, runId, sessionId, subject),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ))
        .addAction(0, context.getString(R.string.continue_action), PendingIntent.getActivity(
            context, LocalRunNotificationController.stableNotificationId(runId) xor 0x02000000,
            localRunActionIntent(context, ACTION_CONTINUE_LOCAL_RUN, subject, runId, sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ))
        .addAction(0, context.getString(R.string.cancel), PendingIntent.getActivity(
            context, LocalRunNotificationController.stableNotificationId(runId),
            localRunActionIntent(context, ACTION_STOP_LOCAL_RUN, subject, runId, sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ))
        .build()

class LocalRunForegroundService : Service() {
    private var activeRunId: String? = null
    private var activeSubject: String? = null
    private var activeSessionId: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureLocalRunNotificationChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val runId = intent?.getStringExtra(EXTRA_RUN_ID)
        val sessionId = intent?.getStringExtra(EXTRA_SESSION_ID)
        val subject = intent?.getStringExtra(EXTRA_ACCOUNT_SUBJECT)
        if (intent?.action == ACTION_DISMISS_LOCAL_RUN || runId.isNullOrBlank()) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (sessionId.isNullOrBlank() || subject.isNullOrBlank()) return START_NOT_STICKY
        activeRunId = runId
        activeSubject = subject
        activeSessionId = sessionId
        if (flags and START_FLAG_REDELIVERY != 0) {
            transitionToRecoverable(subject, runId, sessionId, startId)
            return START_NOT_STICKY
        }
        val power = getSystemService(PowerManager::class.java)
        val activityManager = getSystemService(ActivityManager::class.java)
        val backgroundRestricted = activityManager?.isBackgroundRestricted == true
        val importance = ActivityManager.RunningAppProcessInfo().also(ActivityManager::getMyMemoryState).importance
        val appForeground = importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        val backgroundDecision = ai.drsai.remote.runtime.reliability.BackgroundExecutionPolicy.decide(
            ai.drsai.remote.runtime.reliability.BackgroundExecutionConditions(
                appForeground = appForeground,
                foregroundServiceActive = true,
                doze = power?.isDeviceIdleMode == true,
                batterySaver = power?.isPowerSaveMode == true,
                backgroundRestricted = backgroundRestricted,
                foregroundServiceTimedOut = false,
            ),
        )
        if (backgroundDecision.action != ai.drsai.remote.runtime.reliability.BackgroundExecutionAction.CONTINUE_FOREGROUND) {
            transitionToRecoverable(subject, runId, sessionId, startId)
            return START_NOT_STICKY
        }
        val status = intent.getStringExtra(EXTRA_STATUS).orEmpty().ifBlank { getString(R.string.thinking) }
        startForeground(LocalRunNotificationController.stableNotificationId(runId), localRunNotification(this, subject, runId, sessionId, status))
        return START_REDELIVER_INTENT
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val subject = activeSubject
        val runId = activeRunId
        if (!subject.isNullOrBlank() && !runId.isNullOrBlank()) scheduleRecovery(subject, runId)
        super.onTaskRemoved(rootIntent)
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        val subject = activeSubject
        val runId = activeRunId
        val sessionId = activeSessionId
        if (!subject.isNullOrBlank() && !runId.isNullOrBlank() && !sessionId.isNullOrBlank()) {
            transitionToRecoverable(subject, runId, sessionId, startId)
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf(startId)
        }
    }

    private fun transitionToRecoverable(subject: String, runId: String, sessionId: String, startId: Int) {
        startForeground(
            LocalRunNotificationController.stableNotificationId(runId),
            localRunNotification(this, subject, runId, sessionId, getString(R.string.local_run_paused_recoverable)),
        )
        scheduleRecovery(subject, runId)
        stopForeground(STOP_FOREGROUND_DETACH)
        stopSelf(startId)
    }

    private fun scheduleRecovery(subject: String, runId: String) {
        RunRecoveryScheduler(WorkManager.getInstance(applicationContext)).schedule(subject, WorkbenchId(runId))
    }
}

class LocalRunNotificationController(private val context: Context) {
    private val active = mutableSetOf<String>()
    init {
        ensureLocalRunNotificationChannel(context)
    }

    fun show(subject: String, runId: String, sessionId: String, status: String) {
        require(subject.isNotBlank()) { "local_run_subject_required" }
        active += runId
        val intent = Intent(context, LocalRunForegroundService::class.java)
            .setAction(ACTION_SHOW_LOCAL_RUN)
            .putExtra(EXTRA_RUN_ID, runId).putExtra(EXTRA_SESSION_ID, sessionId)
            .putExtra(EXTRA_ACCOUNT_SUBJECT, subject).putExtra(EXTRA_STATUS, status)
        runCatching { ContextCompat.startForegroundService(context, intent) }
    }

    fun show(subject: String, snapshot: ai.drsai.remote.runtime.reliability.LongTaskSnapshot) =
        show(subject, snapshot.runId, snapshot.sessionId, snapshot.stepLabel)

    fun dismiss(runId: String) {
        active -= runId
        context.startService(Intent(context, LocalRunForegroundService::class.java)
            .setAction(ACTION_DISMISS_LOCAL_RUN).putExtra(EXTRA_RUN_ID, runId))
    }

    fun isActive(runId: String): Boolean = runId in active

    companion object {
        internal fun stableNotificationId(runId: String): Int = 0x52000000 or (runId.hashCode() and 0x00ffffff)
    }
}
