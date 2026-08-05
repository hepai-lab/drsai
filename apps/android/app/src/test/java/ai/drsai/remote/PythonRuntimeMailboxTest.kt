package ai.drsai.remote

import ai.drsai.remote.runtime.python.MailboxDecision
import ai.drsai.remote.runtime.python.PYTHON_RUNTIME_MAX_MESSAGE_BYTES
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMailbox
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PythonRuntimeMailboxTest {
    private fun message(
        request: String = "request-1",
        run: String = "run-1",
        session: String = "session-1",
        sequence: Long = 0,
        key: String = "key-1",
        type: PythonRuntimeMessageType = PythonRuntimeMessageType.START_RUN,
        payload: JSONObject = JSONObject().put("input", "hello"),
    ) = PythonRuntimeEnvelope(type, request, run, session, sequence, key, payload).toJson()

    @Test
    fun `exact replay is duplicate but reused key with another request conflicts`() {
        val mailbox = PythonRuntimeMailbox()
        assertEquals(MailboxDecision.ACCEPTED, mailbox.submit(message()).decision)
        assertEquals(MailboxDecision.DUPLICATE, mailbox.submit(message()).decision)
        assertEquals(MailboxDecision.CONFLICT, mailbox.submit(message(request = "request-2")).decision)
    }

    @Test
    fun `one session cannot start two runs until terminal event`() {
        val mailbox = PythonRuntimeMailbox()
        assertEquals(MailboxDecision.ACCEPTED, mailbox.submit(message()).decision)
        assertEquals(
            MailboxDecision.CONFLICT,
            mailbox.submit(message("request-2", "run-2", key = "key-2")).decision,
        )
        assertEquals(
            MailboxDecision.ACCEPTED,
            mailbox.submit(
                message(
                    request = "request-terminal",
                    sequence = 1,
                    key = "key-terminal",
                    type = PythonRuntimeMessageType.RUNTIME_EVENT,
                    payload = JSONObject().put("kind", "run.completed"),
                )
            ).decision,
        )
        assertEquals(
            MailboxDecision.ACCEPTED,
            mailbox.submit(message("request-2", "run-2", key = "key-2")).decision,
        )
    }

    @Test
    fun `out of order invalid and oversized messages are rejected`() {
        val mailbox = PythonRuntimeMailbox()
        assertEquals(MailboxDecision.ACCEPTED, mailbox.submit(message(sequence = 2)).decision)
        assertEquals(
            MailboxDecision.OUT_OF_ORDER,
            mailbox.submit(message("request-2", sequence = 1, key = "key-2")).decision,
        )
        assertEquals(MailboxDecision.INVALID, mailbox.submit("not-json").decision)
        assertEquals(
            MailboxDecision.TOO_LARGE,
            mailbox.submit("x".repeat(PYTHON_RUNTIME_MAX_MESSAGE_BYTES + 1)).decision,
        )
    }

    @Test
    fun `clear releases all in-memory run identity`() {
        val mailbox = PythonRuntimeMailbox()
        mailbox.submit(message())
        mailbox.clear()
        assertEquals(MailboxDecision.ACCEPTED, mailbox.submit(message()).decision)
    }
}
