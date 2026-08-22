package ai.drsai.remote.remote.device

import android.app.Application
import android.content.Context
import androidx.work.Constraints
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.remote.data.ProviderPushToken
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.RemotePushRegistrationCoordinator
import ai.drsai.remote.remote.data.RemoteWorkspaceContainer
import ai.drsai.remote.remote.data.SharedPreferencesPushRegistrationStateStore
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.tasks.await
import java.io.IOException
import java.util.concurrent.TimeUnit

enum class RemotePushProviderStatus {
    READY,
    NOT_CONFIGURED,
    PLAY_SERVICES_UNAVAILABLE,
}

object RemotePushProvider {
    @Synchronized
    fun initialize(context: Context): RemotePushProviderStatus {
        val required = listOf(
            BuildConfig.FIREBASE_API_KEY,
            BuildConfig.FIREBASE_APPLICATION_ID,
            BuildConfig.FIREBASE_PROJECT_ID,
            BuildConfig.FIREBASE_SENDER_ID,
        )
        if (required.any(String::isBlank)) return RemotePushProviderStatus.NOT_CONFIGURED
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) !=
            ConnectionResult.SUCCESS
        ) return RemotePushProviderStatus.PLAY_SERVICES_UNAVAILABLE
        if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            ) ?: return RemotePushProviderStatus.NOT_CONFIGURED
        }
        return RemotePushProviderStatus.READY
    }
}

object RemotePushRegistrationScheduler {
    private const val UNIQUE_WORK = "remote-push-registration-v1"

    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<RemotePushRegistrationWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, MIN_BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            UNIQUE_WORK, ExistingWorkPolicy.REPLACE, request,
        )
    }

    private const val MIN_BACKOFF_SECONDS = 30L
}

class OpenDrSaiFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // Firebase owns durable token storage. Never place the raw token in
        // WorkManager input, SharedPreferences, logs, diagnostics or audit.
        RemotePushRegistrationScheduler.schedule(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val payload = runCatching { RemoteNotificationPayload.from(message.data) }.getOrNull() ?: return
        showRemoteWorkspaceNotification(this, payload)
    }
}

class RemotePushRegistrationWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result {
        if (RemotePushProvider.initialize(applicationContext) != RemotePushProviderStatus.READY) {
            return Result.success()
        }
        return try {
            val container = RemoteWorkspaceContainer.get(applicationContext as Application)
            val user = container.boundaries.auth.tokens.user() ?: return Result.success()
            val runtimes = buildList {
                var cursor: String? = null
                repeat(MAX_CATALOG_PAGES) {
                    val page = container.boundaries.push.catalog.listRuntimes(cursor)
                    addAll(page.items.filter {
                        "notification.push.registration" in it.capabilities
                    }.map { it.reference.runtimeId })
                    cursor = page.nextCursor
                    if (cursor == null) return@buildList
                }
                check(cursor == null) { "push_runtime_catalog_unbounded" }
            }
            if (runtimes.isEmpty()) return Result.success()
            val token = FirebaseMessaging.getInstance().token.await()
            RemotePushRegistrationCoordinator(
                container.boundaries.push.registrations,
                SharedPreferencesPushRegistrationStateStore(
                    applicationContext, "${BuildConfig.OIDC_ISSUER}\n${user.id}",
                ),
            ).synchronize(runtimes, ProviderPushToken(PROVIDER, token))
            Result.success()
        } catch (failure: RelayHttpException) {
            when {
                failure.status == 401 || failure.status == 403 -> Result.success()
                failure.status == 409 -> Result.failure()
                else -> retryOrFail()
            }
        } catch (_: IOException) {
            retryOrFail()
        } catch (_: Throwable) {
            Result.failure()
        }
    }

    private fun retryOrFail(): Result =
        if (runAttemptCount + 1 >= MAX_ATTEMPTS) Result.failure() else Result.retry()

    private companion object {
        const val PROVIDER = "fcm"
        const val MAX_CATALOG_PAGES = 100
        const val MAX_ATTEMPTS = 8
    }
}
