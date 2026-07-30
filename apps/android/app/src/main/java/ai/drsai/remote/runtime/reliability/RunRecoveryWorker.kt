package ai.drsai.remote.runtime.reliability

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.room.Room
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ai.drsai.remote.MainActivity
import ai.drsai.remote.R
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.workbench.model.WorkbenchId

const val ACTION_OPEN_RECOVERABLE_RUN = "ai.drsai.remote.action.OPEN_RECOVERABLE_RUN"
private const val KEY_RUN_ID = "run_id"
private const val KEY_SUBJECT = "subject"
private const val RECOVERY_CHANNEL = "run-recovery"

class RunRecoveryScheduler(
    private val workManager: WorkManager,
) {
    fun schedule(subject: String, runId: WorkbenchId) {
        require(subject.isNotBlank() && runId.value.isNotBlank())
        val request = OneTimeWorkRequestBuilder<RunRecoveryWorker>()
            .setInputData(Data.Builder().putString(KEY_SUBJECT, subject).putString(KEY_RUN_ID, runId.value).build())
            .setConstraints(Constraints.Builder().setRequiresStorageNotLow(true).build())
            .addTag("opendrsai-run-recovery")
            .build()
        workManager.enqueueUniqueWork(
            BackgroundRunKeys.uniqueWorkName(subject, runId),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun cancel(subject: String, runId: WorkbenchId) =
        workManager.cancelUniqueWork(BackgroundRunKeys.uniqueWorkName(subject, runId))
}

class RunRecoveryWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val subject = inputData.getString(KEY_SUBJECT).orEmpty()
        val runId = inputData.getString(KEY_RUN_ID).orEmpty()
        if (subject.isBlank() || runId.isBlank()) return Result.failure()
        val database = Room.databaseBuilder(applicationContext, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
            .build()
        val run = try {
            database.workbenchDao().runById(runId)
        } finally {
            database.close()
        }
        if (run == null || run.subject != subject || run.status !in RECOVERABLE_STATUSES) return Result.success()
        showRecoveryNotification(runId)
        return Result.success(Data.Builder().putString(KEY_RUN_ID, runId).build())
    }

    private fun showRecoveryNotification(runId: String) {
        applicationContext.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(RECOVERY_CHANNEL, "任务恢复", NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            applicationContext,
            runId.hashCode(),
            Intent(applicationContext, MainActivity::class.java)
                .setAction(ACTION_OPEN_RECOVERABLE_RUN)
                .putExtra(ai.drsai.remote.runtime.device.EXTRA_RUN_ID, runId)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(applicationContext, RECOVERY_CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenDrSai 任务可以恢复")
            .setContentText("点按打开原会话并继续")
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        val allowed = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
            applicationContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (allowed) {
            runCatching { NotificationManagerCompat.from(applicationContext).notify(runId.hashCode(), notification) }
        }
    }

    private companion object {
        val RECOVERABLE_STATUSES = setOf("QUEUED", "RUNNING", "WAITING_APPROVAL", "PAUSED")
    }
}
