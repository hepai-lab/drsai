package ai.drsai.remote

import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.FileInputStream
import kotlin.system.measureTimeMillis
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P9RuntimeCancelBackgroundInstrumentedTest {
    @Test
    fun streamingCancellationProducesOneOaepCancelledTerminal(): Unit = runBlocking {
        val runId = "p9-cancel-run"
        val sessionId = "p9-cancel-session"
        val client = client()
        try {
            val results = listOf(
                submit(client, runId, sessionId, 0, PythonRuntimeMessageType.START_RUN,
                    JSONObject().put("input", "Stream until cancelled").put("model_id", "probe-model")),
                submit(client, runId, sessionId, 1, PythonRuntimeMessageType.MODEL_CHUNK,
                    JSONObject().put("delta", "partial")),
                submit(client, runId, sessionId, 2, PythonRuntimeMessageType.CANCEL_RUN,
                    JSONObject().put("reason", "user_cancelled")),
            )
            val envelopes = results.flatMap(::runtimeEvents)
            val kinds = envelopes.map { it.getJSONObject("payload").getString("kind") }
            assertEquals(1, kinds.count { it == "run.cancelled" })
            assertFalse(kinds.any { it == "run.completed" || it == "run.failed" })

            val writer = AndroidOaepWriter(
                AndroidOaepScope("local", sessionId, runId, "android-agent", "android-local"),
                "2026-08-12T00:00:00Z",
            )
            envelopes.forEachIndexed { index, envelope ->
                val normalized = PythonRuntimeEventMapper.decodeAll(
                    PythonRuntimeEnvelope.fromJson(envelope.toString()),
                )
                if (normalized.isNotEmpty()) {
                    writer.applyAll("cancel:$index", normalized, "2026-08-12T00:00:0${index + 1}Z")
                }
            }
            assertTrue(envelopes.flatMap {
                PythonRuntimeEventMapper.decodeAll(PythonRuntimeEnvelope.fromJson(it.toString()))
            }.count { it is NormalizedAgentEvent.RunCancelled } == 1)
            assertEquals("cancelled", writer.state.snapshot().runs.single().status)
        } finally {
            client.releaseSessionRun(sessionId, runId)
            client.close()
        }
    }

    @Test
    fun activeStreamSurvivesHomeAndForegroundWithoutAnr(): Unit = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val runId = "p9-background-run"
        val sessionId = "p9-background-session"
        val beforeAnr = shell("dumpsys activity lastanr")
        shell("am start -W -n ${BuildConfig.APPLICATION_ID}/ai.drsai.remote.MainActivity")
        instrumentation.waitForIdleSync()
        val client = client()
        try {
            submit(client, runId, sessionId, 0, PythonRuntimeMessageType.START_RUN,
                JSONObject().put("input", "Continue while backgrounded").put("model_id", "probe-model"))
            submit(client, runId, sessionId, 1, PythonRuntimeMessageType.MODEL_CHUNK,
                JSONObject().put("delta", "before-background"))
            shell("input keyevent KEYCODE_HOME")
            Thread.sleep(300)
            val backgroundLatency = measureTimeMillis {
                val chunk = submit(client, runId, sessionId, 2, PythonRuntimeMessageType.MODEL_CHUNK,
                    JSONObject().put("delta", "during-background"))
                assertEquals(listOf("message.delta"), runtimeEvents(chunk).map {
                    it.getJSONObject("payload").getString("kind")
                })
            }
            assertTrue("background binder response took ${backgroundLatency}ms", backgroundLatency < 5_000)
            shell("am start -W -n ${BuildConfig.APPLICATION_ID}/ai.drsai.remote.MainActivity")
            instrumentation.waitForIdleSync()
            val completed = submit(client, runId, sessionId, 3, PythonRuntimeMessageType.MODEL_COMPLETED,
                JSONObject().put("content", "finished"))
            val terminal = runtimeEvents(completed).map { it.getJSONObject("payload").getString("kind") }
            assertEquals(1, terminal.count { it == "run.completed" })
            assertFalse(terminal.any { it == "run.failed" || it == "run.cancelled" })
            assertNotNull(client.runtimeIdentity())
            val afterAnr = shell("dumpsys activity lastanr")
            assertTrue(
                "new app ANR observed: $afterAnr",
                afterAnr == beforeAnr || !afterAnr.contains(BuildConfig.APPLICATION_ID),
            )
        } finally {
            client.releaseSessionRun(sessionId, runId)
            client.close()
        }
    }

    private fun client() = PythonRuntimeClient(
        ApplicationProvider.getApplicationContext<Context>(), idleTimeoutMs = -1,
    )

    private suspend fun submit(
        client: PythonRuntimeClient,
        runId: String,
        sessionId: String,
        sequence: Long,
        type: PythonRuntimeMessageType,
        payload: JSONObject,
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

    private fun shell(command: String): String =
        InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command).use { descriptor ->
            FileInputStream(descriptor.fileDescriptor).bufferedReader().use { it.readText() }
        }
}
