package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.coordinator.DesktopHandoffDecision
import ai.drsai.remote.runtime.coordinator.DesktopHandoffOaep
import ai.drsai.remote.runtime.coordinator.DesktopHandoffState
import ai.drsai.remote.runtime.coordinator.RuntimeDescriptor
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.WorkbenchId
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** M10-F01: every new P9 capability has a public OAEP semantic item. */
class P9OaepCapabilityMappingTest {
    @Test fun webAndMcpCallsPreserveToolIdentityServerAndResult() {
        val web = decode("tool.result", JSONObject()
            .put("name", "web.search").put("call_id", "web-1")
            .put("arguments", JSONObject().put("query", "HEPiX 2026"))
            .put("result", JSONObject().put("sources", JSONArray().put("https://www.hepix.org/"))))
            as NormalizedAgentEvent.ItemCompleted
        val webContent = web.content as OaepToolCallContent
        assertEquals("web.search", webContent.toolName)
        assertEquals("HEPiX 2026", webContent.arguments["query"])

        val mcp = decode("tool.result", JSONObject()
            .put("name", "mcp.docs.lookup").put("call_id", "mcp-1").put("server", "docs")
            .put("arguments", JSONObject()).put("result", JSONObject().put("ok", true)))
            as NormalizedAgentEvent.ItemCompleted
        assertEquals("docs", (mcp.content as OaepToolCallContent).server)
    }

    @Test fun citationsAreMappedOnMessageAndVerificationNotice() {
        val message = decode("message.completed", JSONObject()
            .put("text", "Verified answer")
            .put("citations", JSONArray().put(JSONObject().put("url", "https://www.hepix.org/"))))
            as NormalizedAgentEvent.ItemCompleted
        assertEquals("https://www.hepix.org/", (message.content as OaepMessageContent).citations.single()["url"])
        val verified = decode("citation.verified", JSONObject()
            .put("citation_sha256", "a".repeat(64)).put("source_call_ids", JSONArray().put("web-1")))
            as NormalizedAgentEvent.ItemCompleted
        assertEquals("citation_verified", (verified.content as OaepNoticeContent).code)
    }

    @Test fun skillSubagentAndHandoffHaveDedicatedOaepItems() {
        val started = envelope("run.started", JSONObject().put("skill_snapshot", JSONArray().put(JSONObject()
            .put("id", "research").put("version", 1).put("source", "built_in").put("availability", "local")
            .put("digest", "a".repeat(64)).put("instructions_sha256", "b".repeat(64))
            .put("allowed_tools", JSONArray()).put("required_capabilities", JSONArray()))))
        val skill = PythonRuntimeEventMapper.decodeAll(started).filterIsInstance<NormalizedAgentEvent.ItemCompleted>()
            .single { (it.content as? OaepNoticeContent)?.code == "skill_manifest_snapshot" }
        assertEquals("notice", skill.itemType)

        val subagent = decode("subagent.started", JSONObject().put("subagent_id", "research-1").put("title", "Research"))
            as NormalizedAgentEvent.ItemStarted
        assertEquals("subtask", subagent.itemType)
        assertEquals("Research", (subagent.content as OaepSubtaskContent).title)

        val target = RuntimeDescriptor(
            RuntimeBinding(WorkbenchId("desktop"), RuntimeAuthority.REMOTE_RUNTIME), "Desktop", "1", true,
            RuntimeCapabilitySet(values = setOf(RuntimeCapability.CHAT, RuntimeCapability.SHELL)),
        )
        val handoff = DesktopHandoffOaep.offered(
            "run", "handoff", DesktopHandoffDecision(
                DesktopHandoffState.OFFER, setOf(RuntimeCapability.SHELL), target, "Confirm Desktop execution",
            ),
        )[1] as NormalizedAgentEvent.ItemCreated
        assertEquals("handoff", (handoff.content as OaepInteractionContent).interactionType)
    }

    @Test fun unknownRuntimeExtensionIsVisibleInsteadOfSilentlyDropped() {
        val event = decode("future.capability.event", JSONObject().put("secret", "must-not-export"))
            as NormalizedAgentEvent.ItemCompleted
        val notice = event.content as OaepNoticeContent
        assertEquals("unknown_runtime_event", notice.code)
        assertTrue(!notice.details.toString().contains("must-not-export"))
    }

    private fun decode(kind: String, payload: JSONObject) = PythonRuntimeEventMapper.decode(envelope(kind, payload))

    private fun envelope(kind: String, payload: JSONObject) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.RUNTIME_EVENT, "request", "run", "session", 1, "key:$kind",
        JSONObject(payload.toString()).put("kind", kind),
    )
}
