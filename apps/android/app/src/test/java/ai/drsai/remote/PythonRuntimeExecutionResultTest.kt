package ai.drsai.remote

import ai.drsai.remote.runtime.python.MailboxDecision
import ai.drsai.remote.runtime.python.PythonRuntimeExecutionResult
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PythonRuntimeExecutionResultTest {
    @Test
    fun `parses typed outbound envelopes from Python boundary`() {
        val outbound = JSONObject()
            .put("protocol_version", 1)
            .put("message_type", "model_request")
            .put("request_id", "run-1:2")
            .put("run_id", "run-1")
            .put("session_id", "session-1")
            .put("sequence", 2)
            .put("idempotency_key", "run-1:2:model")
            .put("payload", JSONObject().put("model_id", "model-1"))
        val root = JSONObject()
            .put("decision", "accepted")
            .put("request_id", "request-1")
            .put("code", "accepted")
            .put(
                "python_result",
                JSONObject().put("status", "python_runtime_ready").put("outbound", JSONArray().put(outbound)),
            )

        val result = PythonRuntimeExecutionResult.fromJson(root)

        assertEquals(MailboxDecision.ACCEPTED, result.decision)
        assertEquals("python_runtime_ready", result.status)
        assertEquals(PythonRuntimeMessageType.MODEL_REQUEST, result.outbound.single().messageType)
        assertEquals("model-1", result.outbound.single().payload.getString("model_id"))
    }
}
