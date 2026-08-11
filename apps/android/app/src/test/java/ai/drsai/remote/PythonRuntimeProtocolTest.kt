package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PythonRuntimeProtocolTest {
    private fun envelope() = PythonRuntimeEnvelope(
        messageType = PythonRuntimeMessageType.START_RUN,
        requestId = "request-1",
        runId = "run-1",
        sessionId = "session-1",
        sequence = 0,
        idempotencyKey = "start:run-1",
        payload = JSONObject().put("input", "你好"),
    )

    @Test
    fun `envelope round trips all bridge identity fields`() {
        val decoded = PythonRuntimeEnvelope.fromJson(envelope().toJson())

        assertEquals(PythonRuntimeMessageType.START_RUN, decoded.messageType)
        assertEquals("request-1", decoded.requestId)
        assertEquals("run-1", decoded.runId)
        assertEquals("session-1", decoded.sessionId)
        assertEquals("start:run-1", decoded.idempotencyKey)
        assertEquals("你好", decoded.payload.getString("input"))
    }

    @Test
    fun `unknown bridge message and extra field are rejected`() {
        val unknown = JSONObject(envelope().toJson()).put("message_type", "shell_request")
        assertThrows(IllegalStateException::class.java) { PythonRuntimeEnvelope.fromJson(unknown.toString()) }

        val extra = JSONObject(envelope().toJson()).put("secret", "must-not-cross-boundary")
        assertThrows(IllegalArgumentException::class.java) { PythonRuntimeEnvelope.fromJson(extra.toString()) }
    }

    @Test
    fun `invalid version sequence and idempotency are rejected`() {
        assertThrows(IllegalArgumentException::class.java) { envelope().copy(protocolVersion = 2) }
        assertThrows(IllegalArgumentException::class.java) { envelope().copy(sequence = -1) }
        assertThrows(IllegalArgumentException::class.java) { envelope().copy(idempotencyKey = "") }
    }

    @Test
    fun `shared golden fixture is readable by Android codec`() {
        val fixture = requireNotNull(javaClass.classLoader?.getResource("envelope-v1.json"))
            .readText(Charsets.UTF_8)

        val decoded = PythonRuntimeEnvelope.fromJson(fixture)

        assertEquals(PythonRuntimeMessageType.START_RUN, decoded.messageType)
        assertEquals("artifact-opaque-1", decoded.payload.getJSONArray("artifact_ids").getString(0))
        assertEquals(1, decoded.payload.getJSONObject("skill_versions").getInt("summarize"))
    }


    @Test
    fun `cross runtime parity fixture commands are all accepted by Android codec`() {
        val fixture = JSONObject(
            requireNotNull(javaClass.classLoader?.getResource("mobile-core-parity-v1.json"))
                .readText(Charsets.UTF_8)
        )
        val scenarios = fixture.getJSONArray("scenarios")
        var commandCount = 0
        repeat(scenarios.length()) { scenarioIndex ->
            val scenario = scenarios.getJSONObject(scenarioIndex)
            val commands = scenario.getJSONArray("commands")
            repeat(commands.length()) { commandIndex ->
                PythonRuntimeEnvelope.fromJson(commands.getJSONObject(commandIndex).toString())
                commandCount += 1
            }
            require(scenario.getJSONArray("expected_events").length() > 0)
        }
        assertEquals(6, commandCount)
    }
}
