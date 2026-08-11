package ai.drsai.remote

import ai.drsai.remote.runtime.device.WorkspaceMutationJournal
import ai.drsai.remote.runtime.device.WorkspaceMutationPlanner
import ai.drsai.remote.runtime.python.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.Closeable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkspaceNaturalTaskInstrumentedTest {
    @Test fun naturalWorkspaceTaskListsSearchesReadsEditsApprovesVerifiesAndRecovers() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val workspace = linkedMapOf("config/app.properties" to "feature.enabled=false\nname=OpenDrSai\n")
        val operations = mutableListOf<String>()
        val audits = mutableListOf<String>()
        val journal = WorkspaceMutationJournal()
        var approvalCount = 0
        var diffPreview = ""
        var checkpoint: HostCheckpoint? = null
        var pauseOnce = true

        val stateStore = object : PythonStateStoreHostPort {
            override suspend fun saveCheckpoint(value: HostCheckpoint) {
                checkpoint = value
                if (pauseOnce && operations.size == 3 && value.state.has("phase")) {
                    pauseOnce = false
                    throw ExpectedRuntimeRestart()
                }
            }
            override suspend fun loadCheckpoint(runId: String) = checkpoint
        }
        val ports = PythonRuntimeHostPorts(
            model = NaturalWorkspaceModel(),
            stateStore = stateStore,
            tools = object : PythonToolHostPort {
                override fun authoritativeRisk(toolName: String) =
                    if (toolName == "workspace.edit") "external_write" else "read_only"

                override suspend fun execute(call: HostToolCall): HostToolResult {
                    operations += call.name
                    val content = when (call.name) {
                        "workspace.list" -> JSONObject().put("entries", JSONArray(workspace.keys.toList()))
                        "workspace.search" -> JSONObject().put("matches", JSONArray().put(JSONObject()
                            .put("path", "config/app.properties").put("line", 1)
                            .put("text", "feature.enabled=false")))
                        "workspace.read" -> JSONObject().put("path", call.arguments.getString("path"))
                            .put("content", workspace.getValue(call.arguments.getString("path")))
                        "workspace.edit" -> {
                            assertTrue("write must carry durable approval", call.approved)
                            val path = call.arguments.getString("path")
                            val before = workspace.getValue(path)
                            val oldText = call.arguments.getString("old_text")
                            val after = before.replace(oldText, call.arguments.getString("new_text"))
                            assertNotEquals("edit target must exist exactly once", before, after)
                            val plan = WorkspaceMutationPlanner.plan("edit", path, before, after)
                            diffPreview = plan.previewJson()
                            journal.prepare("instrumentation-user", call.callId, plan)
                            journal.commit("instrumentation-user", call.callId, { workspace[path] }) {
                                workspace[path] = it.after.orEmpty()
                            }
                            JSONObject().put("operation", plan.operation).put("path", path)
                                .put("before_sha256", plan.beforeSha256).put("after_sha256", plan.afterSha256)
                                .put("mutation_token", plan.token)
                                .put("diff", JSONObject(diffPreview).getString("diff"))
                        }
                        else -> error("unexpected_tool:${call.name}")
                    }
                    return HostToolResult(call.callId, true, content)
                }
            },
            approval = object : PythonApprovalHostPort {
                override suspend fun request(request: HostApprovalRequest): HostApprovalDecision {
                    approvalCount += 1
                    assertEquals("workspace.edit", request.name)
                    val before = workspace.getValue(request.arguments.getString("path"))
                    val after = before.replace(
                        request.arguments.getString("old_text"), request.arguments.getString("new_text"),
                    )
                    diffPreview = WorkspaceMutationPlanner.plan("edit", "config/app.properties", before, after).previewJson()
                    assertTrue(JSONObject(diffPreview).getString("diff").contains("+feature.enabled=true"))
                    return HostApprovalDecision(request.approvalId, "approved")
                }
            },
            artifacts = object : PythonArtifactHostPort {
                override suspend fun describe(artifactId: String) = error("artifact_not_expected")
                override suspend fun readChunk(artifactId: String, offset: Long, length: Int) = error("artifact_not_expected")
            },
            lifecycle = object : PythonLifecycleHostPort {
                override suspend fun current() = PythonRuntimeLifecycleState.FOREGROUND
            },
            audit = object : PythonSideEffectAuditHostPort {
                override suspend fun append(record: HostSideEffectAudit) { audits += "${record.kind}:${record.phase}:${record.outcome}" }
            },
        )

        val first = PythonRuntimeClient(context)
        try {
            assertThrows(ExpectedRuntimeRestart::class.java) {
                runBlocking { PythonAgentLoopCoordinator(first, ports).execute(start()).toList() }
            }
        } finally {
            first.close()
        }
        val saved = requireNotNull(checkpoint)
        assertEquals(listOf("workspace.list", "workspace.search", "workspace.read"), operations)

        val second = PythonRuntimeClient(context)
        val events = try {
            PythonAgentLoopCoordinator(second, ports).execute(resume(saved)).toList()
        } finally {
            second.close()
        }

        assertEquals(
            listOf("workspace.list", "workspace.search", "workspace.read", "workspace.edit", "workspace.read"),
            operations,
        )
        assertEquals(1, approvalCount)
        assertTrue(diffPreview.contains("feature.enabled=true"))
        assertTrue(workspace.getValue("config/app.properties").startsWith("feature.enabled=true"))
        assertTrue(events.any { it.payload.optString("kind") == "run.recovered" })
        assertTrue(events.any { it.payload.optString("kind") == "run.completed" })
        assertTrue(events.any { it.payload.optString("kind") == "file_change.completed" })
        assertTrue(audits.any { it == "approval:approval:approved" })
        assertTrue(audits.any { it == "tool:receipt:succeeded" })
    }

    private fun start() = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.START_RUN, "workspace-natural-start", "workspace-natural-run",
        "workspace-natural-session", 0, "workspace-natural:start",
        JSONObject()
            .put("input", "查找授权目录里的功能开关配置，把 feature.enabled 从 false 改成 true，并确认修改成功。")
            .put("model_id", "scripted-natural-workspace")
            .put("host_capabilities", JSONArray(listOf("chat", "saf_read", "saf_write", "approvals")))
            .put("tools", toolSchemas()),
    )

    private fun resume(saved: HostCheckpoint) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.RESUME_RUN, "workspace-natural-resume", "workspace-natural-run",
        "workspace-natural-session", saved.sequence + 1, "workspace-natural:resume",
        JSONObject().put("state", saved.state),
    )

    private fun toolSchemas() = JSONArray().apply {
        put(tool("workspace.list", "read_only", false, listOf("path")))
        put(tool("workspace.search", "read_only", false, listOf("query")))
        put(tool("workspace.read", "read_only", false, listOf("path")))
        put(tool("workspace.edit", "external_write", true, listOf("path", "old_text", "new_text")))
    }

    private fun tool(name: String, risk: String, approval: Boolean, fields: List<String>) = JSONObject()
        .put("name", name).put("version", 1).put("source", "android-host")
        .put("classification", "local-equivalent").put("description", name)
        .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject().apply {
            fields.forEach { put(it, JSONObject().put("type", "string")) }
        }))
        .put("risk", risk).put("requires_approval", approval)
        .apply { if (name == "workspace.edit") put("oaep_output_type", "file_change") }

    private class NaturalWorkspaceModel : PythonModelHostPort {
        override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
            val toolResults = (0 until request.messages.length()).count {
                request.messages.getJSONObject(it).optString("role") == "tool"
            }
            val next = when (toolResults) {
                0 -> call("list-1", "workspace.list", JSONObject().put("path", ""))
                1 -> call("search-1", "workspace.search", JSONObject().put("query", "feature.enabled"))
                2 -> call("read-1", "workspace.read", JSONObject().put("path", "config/app.properties"))
                3 -> call("edit-1", "workspace.edit", JSONObject().put("path", "config/app.properties")
                    .put("old_text", "feature.enabled=false").put("new_text", "feature.enabled=true"))
                4 -> call("verify-1", "workspace.read", JSONObject().put("path", "config/app.properties"))
                else -> null
            }
            return if (next == null) flowOf(HostModelChunk(request.requestId, "已修改并验证 feature.enabled=true。", "stop"))
            else flowOf(HostModelChunk(request.requestId, finishReason = "tool_calls", toolCalls = JSONArray().put(next)))
        }

        private fun call(id: String, name: String, arguments: JSONObject) = JSONObject()
            .put("call_id", id).put("name", name).put("arguments", arguments)
    }

    private class ExpectedRuntimeRestart : RuntimeException()
}
