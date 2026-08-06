package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.runtime.coordinator.DesktopHandoffDecision
import ai.drsai.remote.runtime.coordinator.DesktopHandoffKind
import ai.drsai.remote.runtime.coordinator.DesktopHandoffOaep
import ai.drsai.remote.runtime.coordinator.DesktopHandoffState
import ai.drsai.remote.runtime.coordinator.HandoffPackageFactory
import ai.drsai.remote.runtime.coordinator.RuntimeDescriptor
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.WorkbenchId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DesktopHandoffOaepTest {
    private val target = RuntimeDescriptor(
        RuntimeBinding(WorkbenchId("desktop-1"), RuntimeAuthority.REMOTE_RUNTIME),
        "Desktop", "1", true, RuntimeCapabilitySet(values = setOf(RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO)),
    )

    @Test fun offerIsAnOaepInteractionAndWaitingRunWithoutLeakingUserPrompt() {
        val events = DesktopHandoffOaep.offered(
            "run-1", "handoff-1",
            DesktopHandoffDecision(
                DesktopHandoffState.OFFER, setOf(RuntimeCapability.MCP_STDIO), target,
                "Confirm Desktop execution", DesktopHandoffKind.MCP_STDIO, "filesystem",
            ),
        )
        assertTrue(events.first() is NormalizedAgentEvent.RunStarted)
        val created = events[1] as NormalizedAgentEvent.ItemCreated
        val content = created.content as OaepInteractionContent
        assertEquals("handoff", content.interactionType)
        assertEquals("desktop-1", content.requestSummary["target_runtime_id"])
        assertEquals("stdio", content.requestSummary["transport"])
        assertFalse(content.requestSummary.containsKey("prompt"))
        assertTrue(events.last() is NormalizedAgentEvent.RunWaiting)
    }

    @Test fun acceptedDecisionCompletesInteractionAddsNoticeAndTerminatesRun() {
        val value = HandoffPackageFactory.create(
            WorkbenchId("run-1"), WorkbenchId("desktop-1"), "run command", emptyList(), emptyList(), true,
        )
        val events = DesktopHandoffOaep.accepted("run-1", "handoff-1", value)
        assertEquals("accept", ((events[0] as NormalizedAgentEvent.ItemCompleted).content as OaepInteractionContent).response)
        assertEquals("handoff_created", ((events[1] as NormalizedAgentEvent.ItemCompleted).content as OaepNoticeContent).code)
        assertTrue(events.last() is NormalizedAgentEvent.RunCompleted)
    }

    @Test fun declinedDecisionCompletesInteractionAndCancelsRun() {
        val events = DesktopHandoffOaep.declined("run-1", "handoff-1")
        assertEquals("decline", ((events.first() as NormalizedAgentEvent.ItemCompleted).content as OaepInteractionContent).response)
        assertTrue(events.last() is NormalizedAgentEvent.RunCancelled)
    }
}
