package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.runtime.tools.FullRuntimeToolCatalog
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeCriticalJourneyTest {
    @Test
    fun textToolsApprovalArtifactSkillAndSubagentsCloseOnPhysicalRuntime() {
        runBlocking {
            val client = PythonRuntimeClient(ApplicationProvider.getApplicationContext<Context>())
            try {
                assertKinds(
                    client.command("text", PythonRuntimeMessageType.START_RUN, 0, payload("hello")),
                    "run.started",
                )
                assertKinds(
                    client.command("text", PythonRuntimeMessageType.MODEL_CHUNK, 1, JSONObject().put("delta", "hello")),
                    "message.delta",
                )
                assertKinds(
                    client.command("text", PythonRuntimeMessageType.MODEL_COMPLETED, 2, JSONObject().put("content", "hello")),
                    "run.completed",
                )

                client.command("reasoning", PythonRuntimeMessageType.START_RUN, 0, payload("analyze"))
                assertKinds(
                    client.command("reasoning", PythonRuntimeMessageType.MODEL_CHUNK, 1,
                        JSONObject().put("delta", "answer").put("reasoning_summary", "Checked constraints")),
                    "reasoning.delta", "message.delta",
                )
                assertKinds(
                    client.command("reasoning", PythonRuntimeMessageType.MODEL_COMPLETED, 2,
                        JSONObject().put("content", "answer").put("reasoning_summary", "Checked constraints")),
                    "reasoning.completed", "run.completed",
                )

                client.command("plan", PythonRuntimeMessageType.START_RUN, 0, payload("plan"))
                val plan = client.command(
                    "plan", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls("plan-1", "core.update_plan", JSONObject()
                        .put("expected_version", 0)
                        .put("text", "Implement and verify")
                        .put("steps", JSONArray()
                            .put(JSONObject().put("title", "Implement").put("status", "completed"))
                            .put(JSONObject().put("title", "Verify").put("status", "in_progress")))),
                )
                assertKinds(plan, "tool.started", "tool.result", "plan.started")

                listOf(
                    Triple("command", "command_execution", JSONObject().put("query", "src")),
                    Triple("file", "file_change", JSONObject().put("path", "src/App.kt").put("content", "ok")),
                ).forEach { (journey, outputType, arguments) ->
                    client.command(journey, PythonRuntimeMessageType.START_RUN, 0, payload("work"))
                    val toolName = if (outputType == "command_execution") "workspace.search" else "workspace.write"
                    client.command(journey, PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                        toolCalls("call-1", toolName, arguments, outputType = outputType))
                    val receipt = client.command(journey, PythonRuntimeMessageType.TOOL_RESULT, 2,
                        JSONObject().put("call_id", "call-1").put("succeeded", true)
                            .put("content", JSONObject().put("ok", true)).put("duration_ms", 4))
                    assertKinds(receipt, if (outputType == "command_execution") "command.completed" else "file_change.completed")
                }

                client.command("tool-failed", PythonRuntimeMessageType.START_RUN, 0, payload("search protected path"))
                val failedCall = client.command(
                    "tool-failed", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls("failed-1", "workspace.search", JSONObject().put("query", "protected")),
                )
                assertKinds(failedCall, "tool.started")
                val failedReceipt = client.command(
                    "tool-failed", PythonRuntimeMessageType.TOOL_RESULT, 2,
                    JSONObject().put("call_id", "failed-1").put("succeeded", false)
                        .put("content", JSONObject().put("message", "Workspace permission denied"))
                        .put("error_code", "workspace_permission_denied"),
                )
                assertKinds(failedReceipt, "tool.error")
                val toolError = outbound(failedReceipt).single {
                    it.optJSONObject("payload")?.optString("kind") == "tool.error"
                }.getJSONObject("payload")
                assertEquals("workspace_permission_denied", toolError.getString("code"))
                assertEquals("workspace.search", toolError.getString("name"))

                client.command("core-tool", PythonRuntimeMessageType.START_RUN, 0, payload("count words"))
                val coreTool = client.command(
                    "core-tool", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls("stats-1", "core.text_stats", JSONObject().put("text", "one two three")),
                )
                assertKinds(coreTool, "tool.started", "tool.result")
                assertTrue(outboundTypes(coreTool).contains("model_request"))
                assertKinds(
                    client.command("core-tool", PythonRuntimeMessageType.MODEL_COMPLETED, 2, JSONObject().put("content", "three")),
                    "run.completed",
                )

                client.command("approval", PythonRuntimeMessageType.START_RUN, 0, payload("save"))
                val approval = client.command(
                    "approval", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls(
                        "write-1", "save_artifact", JSONObject().put("artifact_id", "opaque-1"),
                        requiresApproval = true,
                    ),
                )
                assertTrue(outboundTypes(approval).contains("approval_request"))
                val approved = client.command(
                    "approval", PythonRuntimeMessageType.APPROVAL_RESULT, 2,
                    JSONObject().put("approval_id", "approval:write-1").put("call_id", "write-1").put("decision", "approved"),
                )
                assertTrue(outboundTypes(approved).contains("tool_call_request"))
                assertKinds(
                    client.command(
                        "approval", PythonRuntimeMessageType.TOOL_RESULT, 3,
                        JSONObject().put("call_id", "write-1").put("succeeded", true).put("content", JSONObject().put("saved", true)),
                    ),
                    "tool.result",
                )
                assertKinds(
                    client.command("approval", PythonRuntimeMessageType.MODEL_COMPLETED, 4, JSONObject().put("content", "saved")),
                    "run.completed",
                )

                val artifactStart = payload("summarize")
                    .put("artifacts", JSONArray().put("artifact-1"))
                    .put("skills", JSONArray().put(JSONObject().put("id", "attachments").put("version", 1)
                        .put("source", "built_in").put("availability", "local")
                        .put("instructions", "").put("tools", JSONArray()).put("capabilities", JSONArray())
                        .put("digest", "13a60c0049f756594d01048cc55b2c55922bbd69b4883b848e0cbce5a7a944c6")))
                val artifact = client.command("artifact", PythonRuntimeMessageType.START_RUN, 0, artifactStart)
                assertTrue(outboundTypes(artifact).contains("artifact_request"))
                client.command(
                    "artifact", PythonRuntimeMessageType.ARTIFACT_RESULT, 1,
                    JSONObject().put("artifact_id", "artifact-1").put("operation", "describe")
                        .put("mime_type", "text/plain").put("size", 5),
                )
                val loaded = client.command(
                    "artifact", PythonRuntimeMessageType.ARTIFACT_RESULT, 2,
                    JSONObject().put("artifact_id", "artifact-1").put("operation", "read")
                        .put("data_base64", Base64.getEncoder().encodeToString("hello".toByteArray())),
                )
                assertTrue(outboundTypes(loaded).contains("model_request"))
                assertKinds(
                    client.command("artifact", PythonRuntimeMessageType.MODEL_COMPLETED, 3, JSONObject().put("content", "summary")),
                    "run.completed",
                )

                val delegateStart = client.command("delegate", PythonRuntimeMessageType.START_RUN, 0, payload("research"))
                val scheduling = outbound(delegateStart).single {
                    it.optJSONObject("payload")?.optString("kind") == "run.started"
                }.getJSONObject("payload").getJSONObject("subagent_scheduling")
                assertEquals("p9-subagent-scheduling-v1", scheduling.getString("policy_version"))
                assertEquals(3, scheduling.getInt("max_active"))
                assertEquals(2, scheduling.getInt("max_parallel"))
                assertEquals(64, scheduling.getString("sha256").length)
                val delegated = client.command(
                    "delegate", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls(
                        "delegate-1", "delegate",
                        JSONObject().put(
                            "tasks", JSONArray()
                                .put(JSONObject().put("task_id", "child-a").put("type", "explore")
                                    .put("prompt", "A").put("allowed_tools", JSONArray()))
                                .put(JSONObject().put("task_id", "child-b").put("type", "general")
                                    .put("prompt", "B").put("allowed_tools", JSONArray())),
                        ),
                    ),
                )
                assertEquals(2, outboundTypes(delegated).count { it == "model_request" })
                val childRequests = outbound(delegated).filter { it.getString("message_type") == "model_request" }
                assertTrue(childRequests.all {
                    it.getJSONObject("payload").getJSONArray("tools").length() == 0 &&
                        it.getJSONObject("payload").getString("subagent_kernel_sha256").length == 64
                })
                val childStarts = outbound(delegated).filter {
                    it.optJSONObject("payload")?.optString("kind") == "subagent.started"
                }
                assertEquals(1, childStarts.map { it.getJSONObject("payload").getString("kernel_sha256") }.distinct().size)
                assertKinds(
                    client.command("delegate", PythonRuntimeMessageType.CANCEL_RUN, 2, JSONObject().put("subagent_id", "child-a")),
                    "subagent.cancelled",
                )
                assertKinds(
                    client.command(
                        "delegate", PythonRuntimeMessageType.MODEL_COMPLETED, 3,
                        JSONObject().put("subagent_id", "child-b").put("content", "answer B"),
                    ),
                    "subagent.completed",
                )
                assertKinds(
                    client.command("delegate", PythonRuntimeMessageType.MODEL_COMPLETED, 4, JSONObject().put("content", "combined")),
                    "run.completed",
                )

                client.command("delegate-failed", PythonRuntimeMessageType.START_RUN, 0, payload("research with fallback"))
                client.command(
                    "delegate-failed", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls(
                        "delegate-failed-1", "delegate",
                        JSONObject().put("tasks", JSONArray()
                            .put(JSONObject().put("task_id", "ok").put("type", "explore")
                                .put("prompt", "A").put("allowed_tools", JSONArray()))
                            .put(JSONObject().put("task_id", "late").put("type", "general")
                                .put("prompt", "B").put("allowed_tools", JSONArray()))),
                    ),
                )
                assertKinds(
                    client.command(
                        "delegate-failed", PythonRuntimeMessageType.MODEL_COMPLETED, 2,
                        JSONObject().put("subagent_id", "ok").put("content", "verified A"),
                    ),
                    "subagent.completed",
                )
                val failedSubtask = client.command(
                    "delegate-failed", PythonRuntimeMessageType.MODEL_FAILED, 3,
                    JSONObject().put("subagent_id", "late").put("code", "model_timeout").put("retryable", true),
                )
                assertKinds(failedSubtask, "subagent.failed")
                val failurePayload = outbound(failedSubtask).single {
                    it.optJSONObject("payload")?.optString("kind") == "subagent.failed"
                }.getJSONObject("payload")
                assertEquals("model_timeout", failurePayload.getString("code"))
                assertTrue(failurePayload.getString("child_run_id").endsWith(":subagent:late"))
                val falseSuccess = client.command(
                    "delegate-failed", PythonRuntimeMessageType.MODEL_COMPLETED, 4,
                    JSONObject().put("content", "Everything succeeded"),
                )
                assertKinds(falseSuccess, "run.failed")
                assertTrue(outbound(falseSuccess).none {
                    it.optJSONObject("payload")?.optString("kind") == "run.completed"
                })
            } finally {
                client.close()
            }
        }
    }

    private suspend fun PythonRuntimeClient.command(
        journey: String,
        type: PythonRuntimeMessageType,
        sequence: Long,
        payload: JSONObject,
    ): JSONObject = submit(
        PythonRuntimeEnvelope(
            messageType = type,
            requestId = "$journey-request-$sequence",
            runId = "$journey-run",
            sessionId = "$journey-session",
            sequence = sequence,
            idempotencyKey = "$journey:$sequence",
            payload = payload,
        )
    ).also { assertEquals("accepted", it.getString("decision")) }
        .getJSONObject("python_result")

    private fun payload(input: String) = JSONObject().put("input", input).put("model_id", "probe-model")
        .put("tools", FullRuntimeToolCatalog.schemas(JSONArray(listOf(
            hostTool("workspace.search", "read_only", false, "command_execution"),
            hostTool("workspace.write", "read_only", false, "file_change"),
            hostTool("save_artifact", "sensitive", true, null),
        ))))

    private fun hostTool(name: String, risk: String, approval: Boolean, outputType: String?) = JSONObject()
        .put("name", name).put("version", 1).put("source", "android-host")
        .put("classification", "local-equivalent").put("description", name)
        .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
        .put("required_capabilities", JSONArray()).put("risk", risk)
        .put("requires_approval", approval).putOpt("oaep_output_type", outputType)

    private fun toolCalls(
        callId: String,
        name: String,
        arguments: JSONObject,
        requiresApproval: Boolean = false,
        outputType: String? = null,
    ) = JSONObject().put(
        "tool_calls",
        JSONArray().put(
            JSONObject().put("call_id", callId).put("name", name).put("arguments", arguments)
                .put("requires_approval", requiresApproval).put("risk", if (requiresApproval) "high" else "low")
                .putOpt("oaep_output_type", outputType),
        ),
    )

    private fun outbound(result: JSONObject): List<JSONObject> {
        val array = result.getJSONArray("outbound")
        return (0 until array.length()).map(array::getJSONObject)
    }

    private fun outboundTypes(result: JSONObject) = outbound(result).map { it.getString("message_type") }

    private fun assertKinds(result: JSONObject, vararg expected: String) {
        val kinds = outbound(result)
            .filter { it.getString("message_type") == "runtime_event" }
            .map { it.getJSONObject("payload").getString("kind") }
        expected.forEach { assertTrue("missing runtime event $it in $kinds", kinds.contains(it)) }
    }
}
