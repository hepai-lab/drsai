package ai.drsai.remote.data

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.annotation.SuppressLint
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ai.drsai.remote.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

@SuppressLint("StaticFieldLeak")
class AndroidUpdateManager private constructor(private val context: Context) {
    private val repository = AndroidUpdateRepository(
        context = context,
        manifestUrl = BuildConfig.ANDROID_UPDATE_MANIFEST_URL,
        channel = BuildConfig.ANDROID_UPDATE_CHANNEL,
    )
    private val mutableState = MutableStateFlow<AndroidUpdateState>(AndroidUpdateState.Idle)
    val state: StateFlow<AndroidUpdateState> = mutableState.asStateFlow()

    init {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java)
                ?.createNotificationChannel(NotificationChannel("updates", "应用更新", NotificationManager.IMPORTANCE_LOW))
        }
        restorePrepared()
    }

    suspend fun check(): AndroidUpdateState {
        mutableState.value = AndroidUpdateState.Checking
        val result = repository.check()
        mutableState.value = result
        return result
    }

    suspend fun download(update: AndroidApkUpdate): AndroidUpdateState {
        val result = repository.download(update) { progress ->
            mutableState.value = AndroidUpdateState.Downloading(update, progress)
            notifyProgress(update, progress)
        }
        mutableState.value = result
        if (result is AndroidUpdateState.Ready) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(PENDING_MANIFEST, encode(result.update)).apply()
            notifyReady(result.update)
        }
        return result
    }

    fun install(context: Context, ready: AndroidUpdateState.Ready) {
        context.startActivity(ApkVerifier(context).installIntent(ready.apk))
    }

    fun schedule() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<AndroidUpdateWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "opendrsai-android-update", ExistingPeriodicWorkPolicy.KEEP, request,
        )
    }

    @SuppressLint("MissingPermission")
    private fun notifyProgress(update: AndroidApkUpdate, progress: Int) {
        val notification = NotificationCompat.Builder(context, "updates")
            .setSmallIcon(ai.drsai.remote.R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenDrSai 更新")
            .setContentText("正在下载 ${update.version}")
            .setProgress(100, progress, false).setOngoing(true).build()
        runCatching { androidx.core.app.NotificationManagerCompat.from(context).notify(UPDATE_NOTIFICATION_ID, notification) }
    }

    @SuppressLint("MissingPermission")
    private fun notifyReady(update: AndroidApkUpdate) {
        val notification = NotificationCompat.Builder(context, "updates")
            .setSmallIcon(ai.drsai.remote.R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenDrSai 更新已准备好")
            .setContentText("${update.version} 已下载，打开应用完成安装")
            .setAutoCancel(true).build()
        runCatching { androidx.core.app.NotificationManagerCompat.from(context).notify(UPDATE_NOTIFICATION_ID, notification) }
    }

    private fun restorePrepared() {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PENDING_MANIFEST, null) ?: return
        runCatching {
            val update = AndroidUpdatePolicy.parseManifest(raw)
            val file = File(context.cacheDir, "updates/${update.version}.apk")
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            val currentCode = if (android.os.Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode else @Suppress("DEPRECATION") packageInfo.versionCode.toLong()
            if (currentCode >= update.versionCode) {
                file.delete()
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PENDING_MANIFEST).apply()
            } else if (file.isFile && file.length() == update.sizeBytes) {
                mutableState.value = AndroidUpdateState.Ready(update, file)
            }
        }.onFailure {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PENDING_MANIFEST).apply()
        }
    }

    private fun encode(update: AndroidApkUpdate): String = JSONObject().apply {
        put("schemaVersion", update.schemaVersion); put("platform", update.platform); put("channel", update.channel)
        put("version", update.version); put("versionCode", update.versionCode); put("publishedAt", update.publishedAt)
        put("minimumSupportedVersion", update.minimumSupportedVersion); put("mandatory", update.mandatory)
        put("apk", JSONObject().apply {
            put("url", update.apkUrl); put("sizeBytes", update.sizeBytes); put("sha256", update.sha256)
            put("signingCertSha256", update.signingCertSha256)
        })
        update.releaseNotesUrl?.let { put("releaseNotesUrl", it) }
    }.toString()

    companion object {
        private const val PREFS = "android_update"
        private const val PENDING_MANIFEST = "pending_manifest"
        private const val UPDATE_NOTIFICATION_ID = 4107
        @Volatile private var instance: AndroidUpdateManager? = null
        fun get(context: Context): AndroidUpdateManager = instance ?: synchronized(this) {
            instance ?: AndroidUpdateManager(context.applicationContext).also { instance = it }
        }
    }
}

class AndroidUpdateWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = when (AndroidUpdateManager.get(applicationContext).check()) {
        is AndroidUpdateState.Failed -> if (runAttemptCount < 3) Result.retry() else Result.failure()
        else -> Result.success()
    }
}

class AndroidUpdateLifecycleObserver(private val application: Application) : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) {
        AndroidUpdateManager.get(application).schedule()
    }
}

fun installAndroidUpdateLifecycle(application: Application) {
    ProcessLifecycleOwner.get().lifecycle.addObserver(AndroidUpdateLifecycleObserver(application))
}
