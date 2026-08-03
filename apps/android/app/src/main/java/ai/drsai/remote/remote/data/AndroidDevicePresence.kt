package ai.drsai.remote.remote.data

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.room.Room
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.MIGRATION_8_9
import ai.drsai.remote.data.MIGRATION_9_10
import ai.drsai.remote.data.MIGRATION_10_11
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Single process-wide owner for foreground Device Presence. It never installs
 * WorkManager or a foreground service and therefore naturally expires after
 * the Platform TTL while the app is backgrounded or dead.
 */
object AndroidDevicePresence {
    private val installed = AtomicBoolean(false)
    @Volatile private var lifecycle: PresenceLifecycle? = null

    fun install(application: Application) {
        if (!installed.compareAndSet(false, true)) return
        val owner = PresenceLifecycle(application)
        lifecycle = owner
        ProcessLifecycleOwner.get().lifecycle.addObserver(owner)
    }

    fun authenticationChanged() {
        lifecycle?.controller?.onAuthenticationChanged()
    }

    fun logout() {
        lifecycle?.controller?.onLogout()
    }

    fun markAccessing(runtimeId: RuntimeId) {
        lifecycle?.markAccessing(runtimeId)
    }

    private class PresenceLifecycle(application: Application) : DefaultLifecycleObserver {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        private val tokenStore = SecureTokenStore(application)
        private val auth = AccessTokenCoordinator(
            tokenStore,
            OidcClient(refreshClientId = { tokenStore.oidcClientId }),
        )
        private val relay = HttpRelayDiscoveryService(
            BuildConfig.RELAY_BASE_URL,
            auth::current,
            auth::refreshAfter,
            deviceProof = androidRelayDeviceProof(application),
        )
        private val database = Room.databaseBuilder(
            application,
            ChatDatabase::class.java,
            "opendrsai.db",
        ).addMigrations(
            MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
            MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11,
        ).build()
        private val cache = RoomRemoteDirectoryCache(database)
        private val hostSource = object : DevicePresenceHostSource {
            override suspend fun activeRuntimeIds(): List<RuntimeId> =
                collectAllPages { cursor -> relay.listRuntimes(cursor = cursor) }
                    .map { it.reference.runtimeId }

            override suspend fun removeRuntime(runtimeId: RuntimeId) {
                tokenStore.user()?.id?.let { cache.removeRuntime(it, "", runtimeId) }
            }

            override suspend fun clear() {
                tokenStore.user()?.id?.let { cache.clear(it, "") }
            }
        }
        val controller = DevicePresenceController(
            scope = scope,
            hosts = hostSource,
            send = relay::recordPresence,
            authenticated = {
                tokenStore.user() != null && !tokenStore.accessToken.isNullOrBlank()
            },
        )

        override fun onStart(owner: LifecycleOwner) {
            controller.onForeground()
        }

        override fun onStop(owner: LifecycleOwner) {
            controller.onBackground()
        }

        fun markAccessing(runtimeId: RuntimeId) {
            scope.launch {
                try {
                    relay.recordPresence(runtimeId, accessing = true)
                } catch (failure: RelayHttpException) {
                    if (failure.status == 403) hostSource.removeRuntime(runtimeId)
                } catch (_: Exception) {
                    // A navigation hint must not crash the app or expose request data.
                }
            }
        }
    }
}
