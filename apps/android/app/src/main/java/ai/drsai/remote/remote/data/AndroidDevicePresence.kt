package ai.drsai.remote.remote.data

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import ai.drsai.remote.remote.model.RuntimeId
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
        private val container = RemoteWorkspaceContainer.get(application)
        private val tokenStore = container.boundaries.auth.tokens
        private val relay = container.boundaries.association.service
        private val cache = container.directoryCache
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
            waitFor = container.time::waitFor,
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
