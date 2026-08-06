package ai.drsai.remote

import ai.drsai.remote.data.Conversation
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeReconciliation
import ai.drsai.remote.workbench.model.RuntimeAuthority
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PythonRuntimeReconciliationTest {
    @Test
    fun `uncertain tool and artifact failures become bounded waiting OAEP interactions`() {
        listOf(
            "python_tool_needs_reconciliation:${"call".repeat(40)}" to "tool",
            "artifact_needs_reconciliation:operation-1" to "artifact",
        ).forEach { (failure, expectedKind) ->
            val envelope = PythonRuntimeReconciliation.envelope(request(), failure)
                ?: error("reconciliation envelope missing")
            assertTrue(envelope.requestId.length <= 128)
            assertTrue(envelope.idempotencyKey.length <= 256)
            assertEquals(expectedKind, envelope.payload.getString("side_effect_kind"))
            assertEquals(
                listOf(NormalizedAgentEvent.ItemCreated::class, NormalizedAgentEvent.RunWaiting::class),
                PythonRuntimeEventMapper.decodeAll(envelope).map { it::class },
            )
        }
        assertNull(PythonRuntimeReconciliation.envelope(request(), "network_timeout"))
    }

    private fun request() = ChatRunRequest(
        accountSubject = "alice",
        authority = RuntimeAuthority.LOCAL_DEVICE,
        conversation = Conversation("session-1", "Chat"),
        input = "hello",
        attachments = emptyList(),
        runId = "r".repeat(120),
        userMessageId = "user-1",
        assistantMessageId = "assistant-1",
    )
}
