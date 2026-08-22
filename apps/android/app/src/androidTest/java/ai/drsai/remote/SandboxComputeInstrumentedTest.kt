package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SandboxComputeInstrumentedTest {
    @Test fun bundledChaquopyCoreRunsDeclarativeComputeWithoutHostToolRequest() = runBlocking {
        val nonce = UUID.randomUUID().toString()
        val client = PythonRuntimeClient(ApplicationProvider.getApplicationContext<Context>())
        try {
            fun envelope(type: PythonRuntimeMessageType, sequence: Long, payload: JSONObject) = PythonRuntimeEnvelope(
                type, "$nonce-request-$sequence", "$nonce-run", "$nonce-session", sequence, "$nonce:$sequence", payload,
            )
            val started = client.submit(envelope(PythonRuntimeMessageType.START_RUN, 0, JSONObject()
                .put("input", "calculate median").put("model_id", "probe-model")
                .put("tools", FullRuntimeToolCatalog.schemas(JSONArray()))))
            assertEquals("accepted", started.getString("decision"))
            val computed = client.submit(envelope(PythonRuntimeMessageType.MODEL_COMPLETED, 1, JSONObject()
                .put("tool_calls", JSONArray().put(JSONObject()
                    .put("call_id", "compute-1").put("name", "core.data_compute")
                    .put("arguments", JSONObject().put("operation", "median").put("values", JSONArray(listOf(9, 1, 3))))))))
                .getJSONObject("python_result").getJSONArray("outbound")
            val messages = (0 until computed.length()).map(computed::getJSONObject)
            val result = messages.first { it.optJSONObject("payload")?.optString("kind") == "tool.result" }
                .getJSONObject("payload").getJSONObject("result")
            assertEquals(3.0, result.getDouble("result"), 0.0)
            assertTrue(messages.any { it.getString("message_type") == "model_request" })
            assertFalse(messages.any { it.getString("message_type") == "tool_call_request" })
        } finally {
            client.close()
        }
    }
}
