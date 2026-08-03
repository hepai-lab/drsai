package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RuntimeId
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal const val DEVICE_PRESENCE_INTERVAL_MILLIS = 20_000L

internal interface DevicePresenceHostSource {
    suspend fun activeRuntimeIds(): List<RuntimeId>
    suspend fun removeRuntime(runtimeId: RuntimeId)
    suspend fun clear()
}

/**
 * Process-foreground presence loop. It deliberately has no Android lifecycle
 * dependency so timing, cancellation and duplicate-start behavior stay
 * deterministic under JVM tests.
 */
internal class DevicePresenceController(
    private val scope: CoroutineScope,
    private val hosts: DevicePresenceHostSource,
    private val send: suspend (RuntimeId, Boolean) -> Unit,
    private val authenticated: () -> Boolean,
    private val intervalMillis: Long = DEVICE_PRESENCE_INTERVAL_MILLIS,
    private val failureJitterMillis: () -> Long = { (0L..2_000L).random() },
) {
    private val monitor = Any()
    private var foreground = false
    private var enabled = true
    private var loop: Job? = null

    fun onForeground() {
        synchronized(monitor) {
            foreground = true
            startLocked()
        }
    }

    fun onBackground() {
        synchronized(monitor) {
            foreground = false
            loop?.cancel()
            loop = null
        }
    }

    fun onAuthenticationChanged() {
        synchronized(monitor) {
            enabled = true
            startLocked()
        }
    }

    fun onLogout() {
        synchronized(monitor) {
            enabled = false
            loop?.cancel()
            loop = null
        }
    }

    internal fun hasActiveLoop(): Boolean = synchronized(monitor) { loop?.isActive == true }

    private fun startLocked() {
        if (!foreground || !enabled || !authenticated() || loop?.isActive == true) return
        loop = scope.launch {
            while (isActive) {
                val failed = renewOnce()
                delay(intervalMillis + if (failed) failureJitterMillis().coerceAtLeast(0L) else 0L)
            }
        }
    }

    private suspend fun renewOnce(): Boolean {
        val runtimeIds = try {
            hosts.activeRuntimeIds().distinct()
        } catch (failure: RelayHttpException) {
            if (failure.status == 403) hosts.clear()
            return true
        } catch (_: IOException) {
            return true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: RuntimeException) {
            return true
        }
        var failed = false
        runtimeIds.forEach { runtimeId ->
            try {
                send(runtimeId, false)
            } catch (failure: RelayHttpException) {
                if (failure.status == 403) hosts.removeRuntime(runtimeId) else failed = true
            } catch (_: IOException) {
                failed = true
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: RuntimeException) {
                failed = true
            }
        }
        return failed
    }
}
