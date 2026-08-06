package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.MessageDigest
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
class P9NaturalMultiStepAgentE2ETest {
    @Test
    fun naturalTaskPlansSearchesReadsDelegatesCreatesArtifactAndCitesResults() = runBlocking {
        val operations = mutableListOf<String>()
        val artifactBytes = "HEPiX 2026 对比报告\n外部来源：https://www.hepix.org/\n本地基线：Android Full Runtime".toByteArray()
        var approvalCount = 0
        var checkpoint: HostCheckpoint? = null
        val ports = PythonRuntimeHostPorts(
            model = NaturalMultiStepModel(),
            stateStore = object : PythonStateStoreHostPort {
                override suspend fun saveCheckpoint(value: HostCheckpoint) { checkpoint = value }
                override suspend fun loadCheckpoint(runId: String) = checkpoint?.takeIf { it.runId == runId }
            },
            tools = object : PythonToolHostPort {
                override fun authoritativeRisk(toolName: String) =
                    if (toolName == "save_artifact") "sensitive" else "read_only"

                override suspend fun execute(call: HostToolCall): HostToolResult {
                    operations += call.name
                    return when (call.name) {
                        "web.search" -> HostToolResult(call.callId, true, JSONObject()
                            .put("query", call.arguments.getString("query"))
                            .put("items", JSONArray()
                                .put(JSONObject().put("title", "HEPiX Spring 2026").put("url", "https://www.hepix.org/")
                                    .put("snippet", "High Energy Physics Information Technology exchange"))))
                        "workspace.read" -> HostToolResult(call.callId, true, JSONObject()
                            .put("path", call.arguments.getString("path"))
                            .put("content", "本地基线：Android Full Runtime 支持 OAEP、工具和 Subagent。"))
                        "save_artifact" -> {
                            assertTrue("artifact creation must carry approval", call.approved)
                            HostToolResult(call.callId, true, JSONObject().put("saved", true), artifactIds = listOf(ARTIFACT_ID))
                        }
                        else -> error("unexpected_host_tool:${call.name}")
                    }
                }
            },
            approval = object : PythonApprovalHostPort {
                override suspend fun request(request: HostApprovalRequest): HostApprovalDecision {
                    approvalCount += 1
                    assertEquals("save_artifact", request.name)
                    return HostApprovalDecision(request.approvalId, "approved")
                }
            },
            artifacts = object : PythonArtifactHostPort {
                override suspend fun describe(artifactId: String): HostArtifactDescriptor {
                    assertEquals(ARTIFACT_ID, artifactId)
                    return HostArtifactDescriptor(artifactId, "text/markdown", artifactBytes.size.toLong(), sha256(artifactBytes))
                }

                override suspend fun readChunk(artifactId: String, offset: Long, length: Int) =
                    artifactBytes.copyOfRange(offset.toInt(), minOf(artifactBytes.size, offset.toInt() + length))
            },
            lifecycle = object : PythonLifecycleHostPort {
                override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
            },
        )

        val runtime = PythonRuntimeClient(ApplicationProvider.getApplicationContext<Context>())
        val events = try {
            PythonAgentLoopCoordinator(runtime, ports).execute(start()).toList()
        } finally {
            runtime.close()
        }
        val kinds = events.map { it.payload.optString("kind") }
        assertTrue("missing plan event: $kinds", kinds.any { it == "plan.started" || it == "plan.updated" })
        assertTrue("missing delegated work: $kinds", kinds.contains("subagent.started") && kinds.contains("subagent.completed"))
        assertTrue("missing artifact: $kinds", kinds.contains("artifact.created"))
        assertTrue("missing citation verification: $kinds", kinds.contains("citation.verified"))
        assertTrue("missing terminal: $kinds", kinds.contains("run.completed"))
        assertEquals(listOf("web.search", "workspace.read", "save_artifact"), operations)
        assertEquals(1, approvalCount)
        val finalText = events.single { it.payload.optString("kind") == "message.completed" }
            .payload.getString("text")
        assertTrue("final answer did not cite retrieved source: $finalText", finalText.contains("https://www.hepix.org/"))
        assertTrue("final answer did not cite local input: $finalText", finalText.contains("notes/android-runtime-baseline.md"))
        assertTrue("artifact identity absent from final answer: $finalText", finalText.contains(ARTIFACT_ID))
    }

