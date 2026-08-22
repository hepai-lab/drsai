package ai.drsai.remote

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P9ProductionBehaviorParityInstrumentedTest {
    @Test fun bundledAndroidRuntimeMatchesDesktopProductionBehaviorFixture() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets
            .open("p9-production-behavior-parity-v1.json")
            .bufferedReader().use { JSONObject(it.readText()) }
        val identity = fixture.getJSONObject("identity")
        val tool = JSONObject(fixture.getJSONObject("tool").toString()).apply { remove("schema_sha256") }
        val runId = "p9-production-parity-android"
        val sessionId = "p9-production-parity-session"
        val client = PythonRuntimeClient(context)
        val kinds = mutableListOf<String>()
        try {
            val started = command(client, runId, sessionId, PythonRuntimeMessageType.START_RUN, 0, JSONObject()
                .put("input", fixture.getString("input"))
                .put("model_id", "fixture-model")
                .put("tools", JSONArray().put(tool)))
            kinds += runtimeKinds(started)
            val outbound = started.getJSONArray("outbound")
            val checkpoint = (0 until outbound.length()).map(outbound::getJSONObject)
                .first { it.getString("message_type") == "checkpoint_request" }
                .getJSONObject("payload").getJSONObject("state")
            assertEquals(
                fixture.getJSONObject("tool").getString("schema_sha256"),
                checkpoint.getJSONObject("model_tool_snapshot").getJSONArray("tools")
                    .getJSONObject(0).getString("schema_sha256"),
            )
            assertEquals(
                fixture.getString("skill_manifest_sha256"),
                sha256(checkpoint.getJSONArray("skills").toString()),
            )
            val runtimeIdentity = requireNotNull(client.runtimeIdentity())
            assertEquals(identity.getString("kernel_id"), runtimeIdentity.kernelId)
            assertEquals(identity.getString("kernel_version"), runtimeIdentity.kernelVersion)
            assertEquals(identity.getString("kernel_sha256"), runtimeIdentity.kernelSha256)
            assertEquals(identity.getString("prompt_version"), runtimeIdentity.promptVersion)
            assertEquals(identity.getString("base_prompt_sha256"), runtimeIdentity.promptSha256)

            kinds += runtimeKinds(command(client, runId, sessionId, PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                JSONObject().put("tool_calls", JSONArray().put(JSONObject()
                    .put("call_id", "echo-1").put("name", "parity.echo")
                    .put("arguments", JSONObject().put("text", "hello"))))))
            kinds += runtimeKinds(command(client, runId, sessionId, PythonRuntimeMessageType.TOOL_RESULT, 2,
                JSONObject().put("call_id", "echo-1").put("succeeded", true)
                    .put("content", JSONObject().put("content", "hello"))))
            kinds += runtimeKinds(command(client, runId, sessionId, PythonRuntimeMessageType.MODEL_COMPLETED, 3,
                JSONObject().put("content", fixture.getString("final_text"))))

            val expected = fixture.getJSONArray("expected_semantic_events")
            // Desktop's high-level projection intentionally omits the final-message
            // detail event. Android retains it for the OAEP event timeline while
            // preserving the same cross-platform semantic sequence.
            assertEquals(
                (0 until expected.length()).map(expected::getString),
                kinds.filterNot { it == "message.completed" },
            )
            assertEquals(1, kinds.count { it == "message.completed" })
            assertTrue(kinds.indexOf("message.completed") < kinds.indexOf("run.completed"))
            assertTrue(kinds.last() == "run.completed")
        } finally {
            client.close()
        }
    }

    private suspend fun command(
        client: PythonRuntimeClient,
        runId: String,
        sessionId: String,
        type: PythonRuntimeMessageType,
        sequence: Long,
        payload: JSONObject,
    ): JSONObject = client.submit(PythonRuntimeEnvelope(
        type, "$runId:$sequence", runId, sessionId, sequence, "$runId:key:$sequence", payload,
    )).also { assertEquals("accepted", it.getString("decision")) }
        .getJSONObject("python_result")

    private fun runtimeKinds(result: JSONObject): List<String> {
        val outbound = result.getJSONArray("outbound")
        return (0 until outbound.length()).map(outbound::getJSONObject)
            .filter { it.getString("message_type") == "runtime_event" }
            .map { it.getJSONObject("payload").getString("kind") }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}
