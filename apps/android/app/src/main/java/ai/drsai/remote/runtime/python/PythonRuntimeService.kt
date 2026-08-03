package ai.drsai.remote.runtime.python

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import org.json.JSONObject
import kotlin.system.exitProcess

/** Non-exported, same-UID service hosted in the dedicated :runtime process. */
class PythonRuntimeService : Service() {
    private val mailbox = PythonRuntimeMailbox()
    private val executorDelegate = lazy { ChaquopyRuntimeExecutor(this) }
    private val executor by executorDelegate
    private val messenger by lazy {
        Messenger(
            IncomingHandler(mailbox, executor) {
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
        if (executorDelegate.isInitialized()) executor.reset()
        mailbox.clear()
        super.onDestroy()
    }

    private class IncomingHandler(
        private val mailbox: PythonRuntimeMailbox,
        private val executor: ChaquopyRuntimeExecutor,
        private val shutdown: () -> Unit,
    ) : Handler(Looper.getMainLooper()) {
        override fun handleMessage(message: Message) {
            if (message.what == MESSAGE_SHUTDOWN) {
                shutdown()
                return
            }
            if (message.what != MESSAGE_SUBMIT) {
                super.handleMessage(message)
                return
            }
            val result = mailbox.submit(message.data.getString(KEY_ENVELOPE).orEmpty())
            val pythonResult = if (result.decision == MailboxDecision.ACCEPTED) {
                runCatching { executor.execute(message.data.getString(KEY_ENVELOPE).orEmpty()) }
                    .getOrElse { JSONObject().put("status", "python_runtime_failed").put("code", "python_boundary_error").toString() }
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
        const val KEY_ENVELOPE = "envelope"
        const val KEY_RESULT = "result"
    }
}
