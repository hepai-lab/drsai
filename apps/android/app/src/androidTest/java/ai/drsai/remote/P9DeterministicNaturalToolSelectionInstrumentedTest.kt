package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P9DeterministicNaturalToolSelectionInstrumentedTest {
    @Test
    fun thirtyNaturalTasksRepeatThreeTimesWithExactToolsTerminalAndOaep(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val suite = InstrumentationRegistry.getInstrumentation().context.assets
            .open("p9-natural-tool-selection-v1.json").bufferedReader(Charsets.UTF_8)
            .use { JSONObject(it.readText()) }
        val cases = suite.getJSONArray("cases")
        assertEquals(30, cases.length())
        var observations = 0
        val runtime = PythonRuntimeClient(context, idleTimeoutMs = -1)
        try {
            runtime.bind()
            repeat(cases.length()) { caseIndex ->
                val testCase = cases.getJSONObject(caseIndex)
                val expected = testCase.getJSONArray("expected_tools").let { values ->
                    (0 until values.length()).map(values::getString)
                }
                repeat(3) { attempt ->
                    val selected = mutableListOf<String>()
                    val ports = fixturePorts(expected.singleOrNull(), selected)
                    val runId = "p9-fixed-${testCase.getString("id")}-${attempt + 1}-${UUID.randomUUID()}"
                    val events = PythonAgentLoopCoordinator(runtime, ports).execute(
                        start(runId, testCase.getString("prompt")),
                    ).toList()
                    assertEquals("${testCase.getString("id")}:${attempt + 1}", expected, selected)
                    assertEquals(1, events.count { it.payload.optString("kind") == "run.completed" })
                    assertTrue(events.none { it.payload.optString("kind") == "run.failed" })
                    if (expected.isNotEmpty()) {
                        val kinds = events.map { it.payload.optString("kind") }
                        val label = "${testCase.getString("id")}:${attempt + 1}:" +
                            events.joinToString("|") { it.payload.toString() }
                        val startKind = if (expected.single() == "delegate") "subagent.started" else "tool.started"
                        assertTrue(label, kinds.contains(startKind))
                        assertTrue(label, events.any {
                            it.payload.optString("kind") in setOf("tool.result", "plan.started", "subagent.completed")
                        })
                    }
                    observations += 1
                }
            }
        } finally {
            runtime.close()
        }
        assertEquals(90, observations)
    }

    @Test
    fun ambiguousRequestAsksForClarificationWithoutCallingAnyTool(): Unit = runBlocking {
        val selected = mutableListOf<String>()
        val runtime = PythonRuntimeClient(ApplicationProvider.getApplicationContext<Context>())
        val events = try {
            PythonAgentLoopCoordinator(runtime, fixturePorts(null, selected, clarification = true))
                .execute(start("p9-fixed-clarification", "请帮我处理一下")).toList()
        } finally {
            runtime.close()
        }
        assertTrue(selected.isEmpty())
        assertTrue(events.none { it.payload.optString("kind") == "tool.started" })
        val answer = events.single { it.payload.optString("kind") == "message.completed" }.payload.getString("text")
        assertTrue(answer.endsWith("？"))
        assertEquals(1, events.count { it.payload.optString("kind") == "run.completed" })
    }

    private fun fixturePorts(
        expectedTool: String?, selected: MutableList<String>, clarification: Boolean = false,
    ) = PythonRuntimeHostPorts(
        model = FixtureModel(expectedTool, selected, clarification),
        stateStore = object : PythonStateStoreHostPort {
            private var checkpoint: HostCheckpoint? = null
            override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
            override suspend fun loadCheckpoint(runId: String) = checkpoint?.takeIf { it.runId == runId }
        },
        tools = object : PythonToolHostPort {
            override fun authoritativeRisk(toolName: String) =
                if (toolName == "workspace.write") "external_write" else "read_only"
            override suspend fun execute(call: HostToolCall): HostToolResult {
                val content = when (call.name) {
                    "get_current_time" -> JSONObject().put("time", "2026-08-12T12:00:00+08:00")
                    "get_device_info" -> JSONObject().put("platform", "android").put("api", 35)
                    "save_memory" -> JSONObject().put("saved", true).put("id", 1)
                    "search_memory" -> JSONObject().put("items", JSONArray().put(JSONObject()
                        .put("id", 1).put("source_id", "memory:1").put("content", "fixture preference")))
                    "workspace.list" -> JSONObject().put("entries", JSONArray(listOf("README.md", "docs")))
                    "workspace.read" -> JSONObject().put("path", "README.md").put("content", "fixture content")
                    "workspace.search" -> JSONObject().put("matches", JSONArray().put(JSONObject().put("path", "settings.gradle.kts")))
                    "workspace.write" -> JSONObject().put("operation", "write").put("path", "notes/p9.txt")
                        .put("before_sha256", "missing").put("after_sha256", "a".repeat(64)).put("diff", "+fixture")
                    else -> error("unexpected_host_tool:${call.name}")
                }
                return HostToolResult(call.callId, true, content)
            }
        },
        approval = object : PythonApprovalHostPort {
            override suspend fun request(request: HostApprovalRequest) =
                HostApprovalDecision(request.approvalId, "approved")
        },
        artifacts = object : PythonArtifactHostPort {
            override suspend fun describe(artifactId: String) = error("artifact_not_expected")
            override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = error("artifact_not_expected")
        },
        lifecycle = object : PythonLifecycleHostPort {
            override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
        },
    )

    private fun start(runId: String, prompt: String) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "$runId-start", runId, "$runId-session", 0, "$runId:start",
        JSONObject().put("input", prompt).put("model_id", "p9-fixed-model")
            .put("host_capabilities", JSONArray(listOf("chat", "streaming", "local_memory", "project_files", "approvals")))
            .put("tools", JSONArray(TOOL_NAMES.map(::toolSchema))),
    )

    private fun toolSchema(name: String): JSONObject {
        val risk = if (name == "workspace.write") "external_write" else "read_only"
        val source = if (name.startsWith("core.") || name == "delegate") "shared-core" else "android-host"
        return JSONObject().put("name", name).put("version", 1).put("source", source)
            .put("classification", if (source == "shared-core") "shared" else "local-equivalent")
            .put("description", name).put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
            .put("required_capabilities", JSONArray()).put("risk", risk)
            .put("requires_approval", name == "workspace.write")
            .apply { if (name == "workspace.write") put("oaep_output_type", "file_change") }
    }

    private class FixtureModel(
        private val expectedTool: String?, private val selected: MutableList<String>, private val clarification: Boolean,
    ) : PythonModelHostPort {
        private var emittedMainTool = false

        override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
            val lastUser = (request.messages.length() - 1 downTo 0).map { request.messages.getJSONObject(it) }
                .firstOrNull { it.optString("role") == "user" }?.optString("content").orEmpty()
            if (lastUser == "fixture child task") {
                return flowOf(HostModelChunk(request.requestId, "fixture child result", "stop"))
            }
            if (clarification) return flowOf(HostModelChunk(request.requestId, "请说明要处理的对象和期望结果？", "stop"))
            if (expectedTool == null) return flowOf(HostModelChunk(request.requestId, "fixture direct answer", "stop"))
            if (!emittedMainTool) {
                emittedMainTool = true
                val arguments = arguments(expectedTool)
                selected += expectedTool
                return flowOf(HostModelChunk(request.requestId, finishReason = "tool_calls", toolCalls = JSONArray().put(
                    JSONObject().put("call_id", "fixture-call").put("name", expectedTool).put("arguments", arguments),
                )))
            }
            val source = if (expectedTool == "search_memory") " [memory:1]" else ""
            return flowOf(HostModelChunk(request.requestId, "fixture grounded answer$source", "stop"))
        }

        private fun arguments(name: String) = when (name) {
            "save_memory" -> JSONObject().put("content", "fixture preference").put("label", "preference")
            "search_memory" -> JSONObject().put("query", "preference")
            "workspace.list" -> JSONObject().put("path", "")
            "workspace.read" -> JSONObject().put("path", "README.md")
            "workspace.search" -> JSONObject().put("query", "settings.gradle")
            "workspace.write" -> JSONObject().put("path", "notes/p9.txt").put("content", "fixture")
            "core.text_stats" -> JSONObject().put("text", "one two\nthree")
            "core.update_plan" -> JSONObject().put("expected_version", 0).put("text", "fixture plan")
                .put("steps", JSONArray().put(JSONObject().put("id", "one").put("title", "Fixture").put("status", "completed")))
            "delegate" -> JSONObject().put("tasks", JSONArray().put(JSONObject()
                .put("task_id", "fixture-child").put("prompt", "fixture child task").put("allowed_tools", JSONArray())))
            else -> JSONObject()
        }
    }

    companion object {
        private val TOOL_NAMES = listOf(
            "get_current_time", "get_device_info", "save_memory", "search_memory",
            "workspace.list", "workspace.read", "workspace.search", "workspace.write",
            "core.text_stats", "core.update_plan", "delegate",
        )
    }
}
