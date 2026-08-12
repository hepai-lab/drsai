package ai.drsai.remote.remote.device

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.RemoteWorkspaceContainer
import ai.drsai.remote.remote.data.SharedPreferencesWorkspaceRecencyStore
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class RemoteBackgroundPolicy(
    val keepForegroundSse: Boolean,
    val relyOnPush: Boolean,
    val scheduleFallbackPull: Boolean,
)

fun remoteBackgroundPolicy(
    foreground: Boolean,
    online: Boolean,
    pushReady: Boolean,
): RemoteBackgroundPolicy = RemoteBackgroundPolicy(
    keepForegroundSse = foreground && online,
    relyOnPush = !foreground && pushReady,
    scheduleFallbackPull = !foreground && !pushReady,
)

interface RemoteBackgroundWorkController {
    fun scheduleUniqueFallback()
    fun cancelFallback()
}

class RemoteBackgroundSyncCoordinator(
    private val work: RemoteBackgroundWorkController,
) {
    private var fallbackScheduled: Boolean? = null

    @Synchronized
    fun reconcile(foreground: Boolean, online: Boolean, pushReady: Boolean): RemoteBackgroundPolicy =
        remoteBackgroundPolicy(foreground, online, pushReady).also { policy ->
            if (fallbackScheduled == policy.scheduleFallbackPull) return@also
            fallbackScheduled = policy.scheduleFallbackPull
            if (policy.scheduleFallbackPull) work.scheduleUniqueFallback() else work.cancelFallback()
        }
}

class AndroidRemoteBackgroundWorkController(context: Context) : RemoteBackgroundWorkController {
    private val appContext = context.applicationContext

    override fun scheduleUniqueFallback() {
        val request = PeriodicWorkRequestBuilder<RemoteFallbackDirectorySyncWorker>(
            FALLBACK_INTERVAL_MINUTES, TimeUnit.MINUTES,
            FALLBACK_FLEX_MINUTES, TimeUnit.MINUTES,
        ).setConstraints(
            Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true)
                .build()
        ).setBackoffCriteria(
            BackoffPolicy.EXPONENTIAL, MIN_BACKOFF_SECONDS, TimeUnit.SECONDS,
        ).build()
        WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
            UNIQUE_FALLBACK_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    override fun cancelFallback() {
        WorkManager.getInstance(appContext).cancelUniqueWork(UNIQUE_FALLBACK_WORK)
    }

    companion object {
        const val UNIQUE_FALLBACK_WORK = "remote-background-catch-up-v1"
        const val FALLBACK_INTERVAL_MINUTES = 15L
        const val FALLBACK_FLEX_MINUTES = 5L
        const val MIN_BACKOFF_SECONDS = 30L
    }
}

/** Process-wide owner: it exists even when a notification opens a Session directly. */
object AndroidRemoteBackgroundSync {
    private val installed = AtomicBoolean(false)
    @Volatile private var lifecycle: BackgroundLifecycle? = null

    fun install(application: Application) {
        if (!installed.compareAndSet(false, true)) return
        BackgroundLifecycle(application).also { owner ->
            lifecycle = owner
            ProcessLifecycleOwner.get().lifecycle.addObserver(owner)
            owner.reconcile()
        }
    }

    fun updatePushReady(ready: Boolean) {
        lifecycle?.updatePushReady(ready)
    }

    private class BackgroundLifecycle(application: Application) : DefaultLifecycleObserver {
        private val coordinator = RemoteBackgroundSyncCoordinator(
            AndroidRemoteBackgroundWorkController(application),
        )
        @Volatile private var foreground = ProcessLifecycleOwner.get().lifecycle.currentState
            .isAtLeast(Lifecycle.State.STARTED)
        @Volatile private var pushReady = false

        override fun onStart(owner: LifecycleOwner) {
            foreground = true
            reconcile()
        }

        override fun onStop(owner: LifecycleOwner) {
            foreground = false
            reconcile()
        }

        fun updatePushReady(ready: Boolean) {
            pushReady = ready
            reconcile()
        }

        fun reconcile() {
            // WorkManager owns network constraints. Scheduling while offline is
            // intentional: the OS will run the unique job only after connectivity returns.
            coordinator.reconcile(foreground, online = true, pushReady = pushReady)
        }
    }
}

class RemoteFallbackDirectorySyncWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result {
        return try {
            val app = applicationContext as Application
            val container = RemoteWorkspaceContainer.get(app)
            val user = container.boundaries.auth.tokens.user() ?: return Result.success()
            if (endToEndPushReady(container)) return Result.success()
            RemoteDirectoryLoader(
                container.boundaries.catalog.discovery,
                SharedPreferencesWorkspaceRecencyStore(app),
                container.directoryCache,
            ).synchronize(user.id)
            Result.success()
        } catch (failure: RelayHttpException) {
            if (failure.status == 401 || failure.status == 403) Result.success() else retryOrFail()
        } catch (_: IOException) {
            retryOrFail()
        } catch (_: Throwable) {
            Result.failure()
        }
    }

    private suspend fun endToEndPushReady(container: RemoteWorkspaceContainer): Boolean {
        if (RemotePushProvider.initialize(applicationContext) != RemotePushProviderStatus.READY) return false
        val notificationsEnabled = NotificationManagerCompat.from(applicationContext).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                applicationContext, Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED)
        return notificationsEnabled && container.boundaries.push.readiness.pushReadiness().ready
    }

    private fun retryOrFail(): Result =
        if (runAttemptCount + 1 >= MAX_ATTEMPTS) Result.failure() else Result.retry()

    private companion object {
        const val MAX_ATTEMPTS = 3
    }
}
