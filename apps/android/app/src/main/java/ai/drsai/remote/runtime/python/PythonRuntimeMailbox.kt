package ai.drsai.remote.runtime.python

import java.util.LinkedHashMap

const val PYTHON_RUNTIME_MAX_MESSAGE_BYTES = 256 * 1024

enum class MailboxDecision { ACCEPTED, DUPLICATE, OUT_OF_ORDER, CONFLICT, TOO_LARGE, INVALID }

data class MailboxResult(
    val decision: MailboxDecision,
    val requestId: String? = null,
    val code: String,
)

/**
 * Serialized protocol gate used by the Binder service before Python is called.
 * It deliberately retains only bridge identity, never payloads or credentials.
 */
class PythonRuntimeMailbox(private val retainedKeys: Int = 512) {
    private val accepted = object : LinkedHashMap<String, String>(retainedKeys, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean =
            size > retainedKeys
    }
    private val lastSequenceByRun = mutableMapOf<String, Long>()
    private val activeRunBySession = mutableMapOf<String, String>()

    init { require(retainedKeys > 0) { "retained_keys_invalid" } }

    @Synchronized
    fun submit(encoded: String): MailboxResult {
        if (encoded.toByteArray(Charsets.UTF_8).size > PYTHON_RUNTIME_MAX_MESSAGE_BYTES) {
            return MailboxResult(MailboxDecision.TOO_LARGE, code = "bridge_message_too_large")
        }
        val envelope = try {
            PythonRuntimeEnvelope.fromJson(encoded)
        } catch (_: Exception) {
            return MailboxResult(MailboxDecision.INVALID, code = "bridge_message_invalid")
        }
        val previousRequest = accepted[envelope.idempotencyKey]
        if (previousRequest != null) {
            return if (previousRequest == envelope.requestId) {
                MailboxResult(MailboxDecision.DUPLICATE, envelope.requestId, "idempotent_replay")
            } else {
                MailboxResult(MailboxDecision.CONFLICT, envelope.requestId, "idempotency_key_conflict")
            }
        }
        val lastSequence = lastSequenceByRun[envelope.runId]
        if (lastSequence != null && envelope.sequence <= lastSequence) {
            return MailboxResult(MailboxDecision.OUT_OF_ORDER, envelope.requestId, "sequence_not_monotonic")
        }
        if (envelope.messageType == PythonRuntimeMessageType.START_RUN) {
            val active = activeRunBySession[envelope.sessionId]
            if (active != null && active != envelope.runId) {
                return MailboxResult(MailboxDecision.CONFLICT, envelope.requestId, "session_run_already_active")
            }
            activeRunBySession[envelope.sessionId] = envelope.runId
        }
        if (envelope.messageType == PythonRuntimeMessageType.RUNTIME_EVENT &&
            envelope.payload.optString("kind") in TERMINAL_EVENT_KINDS
        ) {
            activeRunBySession.remove(envelope.sessionId, envelope.runId)
        }
        accepted[envelope.idempotencyKey] = envelope.requestId
        lastSequenceByRun[envelope.runId] = envelope.sequence
        return MailboxResult(MailboxDecision.ACCEPTED, envelope.requestId, "accepted")
    }

    @Synchronized
    fun clear() {
        accepted.clear()
        lastSequenceByRun.clear()
        activeRunBySession.clear()
    }

    @Synchronized
    fun releaseSessionRun(sessionId: String, runId: String) {
        activeRunBySession.remove(sessionId, runId)
    }

    companion object {
        private val TERMINAL_EVENT_KINDS = setOf("run.completed", "run.failed", "run.cancelled")
    }
}
