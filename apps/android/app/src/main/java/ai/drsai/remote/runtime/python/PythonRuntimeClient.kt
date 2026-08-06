package ai.drsai.remote.runtime.python

import android.app.ActivityManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.Process
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

/** Main-process client for the non-exported :runtime service. */
interface PythonRuntimeBridge {
    suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult
    suspend fun releaseSessionRun(sessionId: String, runId: String) = Unit
}

class PythonRuntimeClient(
    context: Context,
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val idleTimeoutMs: Long = 30_000,
    // Keep the transport/health deadline aligned with the accepted first-event budget.
    // A 2 s deadline produced a false UNAVAILABLE during a loaded arm64 device run even
    // though the same cold-start sequence completed in under 1 s when retried alone.
    private val healthTimeoutMs: Long = 5_000,
    private val responseTimeoutMs: Long = 30_000,
) : FullRuntimeBindingTransport, PythonRuntimeBridge {
    private val applicationContext = context.applicationContext
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val stateLock = Any()
    private val bindMutex = Mutex()
    private var remote: Messenger? = null
    private var connection: ServiceConnection? = null
    private var binding: CompletableDeferred<Unit>? = null
    @Volatile private var pythonCoreReady = false
    @Volatile private var verifiedRuntimeIdentity: FullRuntimeIdentity? = null
    private val healthSequence = AtomicLong()
    @Volatile private var bindingListener: FullRuntimeBindingListener? = null
    private val idleHandler = Handler(Looper.getMainLooper())
    private val idleRelease = Runnable { if (pending.isEmpty()) close() }
    private val replies = Messenger(Handler(Looper.getMainLooper()) { message ->
        if (message.what != PythonRuntimeService.MESSAGE_RESULT) return@Handler false
        val result = runCatching {
            JSONObject(message.data.getString(PythonRuntimeService.KEY_RESULT).orEmpty())
        }.getOrElse { return@Handler true }
        val requestId = result.optString("request_id")
        pending.remove(requestId)?.complete(result)
        true
    })

    override suspend fun bind() = bindMutex.withLock {
        idleHandler.removeCallbacks(idleRelease)
        if (pythonCoreReady && synchronized(stateLock) { remote != null }) return@withLock
        val startedAt = System.nanoTime()
        var lastFailure: Throwable? = null
        repeat(MAX_BIND_ATTEMPTS) { attempt ->
            try {
                bindOnce()
                pythonCoreReady = true
                metrics.bindFinished((System.nanoTime() - startedAt) / 1_000_000, true)
                return@withLock
            } catch (error: Throwable) {
                lastFailure = error
                disconnect(sendShutdown = false, "python_runtime_bind_attempt_failed")
                terminateRuntimeProcess()
                if (isExternalBindCancellation(error)) throw error
                if (attempt + 1 < MAX_BIND_ATTEMPTS) delay(BIND_RETRY_DELAY_MS)
            }
        }
        metrics.bindFinished((System.nanoTime() - startedAt) / 1_000_000, false)
        throw lastFailure ?: IllegalStateException("python_runtime_bind_failed")
    }

    private suspend fun bindOnce() {
        val deferred = CompletableDeferred<Unit>()
        val candidate = newConnection(deferred)
        synchronized(stateLock) {
            binding = deferred
            connection = candidate
        }
        if (!applicationContext.bindService(
                Intent(applicationContext, PythonRuntimeService::class.java),
                candidate,
                Context.BIND_AUTO_CREATE,
            )
        ) {
            synchronized(stateLock) {
                if (connection === candidate) connection = null
                binding = null
            }
            throw IllegalStateException("python_runtime_bind_failed")
        }
        withTimeout(healthTimeoutMs) { deferred.await() }
        verifyPythonCoreReady()
    }

    suspend fun submit(envelope: PythonRuntimeEnvelope): JSONObject {
        idleHandler.removeCallbacks(idleRelease)
        bind()
        val deferred = CompletableDeferred<JSONObject>()
        check(pending.putIfAbsent(envelope.requestId, deferred) == null) { "request_already_pending" }
        val message = Message.obtain(null, PythonRuntimeService.MESSAGE_SUBMIT).apply {
            data = Bundle().apply { putString(PythonRuntimeService.KEY_ENVELOPE, envelope.toJson()) }
            replyTo = replies
        }
        try {
            synchronized(stateLock) { remote }?.send(message)
                ?: error("python_runtime_not_bound")
            return withTimeout(responseTimeoutMs) { deferred.await() }
        } catch (error: Throwable) {
            pending.remove(envelope.requestId)
            disconnect(sendShutdown = false, "python_runtime_response_failed")
            terminateRuntimeProcess()
            bindingListener?.onConnectionLost("python_runtime_response_failed")
            throw error
        } finally {
            if (pending.isEmpty() && idleTimeoutMs >= 0) idleHandler.postDelayed(idleRelease, idleTimeoutMs)
        }
    }

    override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult =
        PythonRuntimeExecutionResult.fromJson(submit(envelope))

    override suspend fun releaseSessionRun(sessionId: String, runId: String) {
        bind()
        val message = Message.obtain(null, PythonRuntimeService.MESSAGE_RELEASE_RUN).apply {
            data = Bundle().apply {
                putString(PythonRuntimeService.KEY_SESSION_ID, sessionId)
                putString(PythonRuntimeService.KEY_RUN_ID, runId)
            }
        }
        synchronized(stateLock) { remote }?.send(message)
            ?: error("python_runtime_not_bound")
    }

    private suspend fun verifyPythonCoreReady() {
        val requestId = "health:${healthSequence.incrementAndGet()}"
        val deferred = CompletableDeferred<JSONObject>()
        check(pending.putIfAbsent(requestId, deferred) == null) { "python_health_already_pending" }
        try {
            val message = Message.obtain(null, PythonRuntimeService.MESSAGE_HEALTH).apply {
                data = Bundle().apply { putString(PythonRuntimeService.KEY_REQUEST_ID, requestId) }
                replyTo = replies
            }
            synchronized(stateLock) { remote }?.send(message) ?: error("python_runtime_not_bound")
            val result = withTimeout(healthTimeoutMs) { deferred.await() }
            val python = result.optJSONObject("python_result")
            check(python?.optString("status") == "python_runtime_ready") {
                "python_runtime_health_failed:${python?.optString("code").orEmpty()}:${python?.optString("error_type").orEmpty()}"
            }
            val identity = python.getJSONObject("agent_kernel")
            check(identity.getString("surface") == "android") { "python_runtime_surface_invalid" }
            val manifest = python.getJSONObject("capability_manifest")
            check(manifest.getString("surface") == "android") { "capability_manifest_surface_invalid" }
            check(manifest.getString("sha256") == identity.getString("capability_manifest_sha256")) {
                "capability_manifest_identity_mismatch"
            }
            verifiedRuntimeIdentity = FullRuntimeIdentity(
                kernelId = identity.getString("kernel_id"),
                kernelVersion = identity.getString("kernel_version"),
                kernelSha256 = identity.getString("kernel_sha256"),
                promptVersion = identity.getString("prompt_version"),
                promptSha256 = identity.getString("base_prompt_sha256"),
                toolManifestVersion = identity.getString("tool_manifest_version"),
                capabilityManifestVersion = identity.getString("capability_manifest_version"),
                capabilityManifestSha256 = identity.getString("capability_manifest_sha256"),
                hostPortProtocolVersion = identity.getString("host_port_protocol_version"),
                modelToolSnapshotVersion = identity.getString("model_tool_snapshot_version"),
                runtimeProcessName = python.getString("android_process_name"),
                runtimePid = python.getInt("android_pid"),
            )
        } finally {
            pending.remove(requestId)
        }
    }

    override fun setBindingListener(listener: FullRuntimeBindingListener?) {
        bindingListener = listener
    }

    override fun runtimeIdentity(): FullRuntimeIdentity? = verifiedRuntimeIdentity

    override fun close() {
        idleHandler.removeCallbacks(idleRelease)
        // PythonRuntimeService is a bound-only service: unbinding the last client
        // tears down the Service, but Android may retain its process as a cached
        // process together with the Python heap. Avoid a synchronous Binder send
        // because a dead or wedged :runtime process must never block cleanup, then
        // explicitly terminate only this app UID's dedicated runtime process.
        disconnect(sendShutdown = false, "python_runtime_client_closed")
        terminateRuntimeProcess()
    }

    private fun disconnect(sendShutdown: Boolean, reason: String) {
        val (bound, remoteService) = synchronized(stateLock) {
            val value = connection
            val service = remote
            connection = null
            remote = null
            binding = null
            pythonCoreReady = false
            verifiedRuntimeIdentity = null
            value to service
        }
        if (sendShutdown) {
            runCatching { remoteService?.send(Message.obtain(null, PythonRuntimeService.MESSAGE_SHUTDOWN)) }
        }
        if (bound != null) runCatching { applicationContext.unbindService(bound) }
        failPending(reason)
    }

    private fun terminateRuntimeProcess() {
        val manager = applicationContext.getSystemService(ActivityManager::class.java) ?: return
        val processName = "${applicationContext.packageName}:runtime"
        manager.runningAppProcesses.orEmpty()
            .filter { it.processName == processName }
            .forEach { Process.killProcess(it.pid) }
    }

    private fun failPending(code: String) {
        pending.values.forEach { it.completeExceptionally(IllegalStateException(code)) }
        pending.clear()
    }

    private fun newConnection(ready: CompletableDeferred<Unit>) = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            if (binder == null) {
                synchronized(stateLock) { binding = null }
                ready.completeExceptionally(IllegalStateException("python_runtime_binder_missing"))
                return
            }
            synchronized(stateLock) {
                remote = Messenger(binder)
                binding = null
            }
            ready.complete(Unit)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            connectionLost("python_runtime_disconnected")
        }

        override fun onBindingDied(name: ComponentName?) {
            connectionLost("python_runtime_binding_died")
        }
    }

    private fun connectionLost(reason: String) {
        val stale = synchronized(stateLock) {
            val value = connection
            connection = null
            remote = null
            binding = null
            pythonCoreReady = false
            verifiedRuntimeIdentity = null
            value
        }
        if (stale != null) runCatching { applicationContext.unbindService(stale) }
        failPending(reason)
        bindingListener?.onConnectionLost(reason)
    }

    private companion object {
        const val MAX_BIND_ATTEMPTS = 4
        const val BIND_RETRY_DELAY_MS = 250L
    }
}

internal fun isExternalBindCancellation(error: Throwable): Boolean =
    error is CancellationException && error !is TimeoutCancellationException
