package ai.drsai.remote.runtime.python

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import android.app.Application
import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.HandlerThread
import android.os.Process
import android.util.Log
import org.json.JSONObject
import kotlin.system.exitProcess

/** Non-exported, same-UID service hosted in the dedicated :runtime process. */
class PythonRuntimeService : Service() {
    private val mailbox = PythonRuntimeMailbox()
    private val executorDelegate = lazy { ChaquopyRuntimeExecutor(this) }
    private val executor by executorDelegate
    private val runtimeThreadDelegate = lazy { HandlerThread("OpenDrSaiPythonRuntime").apply { start() } }
    private val runtimeThread by runtimeThreadDelegate
    private val messenger by lazy {
        Messenger(
            IncomingHandler(runtimeThread.looper, mailbox, executor, currentProcessName(), Process.myPid()) {
                executor.reset()
                mailbox.clear()
                stopSelf()
                // Exit normally after the shutdown message has returned to the
                // main looper. SIGKILL makes Android treat intentional runtime
                // recycling as a crash and may trigger service restart backoff.
                Handler(Looper.getMainLooper()).post { exitProcess(0) }
            }
        )
    }

    override fun onBind(intent: Intent?): IBinder = messenger.binder

    override fun onDestroy() {
        mailbox.clear()
        if (runtimeThreadDelegate.isInitialized()) runtimeThread.quitSafely()
        super.onDestroy()
    }

    /**
     * Application.getProcessName was added in API 28. The runtime still supports
     * API 26, so resolve the Linux process name directly on older releases.
     */
    private fun currentProcessName(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Application.getProcessName()
        } else {
            runCatching {
                java.io.File("/proc/self/cmdline")
                    .readText(Charsets.UTF_8)
                    .substringBefore('\u0000')
                    .trim()
                    .takeIf(String::isNotEmpty)
            }.getOrNull() ?: packageName
        }

    private class IncomingHandler(
        looper: Looper,
        private val mailbox: PythonRuntimeMailbox,
        private val executor: ChaquopyRuntimeExecutor,
        private val processName: String,
        private val processId: Int,
        private val shutdown: () -> Unit,
    ) : Handler(looper) {
        override fun handleMessage(message: Message) {
            if (message.what == MESSAGE_SHUTDOWN) {
                shutdown()
                return
            }
            if (message.what == MESSAGE_HEALTH) {
                val requestId = message.data.getString(KEY_REQUEST_ID).orEmpty()
                val pythonResult = runCatching {
                    JSONObject(executor.health())
                        .put("android_process_name", processName)
                        .put("android_pid", processId)
                        .toString()
                }
                    .getOrElse { error ->
                        Log.e("OpenDrSaiPython", "Python Runtime health probe failed", error)
                        JSONObject()
                            .put("status", "python_runtime_failed")
                            .put("code", "python_health_failed")
                            .put("error_type", error.javaClass.simpleName.take(80))
                            .toString()
                    }
                message.replyTo?.send(Message.obtain(null, MESSAGE_RESULT).apply {
                    data = Bundle().apply {
                        putString(KEY_RESULT, JSONObject()
                            .put("decision", "accepted")
                            .put("request_id", requestId)
                            .put("python_result", JSONObject(pythonResult))
                            .toString())
                    }
                })
                return
            }
            if (message.what == MESSAGE_RELEASE_RUN) {
                mailbox.releaseSessionRun(
                    message.data.getString(KEY_SESSION_ID).orEmpty(),
                    message.data.getString(KEY_RUN_ID).orEmpty(),
                )
                return
            }
            if (message.what != MESSAGE_SUBMIT) {
                super.handleMessage(message)
                return
            }
            val result = mailbox.submit(message.data.getString(KEY_ENVELOPE).orEmpty())
            val pythonResult = if (result.decision == MailboxDecision.ACCEPTED) {
                runCatching { executor.execute(message.data.getString(KEY_ENVELOPE).orEmpty()) }
                    .getOrElse { error ->
                        Log.e("OpenDrSaiPython", "Python Runtime command failed", error)
                        JSONObject().put("status", "python_runtime_failed")
                            .put("code", "python_boundary_error")
                            .put("error_type", error.javaClass.simpleName.take(80))
                            .put("error", SensitiveDataRedactor.redact(error.message ?: "python_boundary_error").take(240))
                            .toString()
                    }
            } else null
            val response = Message.obtain(null, MESSAGE_RESULT).apply {
                data = Bundle().apply {
                    putString(
                        KEY_RESULT,
                        JSONObject()
                            .put("decision", result.decision.name.lowercase())
                            .put("request_id", result.requestId)
                            .put("code", result.code)
                            .put("python_result", pythonResult?.let(::JSONObject))
                            .toString(),
                    )
                }
            }
            message.replyTo?.send(response)
        }
    }

    companion object {
        const val MESSAGE_SUBMIT = 1
        const val MESSAGE_RESULT = 2
        const val MESSAGE_SHUTDOWN = 3
        const val MESSAGE_HEALTH = 4
        const val MESSAGE_RELEASE_RUN = 5
        const val KEY_ENVELOPE = "envelope"
        const val KEY_RESULT = "result"
        const val KEY_REQUEST_ID = "request_id"
        const val KEY_SESSION_ID = "session_id"
        const val KEY_RUN_ID = "run_id"
    }
}
