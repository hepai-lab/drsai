package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.runtime.setup.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class FirstTaskJourneyInstrumentedTest {
    @Test fun newUserCompletesChatRetrievalAndSafeLocalExampleWithinThreeMinutes(): Unit = runBlocking {
        val startedAt = android.os.SystemClock.elapsedRealtime()
        val runtime = PythonRuntimeClient(ApplicationProvider.getApplicationContext<Context>(), idleTimeoutMs = -1)
        try {
            runtime.bind()
            val results = FirstTaskExamples.all.mapIndexed { index, example ->
                execute(runtime, "first-task-$index-${UUID.randomUUID()}", example)
            }
            assertEquals(3, results.size)
            assertTrue("first chat produced no answer: ${results[0].eventKinds}", results[0].answer.isNotBlank())
            assertEquals(emptyList<String>(), results[0].tools)
            assertEquals(listOf("web.search"), results[1].tools)
            assertTrue(results[1].answer.contains("https://www.hepix.org/"))
            assertEquals(listOf("get_device_info"), results[2].tools)
            assertTrue(results[2].answer.contains("Android 15"))
            assertTrue(results.all { it.completed && !it.failed })
            assertTrue(android.os.SystemClock.elapsedRealtime() - startedAt < 180_000L)
        } finally {
            runtime.close()
        }
    }

    private suspend fun execute(
        runtime: PythonRuntimeClient, runId: String, example: FirstTaskExample,
    ): JourneyResult {
        val prompt = ApplicationProvider.getApplicationContext<Context>().getString(example.prompt)
        require(prompt.isNotBlank()) { "first_task_prompt_blank" }
        var checkpoint: HostCheckpoint? = null
        val selected = mutableListOf<String>()
        val ports = PythonRuntimeHostPorts(
            model = ExampleModel(example.requiredTool),
            stateStore = object : PythonStateStoreHostPort {
                override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
                override suspend fun loadCheckpoint(runId: String) = checkpoint?.takeIf { it.runId == runId }
            },
            tools = object : PythonToolHostPort {
                override fun authoritativeRisk(toolName: String) = "read_only"
                override suspend fun execute(call: HostToolCall): HostToolResult {
                    selected += call.name
                    val content = when (call.name) {
                        "web.search" -> JSONObject().put("items", JSONArray().put(JSONObject()
                            .put("title", "HEPiX").put("url", "https://www.hepix.org/").put("snippet", "HEPiX forum")))
                        "get_device_info" -> JSONObject().put("platform", "Android").put("version", "15")
                        else -> error("unexpected_first_task_tool")
                    }
                    return HostToolResult(call.callId, true, content)
                }
            },
            approval = object : PythonApprovalHostPort {
                override suspend fun request(request: HostApprovalRequest) = error("first_task_approval_forbidden")
            },
            artifacts = object : PythonArtifactHostPort {
                override suspend fun describe(artifactId: String) = error("first_task_artifact_forbidden")
                override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = error("first_task_artifact_forbidden")
            },
            lifecycle = object : PythonLifecycleHostPort {
                override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
            },
        )
        val tools = JSONArray().apply {
            example.requiredTool?.let { name ->
                put(JSONObject().put("name", name).put("version", 1).put("source", "android-host")
                    .put("classification", "local-equivalent").put("description", name)
                    .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
                    .put("required_capabilities", JSONArray()).put("risk", "read_only").put("requires_approval", false))
            }
        }
        val start = PythonRuntimeEnvelope(
            PythonRuntimeMessageType.START_RUN, "$runId:start", runId, "$runId:session", 0, "$runId:start",
            JSONObject().put("input", prompt).put("model_id", "first-task-model")
                .put("host_capabilities", JSONArray(listOf("chat", "streaming"))).put("tools", tools),
        )
        val events = PythonAgentLoopCoordinator(runtime, ports).execute(start).toList()
        return JourneyResult(
            events.lastOrNull { it.payload.optString("kind") == "message.completed" }
                ?.payload?.optString("text").orEmpty(),
            selected,
            events.any { it.payload.optString("kind") == "run.completed" },
            events.any { it.payload.optString("kind") in setOf("run.failed", "run.cancelled") },
            events.map { it.payload.optString("kind") },
        )
    }

    private class ExampleModel(private val tool: String?) : PythonModelHostPort {
        private var first = true
        override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
            if (tool != null && first) {
                first = false
                return flowOf(HostModelChunk(request.requestId, finishReason = "tool_calls", toolCalls = JSONArray().put(
                    JSONObject().put("call_id", "example-call").put("name", tool).put("arguments", JSONObject()),
                )))
            }
            val answer = when (tool) {
                "web.search" -> "HEPiX 是高能物理计算社区。[https://www.hepix.org/]"
                "get_device_info" -> "当前设备运行 Android 15。"
                else -> "我可以在 Android 上对话、检索并使用安全工具。"
            }
            return flowOf(HostModelChunk(request.requestId, answer, "stop"))
        }
    }

    private data class JourneyResult(
        val answer: String, val tools: List<String>, val completed: Boolean, val failed: Boolean,
        val eventKinds: List<String>,
    )
}
