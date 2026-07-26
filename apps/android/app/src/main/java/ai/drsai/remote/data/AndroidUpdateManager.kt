package ai.drsai.remote.data

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.BackoffPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@SuppressLint("StaticFieldLeak")
class AndroidUpdateManager private constructor(private val context: Context) {
    private val store = AndroidUpdateStore(context)
    private val cancelDownloadRequested = AtomicBoolean(false)
    private val repository = AndroidUpdateRepository(
        context = context,
        manifestUrl = BuildConfig.ANDROID_UPDATE_MANIFEST_URL,
        fallbackManifestUrl = BuildConfig.ANDROID_UPDATE_FALLBACK_MANIFEST_URL,
        channel = BuildConfig.ANDROID_UPDATE_CHANNEL,
        allowInsecureLocal = BuildConfig.ANDROID_UPDATE_ALLOW_INSECURE_LOCAL,
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

    suspend fun check(background: Boolean = false): AndroidUpdateState {
        if (mutableState.value is AndroidUpdateState.Downloading ||
            mutableState.value is AndroidUpdateState.Verifying ||
            mutableState.value is AndroidUpdateState.Installing
        ) return mutableState.value
        transition(AndroidUpdateState.Checking)
        val result = repository.check()
        store.recordCheck(result)
        transition(result)
        if (background && result is AndroidUpdateState.Available) notifyAvailable(result.update)
        return result
    }

    suspend fun download(update: AndroidApkUpdate): AndroidUpdateState {
        cancelDownloadRequested.set(false)
        transition(AndroidUpdateState.Downloading(update, 0))
        val result = repository.download(
            update = update,
            onProgress = { progress ->
                transition(AndroidUpdateState.Downloading(update, progress))
                notifyProgress(update, progress)
            },
            onVerifying = { candidate ->
                transition(AndroidUpdateState.Verifying(candidate))
            },
            isCancelled = cancelDownloadRequested::get,
        )
        transition(result)
        if (result is AndroidUpdateState.Ready) {
            savePrepared(result)
            notifyReady(result.update)
        }
        return result
    }

    fun cancelDownload() {
        cancelDownloadRequested.set(true)
    }

    fun install(activityContext: Context, ready: AndroidUpdateState.Ready) {
        savePrepared(ready)
        if (AndroidUpdateInstallPolicy.requiresUnknownSourcesPermission(
                Build.VERSION.SDK_INT,
                Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                    activityContext.packageManager.canRequestPackageInstalls(),
            )
        ) {
            transition(AndroidUpdateState.PermissionRequired(ready.update, ready.apk))
            activityContext.startActivity(AndroidUpdateInstallPolicy.permissionIntent(activityContext))
            return
        }
        transition(AndroidUpdateState.Installing(ready.update))
        activityContext.startActivity(ApkVerifier(activityContext).installIntent(ready.apk))
    }

    fun onForeground() {
        schedule()
        val prepared = readPrepared() ?: return
        val currentCode = installedVersionCode()
        if (currentCode >= prepared.update.versionCode) {
            prepared.apk.delete()
            clearPrepared()
            transition(AndroidUpdateState.Installed(
                prepared.update.version,
                prepared.update.versionCode,
            ))
            return
        }
        when (mutableState.value) {
            is AndroidUpdateState.PermissionRequired -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                    context.packageManager.canRequestPackageInstalls()
                ) {
                    install(context, prepared)
                }
            }
            is AndroidUpdateState.Installing -> {
                transition(AndroidUpdateState.Ready(prepared.update, prepared.apk))
            }
            else -> Unit
        }
    }

    fun schedule() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<AndroidUpdateWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
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
    private fun notifyAvailable(update: AndroidApkUpdate) {
        val notification = NotificationCompat.Builder(context, "updates")
            .setSmallIcon(ai.drsai.remote.R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenDrSai ${update.version} 可更新")
            .setContentText("点击打开应用检查并安装")
            .setContentIntent(openAppPendingIntent())
            .setAutoCancel(true)
            .build()
        runCatching {
            androidx.core.app.NotificationManagerCompat.from(context)
                .notify(UPDATE_NOTIFICATION_ID, notification)
        }
    }

    @SuppressLint("MissingPermission")
    private fun notifyReady(update: AndroidApkUpdate) {
        val notification = NotificationCompat.Builder(context, "updates")
            .setSmallIcon(ai.drsai.remote.R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenDrSai 更新已准备好")
            .setContentText("${update.version} 已下载，打开应用完成安装")
            .setContentIntent(openAppPendingIntent())
            .setAutoCancel(true).build()
        runCatching { androidx.core.app.NotificationManagerCompat.from(context).notify(UPDATE_NOTIFICATION_ID, notification) }
    }

    private fun restorePrepared() {
        val prepared = readPrepared() ?: return
        if (installedVersionCode() >= prepared.update.versionCode) {
            prepared.apk.delete()
            clearPrepared()
            transition(AndroidUpdateState.Installed(
                prepared.update.version,
                prepared.update.versionCode,
            ))
        } else {
            transition(AndroidUpdateState.Ready(prepared.update, prepared.apk))
        }
    }

    private fun transition(next: AndroidUpdateState) {
        val current = mutableState.value
        check(AndroidUpdateStateMachine.canTransition(current, next)) {
            "invalid-update-transition:${AndroidUpdateStateMachine.stage(current)}->${AndroidUpdateStateMachine.stage(next)}"
        }
        mutableState.value = next
    }

    private fun savePrepared(ready: AndroidUpdateState.Ready) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(PENDING_MANIFEST, encode(ready.update))
            .putString(PENDING_FILE, ready.apk.absolutePath)
            .apply()
    }

    private fun readPrepared(): AndroidUpdateState.Ready? {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = preferences.getString(PENDING_MANIFEST, null) ?: return null
        val path = preferences.getString(PENDING_FILE, null) ?: return null
        return runCatching {
            val json = JSONObject(raw)
            val source = json.optString("_source")
                .takeIf(String::isNotBlank)
                ?.let(AndroidUpdateSource::valueOf)
                ?: AndroidUpdateSource.CDN
            val update = AndroidUpdatePolicy.parseManifest(
                raw,
                allowInsecureLocal = BuildConfig.ANDROID_UPDATE_ALLOW_INSECURE_LOCAL,
                source = source,
                manifestUrl = json.optString("_manifestUrl").takeIf(String::isNotBlank),
            )
            val file = File(path)
            val allowedRoot = File(context.cacheDir, "updates").canonicalFile
            val canonicalFile = file.canonicalFile
            require(canonicalFile.path.startsWith("${allowedRoot.path}${File.separator}"))
            require(canonicalFile.isFile && canonicalFile.length() == update.sizeBytes)
            require(ApkVerifier(context).verify(canonicalFile, update))
            AndroidUpdateState.Ready(update, canonicalFile)
        }.onFailure {
            clearPrepared()
        }.getOrNull()
    }

    private fun clearPrepared() {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(PENDING_MANIFEST)
            .remove(PENDING_FILE)
            .apply()
    }

    private fun installedVersionCode(): Long {
        val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) packageInfo.longVersionCode
        else @Suppress("DEPRECATION") packageInfo.versionCode.toLong()
    }

    private fun openAppPendingIntent(): PendingIntent = PendingIntent.getActivity(
        context,
        UPDATE_NOTIFICATION_ID,
        Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN_UPDATE)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun encode(update: AndroidApkUpdate): String = JSONObject().apply {
        put("schemaVersion", update.schemaVersion); put("platform", update.platform); put("channel", update.channel)
        put("version", update.version); put("versionCode", update.versionCode); put("publishedAt", update.publishedAt)
        put("minimumSupportedVersion", update.minimumSupportedVersion); put("mandatory", update.mandatory)
        put("_source", update.source.name)
        update.manifestUrl?.let { put("_manifestUrl", it) }
        put("apk", JSONObject().apply {
            put("url", update.apkUrl); put("sizeBytes", update.sizeBytes); put("sha256", update.sha256)
            put("signingCertSha256", update.signingCertSha256)
        })
        update.releaseNotesUrl?.let { put("releaseNotesUrl", it) }
    }.toString()

    companion object {
        private const val PREFS = "android_update"
        private const val PENDING_MANIFEST = "pending_manifest"
        private const val PENDING_FILE = "pending_file"
        private const val UPDATE_NOTIFICATION_ID = 4107
        const val ACTION_OPEN_UPDATE = "ai.drsai.remote.action.OPEN_UPDATE"
        @Volatile private var instance: AndroidUpdateManager? = null
        fun get(context: Context): AndroidUpdateManager = instance ?: synchronized(this) {
            instance ?: AndroidUpdateManager(context.applicationContext).also { instance = it }
        }
    }
}

class AndroidUpdateWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = when (AndroidUpdateManager.get(applicationContext).check(background = true)) {
        is AndroidUpdateState.Failed -> if (runAttemptCount < 3) Result.retry() else Result.failure()
        else -> Result.success()
    }
}

class AndroidUpdateLifecycleObserver(private val application: Application) : DefaultLifecycleObserver {
    override fun onStart(owner: LifecycleOwner) {
        AndroidUpdateManager.get(application).onForeground()
    }
}

fun installAndroidUpdateLifecycle(application: Application) {
    if (lifecycleInstalled) return
    lifecycleInstalled = true
    ProcessLifecycleOwner.get().lifecycle.addObserver(AndroidUpdateLifecycleObserver(application))
}

@Volatile
private var lifecycleInstalled = false
