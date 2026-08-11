package ai.drsai.remote

import ai.drsai.remote.data.*
import ai.drsai.remote.runtime.python.HaiPythonModelHostPort
import ai.drsai.remote.runtime.python.HostModelRequest
import ai.drsai.remote.runtime.python.ModelRuntimeCapabilities
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
                        .put("risk", "sensitive").put("title", "Clock access").put("summary", "Read clock")
                        .put("oaep_output_type", "command_execution"),
                ),
            )
        ).toList()

        assertEquals("hello", chunks.first().delta)
        assertEquals("call-1", chunks.last().toolCalls.getJSONObject(0).getString("call_id"))
        assertEquals("clock", chunks.last().toolCalls.getJSONObject(0).getString("name"))
        assertEquals(1, chunks.last().toolCalls.getJSONObject(0).getJSONObject("arguments").getInt("zone"))
        assertTrue(chunks.last().toolCalls.getJSONObject(0).getBoolean("requires_approval"))
        assertEquals("command_execution", chunks.last().toolCalls.getJSONObject(0).getString("oaep_output_type"))
        assertEquals("Public reasoning summary", chunks.single { it.reasoningSummary.isNotEmpty() }.reasoningSummary)
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
    fun `tool schema rejection fails visibly without pure chat retry`() = runTest {
        val gateway = FakeModelGateway().apply { rejectToolsOnce = true }
        val error = runCatching {
            HaiPythonModelHostPort(gateway).stream(
                HostModelRequest(
                    "request-2", "model-1",
                    JSONArray().put(JSONObject().put("role", "user").put("content", "hello")),
                    JSONArray().put(JSONObject().put("name", "clock")),
                )
            ).toList()
        }.exceptionOrNull() as ApiException

        assertEquals(listOf(1), gateway.requestedToolCounts)
        assertEquals(400, error.status)
        assertEquals("model_tools_unsupported", error.code)
        assertTrue(error.message.startsWith("model_tools_unsupported:model-1:"))
    }

    @Test
    fun `known no-tools capability blocks before provider invocation`() = runTest {
        val gateway = FakeModelGateway()
        val profile = ModelRuntimeCapabilities("chat-only", "openai", false, false, false, "configured")

        val error = runCatching {
            HaiPythonModelHostPort(gateway) { profile }.stream(
                HostModelRequest(
                    "preflight", "chat-only", JSONArray(),
                    JSONArray().put(JSONObject().put("name", "clock")),
                ),
            ).toList()
        }.exceptionOrNull() as ApiException

        assertEquals("model_tools_unsupported", error.code)
        assertTrue(gateway.requestedToolCounts.isEmpty())
    }

    @Test
    fun `multiple streamed tool calls require explicit parallel capability`() = runTest {
        val gateway = FakeModelGateway().apply { emitParallelCalls = true }
        val profile = ModelRuntimeCapabilities("serial-tools", "openai", true, false, false, "probe")

        val error = runCatching {
            HaiPythonModelHostPort(gateway) { profile }.stream(
                HostModelRequest(
                    "parallel", "serial-tools", JSONArray(),
                    JSONArray().put(JSONObject().put("name", "clock")),
                ),
            ).toList()
        }.exceptionOrNull() as ApiException

        assertEquals("model_parallel_tools_unsupported", error.code)
        assertEquals(listOf(1), gateway.requestedToolCounts)
    }

    @Test
    fun `shared Kernel tool choice policy reaches production-aware gateway`() = runTest {
        val gateway = FakeModelGateway()
        val choice = JSONObject().put("policy_version", "p9-tool-choice-v1")
            .put("mode", "specified").put("specified_tool", "clock")

        HaiPythonModelHostPort(gateway).stream(
            HostModelRequest(
                "choice", "model-1", JSONArray(),
                JSONArray().put(JSONObject().put("name", "clock")), choice,
            ),
        ).toList()

        assertEquals("specified", gateway.toolChoice?.getString("mode"))
        assertEquals("clock", gateway.toolChoice?.getString("specified_tool"))
    }

    @Test
    fun `pinned model route reaches gateway unchanged`() = runTest {
        val gateway = FakeModelGateway()
        val route = PinnedModelRoute.create(
            "model-1", "provider", "vendor/original", "https://api.example/v1", "openai", 3, "api_key",
        )

        HaiPythonModelHostPort(gateway).stream(
            HostModelRequest(
                "pinned", "model-1", JSONArray(),
                JSONArray().put(JSONObject().put("name", "clock")),
                modelRouteSnapshot = route,
            ),
        ).toList()

        assertEquals(route.toString(), gateway.modelRouteSnapshot?.toString())
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

    @Test
    fun `scoped tool output artifact exposes text metadata without storage path`() = runTest {
        val row = ToolArtifactEntity(
            "opaque-tool-1", "subject-1", "run-1", "session-1", "call-1", "clock",
            "complete tool output", 1L,
        )
        val dao = Proxy.newProxyInstance(
            ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java),
        ) { _, method, _ -> if (method.name == "toolArtifacts") listOf(row) else null } as ChatDao
        val port = ScopedPythonArtifactHostPort(dao, "subject-1", "run-1", "session-1", emptyList())

        val descriptor = port.describe("opaque-tool-1")
        val chunk = port.readChunk("opaque-tool-1", 0, 64)

        assertEquals("text/plain", descriptor.mimeType)
        assertEquals("complete tool output", chunk.decodeToString())
        assertEquals(64, descriptor.sha256.length)
    }

    private class FakeModelGateway : ModelGateway, ToolChoiceAwareModelGateway, PinnedModelRouteGateway {
        var messages = emptyList<RuntimeMessage>()
        var toolsEnabled = false
        var toolSchemas = JSONArray()
        var rejectToolsOnce = false
        var failAfterDelta = false
        var failureBeforeDelta: ApiException? = null
        var emitParallelCalls = false
        var toolChoice: JSONObject? = null
        var modelRouteSnapshot: JSONObject? = null
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
            onDelta(ModelDelta(null, emptyList(), null, reasoningSummary = "Public reasoning summary"))
            onDelta(ModelDelta(null, listOf(ToolCallDelta(0, null, null, "1}")), "tool_calls"))
            if (emitParallelCalls) {
                onDelta(ModelDelta(null, listOf(ToolCallDelta(1, "call-2", "clock", "{\"zone\":2}")), "tool_calls"))
            }
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
        override suspend fun streamCompletionWithToolChoice(
            model: String,
            messages: List<RuntimeMessage>,
            tools: JSONArray,
            toolChoice: JSONObject,
            onDelta: suspend (ModelDelta) -> Unit,
        ) {
            this.toolChoice = JSONObject(toolChoice.toString())
            streamCompletionWithTools(model, messages, tools, onDelta)
        }
        override suspend fun pinModelRoute(modelId: String) = error("not_used")
        override suspend fun streamCompletionWithPinnedRoute(
            modelId: String,
            route: JSONObject,
            messages: List<RuntimeMessage>,
            tools: JSONArray,
            toolChoice: JSONObject,
            onDelta: suspend (ModelDelta) -> Unit,
        ) {
            modelRouteSnapshot = JSONObject(route.toString())
            streamCompletionWithToolChoice(modelId, messages, tools, toolChoice, onDelta)
        }
        override fun cancelActive() = Unit
        override suspend fun logout() = Unit
    }
}