    private fun start() = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN,
        "p9-natural-multistep-start",
        "p9-natural-multistep-run",
        "p9-natural-multistep-session",
        0,
        "p9-natural-multistep:start",
        JSONObject()
            .put("input", "检索 HEPiX 2026，和 notes/android-runtime-baseline.md 的本地方案比较；必要时委派一个研究子任务，最后生成报告文件并在答复中引用来源。")
            .put("model_id", "scripted-natural-multistep")
            .put("host_capabilities", JSONArray(listOf("chat", "streaming", "project_files", "approvals", "artifacts")))
            .put("tools", FullRuntimeToolCatalog.schemas(JSONArray(listOf(
                hostTool("web.search", "read_only", false),
                hostTool("workspace.read", "read_only", false),
                hostTool("save_artifact", "sensitive", true),
            )))),
    )

    private fun hostTool(name: String, risk: String, approval: Boolean) = JSONObject()
        .put("name", name).put("version", 1).put("source", "android-host")
        .put("classification", "local-equivalent").put("description", name)
        .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
        .put("required_capabilities", JSONArray()).put("risk", risk).put("requires_approval", approval)

    private class NaturalMultiStepModel : PythonModelHostPort {
        private var mainStep = 0

        override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
            val lastUser = (request.messages.length() - 1 downTo 0)
                .map { request.messages.getJSONObject(it) }
                .firstOrNull { it.optString("role") == "user" }
                ?.optString("content").orEmpty()
            if (lastUser.contains("核对 HEPiX 的性质")) {
                return flowOf(HostModelChunk(request.requestId, "子任务结论：HEPiX 是高能物理信息技术交流社区，2026 信息应以官网为准。", "stop"))
            }
            val response = when (mainStep++) {
                0 -> call("search-1", "web.search", JSONObject().put("query", "HEPiX 2026"))
                1 -> call("plan-1", "core.update_plan", JSONObject()
                    .put("expected_version", 0).put("text", "检索、读取、委派、生成报告")
                    .put("steps", JSONArray()
                        .put(JSONObject().put("title", "检索 HEPiX 2026").put("status", "completed"))
                        .put(JSONObject().put("title", "读取并比较本地基线").put("status", "in_progress"))
                        .put(JSONObject().put("title", "生成引用报告").put("status", "pending"))))
                2 -> call("read-1", "workspace.read", JSONObject().put("path", "notes/android-runtime-baseline.md"))
                3 -> call("delegate-1", "delegate", JSONObject().put("tasks", JSONArray().put(JSONObject()
                    .put("task_id", "hepix-research").put("type", "explore")
                    .put("prompt", "核对 HEPiX 的性质及 2026 信息来源").put("allowed_tools", JSONArray()))))
                4 -> call("artifact-1", "save_artifact", JSONObject().put("artifact_id", ARTIFACT_ID).put("format", "markdown"))
                else -> return flowOf(HostModelChunk(
                    request.requestId,
                    "已比较官网检索结果与 notes/android-runtime-baseline.md，并生成报告 $ARTIFACT_ID。来源：https://www.hepix.org/",
                    "stop",
                ))
            }
            return flowOf(HostModelChunk(request.requestId, finishReason = "tool_calls", toolCalls = JSONArray().put(response)))
        }

        private fun call(id: String, name: String, arguments: JSONObject) = JSONObject()
            .put("call_id", id).put("name", name).put("arguments", arguments)
    }

    companion object {
        private const val ARTIFACT_ID = "p9-hepix-2026-comparison-report"
        private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
            .digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
