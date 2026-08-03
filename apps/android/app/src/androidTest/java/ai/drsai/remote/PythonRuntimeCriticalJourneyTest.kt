package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
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
                    .put("skills", JSONArray().put(JSONObject().put("id", "attachments").put("availability", "local")))
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

                client.command("delegate", PythonRuntimeMessageType.START_RUN, 0, payload("research"))
                val delegated = client.command(
                    "delegate", PythonRuntimeMessageType.MODEL_COMPLETED, 1,
                    toolCalls(
                        "delegate-1", "delegate",
                        JSONObject().put(
                            "tasks", JSONArray()
                                .put(JSONObject().put("task_id", "child-a").put("prompt", "A"))
                                .put(JSONObject().put("task_id", "child-b").put("prompt", "B")),
                        ),
                    ),
                )
                assertEquals(2, outboundTypes(delegated).count { it == "model_request" })
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

    private fun toolCalls(
        callId: String,
        name: String,
        arguments: JSONObject,
        requiresApproval: Boolean = false,
    ) = JSONObject().put(
        "tool_calls",
        JSONArray().put(
            JSONObject().put("call_id", callId).put("name", name).put("arguments", arguments)
                .put("requires_approval", requiresApproval).put("risk", if (requiresApproval) "high" else "low"),
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
