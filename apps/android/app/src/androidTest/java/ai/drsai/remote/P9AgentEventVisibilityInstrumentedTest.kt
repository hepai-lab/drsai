package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** P9-E production-bridge checks kept intentionally small for every API emulator. */
@RunWith(AndroidJUnit4::class)
class P9AgentEventVisibilityInstrumentedTest {
    @Test
    fun helloStreamsAndCompletesExactlyOnceAcrossConsecutiveRuns(): Unit = runBlocking {
        val client = PythonRuntimeClient(
            ApplicationProvider.getApplicationContext<Context>(), idleTimeoutMs = -1,
        )
        try {
            val sessionId = "p9-emulator-consecutive-session"
            repeat(3) { index ->
                val runId = "p9-emulator-hello-$index"
                val started = submit(client, runId, 0, PythonRuntimeMessageType.START_RUN,
                    JSONObject().put("input", listOf("Hello", "你好", "继续")[index])
                        .put("model_id", "probe-model"), sessionId)
                assertEquals("python_runtime_ready", started.getString("status"))
                assertNotNull(client.runtimeIdentity())

                val chunk = submit(client, runId, 1, PythonRuntimeMessageType.MODEL_CHUNK,
                    JSONObject().put("delta", "hello-$index"), sessionId)
                assertEquals(listOf("message.delta"), runtimeEvents(chunk).map { it.getJSONObject("payload").getString("kind") })

                val completed = submit(client, runId, 2, PythonRuntimeMessageType.MODEL_COMPLETED,
                    JSONObject().put("content", "hello-$index"), sessionId)
                val terminal = runtimeEvents(completed).map { it.getJSONObject("payload").getString("kind") }
                assertEquals(1, terminal.count { it == "run.completed" })
                assertFalse(terminal.any { it == "run.failed" || it == "run.cancelled" })
                // Mirror PythonAgentLoopCoordinator's finally block. The next
                // Run in the same session proves the release removed the
                // mailbox's active-run guard instead of leaking a conflict.
                client.releaseSessionRun(sessionId, runId)
            }
        } finally {
            client.close()
        }
    }

    @Test
    fun failedRunPreservesCodeRetryabilityAndNonBlankBody(): Unit = runBlocking {
        val client = PythonRuntimeClient(
            ApplicationProvider.getApplicationContext<Context>(), idleTimeoutMs = -1,
        )
        try {
            val runId = "p9-emulator-error"
            submit(client, runId, 0, PythonRuntimeMessageType.START_RUN,
                JSONObject().put("input", "trigger controlled failure").put("model_id", "probe-model"))
            val failed = submit(client, runId, 1, PythonRuntimeMessageType.MODEL_FAILED,
                JSONObject().put("code", "provider_http_429").put("retryable", true)
                    .put("message", "Provider rate limit; retry later."))
            val envelope = runtimeEvents(failed).single {
                it.getJSONObject("payload").optString("kind") == "run.failed"
            }
            val payload = envelope.getJSONObject("payload")
            assertEquals("provider_http_429", payload.getString("code"))
            assertTrue(payload.getBoolean("retryable"))
            assertEquals("Provider rate limit; retry later.", payload.getString("message"))
            val normalized = PythonRuntimeEventMapper.decodeAll(PythonRuntimeEnvelope.fromJson(envelope.toString()))
            val error = (normalized.single() as NormalizedAgentEvent.RunFailed).error
            assertEquals("provider_http_429", error.code)
            assertTrue(error.retryable)
            assertEquals("Provider rate limit; retry later.", error.message)
        } finally {
            client.close()
        }
    }

    @Test
    fun runtimeFailureCategoriesRemainDistinctFromProviderFailures(): Unit = runBlocking {
        val client = PythonRuntimeClient(
            ApplicationProvider.getApplicationContext<Context>(), idleTimeoutMs = -1,
        )
        val cases = linkedMapOf(
            "memory_explicit_intent_required" to "Memory write requires explicit user intent.",
            "context_active_chain_budget_overflow" to "Active tool chain exceeded the bounded context budget.",
            "subagent_tool_whitelist_denied" to "Subagent requested a tool outside its capability snapshot.",
            "model_stream_schema_invalid" to "Provider stream did not match the expected schema.",
        )
        try {
            cases.forEach { (code, message) ->
                val runId = "p9-emulator-category-$code"
                val sessionId = "$runId-session"
                submit(client, runId, 0, PythonRuntimeMessageType.START_RUN,
                    JSONObject().put("input", "controlled category fixture").put("model_id", "probe-model"),
                    sessionId)
                val failed = submit(client, runId, 1, PythonRuntimeMessageType.MODEL_FAILED,
                    JSONObject().put("code", code).put("retryable", false).put("message", message),
                    sessionId)
                val envelope = runtimeEvents(failed).single {
                    it.getJSONObject("payload").optString("kind") == "run.failed"
                }
                val error = (PythonRuntimeEventMapper.decodeAll(
                    PythonRuntimeEnvelope.fromJson(envelope.toString()),
                ).single() as NormalizedAgentEvent.RunFailed).error
                assertEquals(code, error.code)
                assertEquals(message, error.message)
                assertFalse(error.code.startsWith("provider_http_"))
                client.releaseSessionRun(sessionId, runId)
            }
        } finally {
            client.close()
        }
    }

    private suspend fun submit(
        client: PythonRuntimeClient,
        runId: String,
        sequence: Long,
        type: PythonRuntimeMessageType,
        payload: JSONObject,
        sessionId: String = "$runId-session",
    ): JSONObject = client.submit(PythonRuntimeEnvelope(
        messageType = type,
        requestId = "$runId-request-$sequence",
        runId = runId,
        sessionId = sessionId,
        sequence = sequence,
        idempotencyKey = "$runId:$sequence",
        payload = payload,
    )).also { assertEquals("accepted", it.getString("decision")) }.getJSONObject("python_result")

    private fun runtimeEvents(result: JSONObject): List<JSONObject> {
        val outbound: JSONArray = result.getJSONArray("outbound")
        return (0 until outbound.length()).map(outbound::getJSONObject)
            .filter { it.optString("message_type") == "runtime_event" }
    }
}
