package ai.drsai.remote.runtime.python

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
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import org.json.JSONObject

/** Main-process client for the non-exported :runtime service. */
interface PythonRuntimeBridge {
    suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult
}

class PythonRuntimeClient(
    context: Context,
    private val metrics: PythonRuntimeMetrics = NoOpPythonRuntimeMetrics,
    private val idleTimeoutMs: Long = 30_000,
) : Closeable, PythonRuntimeBridge {
    private val applicationContext = context.applicationContext
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val stateLock = Any()
    private var remote: Messenger? = null
    private var connection: ServiceConnection? = null
    private var binding: CompletableDeferred<Unit>? = null
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

    suspend fun bind() {
        idleHandler.removeCallbacks(idleRelease)
        val startedAt = System.nanoTime()
        val (deferred, owner) = synchronized(stateLock) {
            if (remote != null) return
            binding?.let { return@synchronized it to false }
            CompletableDeferred<Unit>().also { binding = it } to true
        }
        if (owner) {
            val candidate = newConnection(deferred)
            synchronized(stateLock) { connection = candidate }
            if (!applicationContext.bindService(
                    Intent(applicationContext, PythonRuntimeService::class.java),
                    candidate,
                    Context.BIND_AUTO_CREATE,
                )
            ) {
                synchronized(stateLock) {
                    connection = null
                    binding = null
                }
                deferred.completeExceptionally(IllegalStateException("python_runtime_bind_failed"))
            }
        }
        runCatching { deferred.await() }
            .onSuccess { if (owner) metrics.bindFinished((System.nanoTime() - startedAt) / 1_000_000, true) }
            .onFailure { if (owner) metrics.bindFinished((System.nanoTime() - startedAt) / 1_000_000, false) }
            .getOrThrow()
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
            return deferred.await()
        } catch (error: Throwable) {
            pending.remove(envelope.requestId)
            throw error
        } finally {
            if (pending.isEmpty() && idleTimeoutMs >= 0) idleHandler.postDelayed(idleRelease, idleTimeoutMs)
        }
    }

    override suspend fun execute(envelope: PythonRuntimeEnvelope): PythonRuntimeExecutionResult =
        PythonRuntimeExecutionResult.fromJson(submit(envelope))

    override fun close() {
        idleHandler.removeCallbacks(idleRelease)
        val (bound, remoteService) = synchronized(stateLock) {
            val value = connection
            val service = remote
            connection = null
            remote = null
            value to service
        }
        runCatching { remoteService?.send(Message.obtain(null, PythonRuntimeService.MESSAGE_SHUTDOWN)) }
        if (bound != null) runCatching { applicationContext.unbindService(bound) }
        failPending("python_runtime_client_closed")
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
            synchronized(stateLock) { remote = null }
            failPending("python_runtime_disconnected")
        }

        override fun onBindingDied(name: ComponentName?) {
            synchronized(stateLock) { remote = null }
            failPending("python_runtime_binding_died")
        }
    }
}
