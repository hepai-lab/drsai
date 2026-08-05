package ai.drsai.remote

import ai.drsai.remote.data.*
import ai.drsai.remote.runtime.python.HaiPythonModelHostPort
import ai.drsai.remote.runtime.python.HostModelRequest
import ai.drsai.remote.runtime.python.PythonApprovalGrantTracker
import ai.drsai.remote.runtime.python.ScopedPythonArtifactHostPort
import java.io.File
import java.lang.reflect.Proxy
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidPythonHostAdaptersTest {
    @Test
    fun `HAI adapter preserves messages and assembles streamed tool call`() = runTest {
        val gateway = FakeModelGateway()
        val chunks = HaiPythonModelHostPort(gateway).stream(
            HostModelRequest(
                "request-1",
                "model-1",
                JSONArray()
                    .put(JSONObject().put("role", "user").put("content", "time"))
                    .put(
                        JSONObject().put("role", "assistant").put("content", "").put(
                            "tool_calls",
                            JSONArray().put(
                                JSONObject().put("call_id", "old").put("name", "clock")
                                    .put("arguments", JSONObject()),
                            ),
                        )
                    ),
                JSONArray().put(
                    JSONObject().put("name", "clock").put("requires_approval", true)
                        .put("risk", "sensitive").put("title", "Clock access").put("summary", "Read clock"),
                ),
            )
        ).toList()

        assertEquals("hello", chunks.first().delta)
        assertEquals("call-1", chunks.last().toolCalls.getJSONObject(0).getString("call_id"))
        assertEquals("clock", chunks.last().toolCalls.getJSONObject(0).getString("name"))
        assertEquals(1, chunks.last().toolCalls.getJSONObject(0).getJSONObject("arguments").getInt("zone"))
        assertTrue(chunks.last().toolCalls.getJSONObject(0).getBoolean("requires_approval"))
        assertEquals("sensitive", chunks.last().toolCalls.getJSONObject(0).getString("risk"))
        assertTrue(gateway.toolsEnabled)
        assertEquals("clock", gateway.toolSchemas.getJSONObject(0).getString("name"))
        assertEquals("old", gateway.messages[1].toolCalls.single().id)
    }

    @Test
    fun `approval grants are one shot`() {
        val grants = PythonApprovalGrantTracker()
        grants.approve("call-1")
        assertTrue(grants.consume("call-1"))
        assertEquals(false, grants.consume("call-1"))
    }

    @Test
    fun `tool schema rejection retries same model request as pure chat before any delta`() = runTest {
        val gateway = FakeModelGateway().apply { rejectToolsOnce = true }
        val chunks = HaiPythonModelHostPort(gateway).stream(
            HostModelRequest(
                "request-2", "model-1",
                JSONArray().put(JSONObject().put("role", "user").put("content", "hello")),
                JSONArray().put(JSONObject().put("name", "clock")),
            )
        ).toList()

        assertEquals(listOf(1, 0), gateway.requestedToolCounts)
        assertEquals("hello", chunks.first().delta)
    }

    @Test
    fun `partial stream and retryable server failures are never silently replayed by model adapter`() = runTest {
        val partial = FakeModelGateway().apply { failAfterDelta = true }
        val partialError = runCatching {
            HaiPythonModelHostPort(partial).stream(
                HostModelRequest("partial", "model-1", JSONArray(), JSONArray().put(JSONObject().put("name", "clock")))
            ).toList()
        }.exceptionOrNull() as ApiException
        assertEquals(503, partialError.status)
        assertEquals(listOf(1), partial.requestedToolCounts)

        val throttled = FakeModelGateway().apply { failureBeforeDelta = ApiException(429, "rate limited") }
        val throttleError = runCatching {
            HaiPythonModelHostPort(throttled).stream(
                HostModelRequest("throttled", "model-1", JSONArray(), JSONArray().put(JSONObject().put("name", "clock")))
            ).toList()
        }.exceptionOrNull() as ApiException
        assertEquals(429, throttleError.status)
        assertEquals(listOf(1), throttled.requestedToolCounts)
    }

    @Test
    fun `scoped artifact port reads only opaque attachment identity in bounded chunks`() = runTest {
        val file = File.createTempFile("python-artifact", ".txt").apply { writeText("hello world") }
        try {
            val dao = Proxy.newProxyInstance(
                ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java),
            ) { _, _, _ -> null } as ChatDao
            val port = ScopedPythonArtifactHostPort(
                dao, "subject-1", "run-1", "session-1",
                listOf(
                    MessageAttachment(
                        "opaque-1", "message-1", "session-1", name = "note.txt",
                        mimeType = "text/plain", size = file.length(), kind = "file", localPath = file.absolutePath,
                    )
                ),
            )

            val descriptor = port.describe("opaque-1")
            val chunk = port.readChunk("opaque-1", 6, 5)

            assertEquals(11, descriptor.size)
            assertEquals("world", chunk.decodeToString())
            assertEquals(64, descriptor.sha256.length)
        } finally {
            file.delete()
        }
    }

    private class FakeModelGateway : ModelGateway {
        var messages = emptyList<RuntimeMessage>()
        var toolsEnabled = false
        var toolSchemas = JSONArray()
        var rejectToolsOnce = false
        var failAfterDelta = false
        var failureBeforeDelta: ApiException? = null
        val requestedToolCounts = mutableListOf<Int>()
        override suspend fun listModels() = listOf(ModelInfo("model-1", "Model", false))
        override fun selectModel(models: List<ModelInfo>) = models.single()
        override suspend fun streamCompletion(
            model: String,
            messages: List<RuntimeMessage>,
            toolsEnabled: Boolean,
            onDelta: suspend (ModelDelta) -> Unit,
        ) {
            this.messages = messages
            this.toolsEnabled = toolsEnabled
            onDelta(ModelDelta("hello", listOf(ToolCallDelta(0, "call-1", "clock", "{\"zone\":")), null))
            onDelta(ModelDelta(null, listOf(ToolCallDelta(0, null, null, "1}")), "tool_calls"))
        }
        override suspend fun streamCompletionWithTools(
            model: String,
            messages: List<RuntimeMessage>,
            tools: JSONArray,
            onDelta: suspend (ModelDelta) -> Unit,
        ) {
            requestedToolCounts += tools.length()
            failureBeforeDelta?.let { throw it }
            if (rejectToolsOnce && tools.length() > 0) {
                rejectToolsOnce = false
                throw ApiException(400, "tools unsupported", false)
            }
            toolSchemas = tools
            streamCompletion(model, messages, tools.length() > 0, onDelta)
            if (failAfterDelta) throw ApiException(503, "stream disconnected")
        }
        override fun cancelActive() = Unit
        override suspend fun logout() = Unit
    }
}
