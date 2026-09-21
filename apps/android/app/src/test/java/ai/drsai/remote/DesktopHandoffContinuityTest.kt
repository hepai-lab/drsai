package ai.drsai.remote

import ai.drsai.remote.runtime.coordinator.DesktopHandoffContinuityReducer
import ai.drsai.remote.runtime.coordinator.HandoffContinuityEvent
import ai.drsai.remote.runtime.coordinator.HandoffContinuityState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DesktopHandoffContinuityTest {
    @Test fun androidDesktopAndroidReplayPreservesAssociationsAndDeduplicatesEverything() {
        val events = listOf(
            HandoffContinuityEvent("offer", "h1", "session", "android-run", messageId = "user-message"),
            HandoffContinuityEvent("desktop-start", "h1", "session", "android-run", "desktop-run"),
            HandoffContinuityEvent("approval", "h1", "session", "android-run", "desktop-run", approvalId = "approval", approvalDecision = "allow_once"),
            HandoffContinuityEvent("approval-race", "h1", "session", "android-run", "desktop-run", approvalId = "approval", approvalDecision = "decline"),
            HandoffContinuityEvent("effect", "h1", "session", "android-run", "desktop-run", sideEffectReceiptId = "receipt"),
            HandoffContinuityEvent("artifact", "h1", "session", "android-run", "desktop-run", artifactId = "artifact"),
            HandoffContinuityEvent("return", "h1", "session", "android-run", "desktop-run", messageId = "assistant-message"),
        )
        val state = (events + events.reversed()).fold(HandoffContinuityState(), DesktopHandoffContinuityReducer::reduce)
        assertEquals("session", state.sessionId)
        assertEquals("android-run", state.sourceRunId)
        assertEquals("desktop-run", state.targetRunId)
        assertEquals(setOf("user-message", "assistant-message"), state.messageIds)
        assertEquals(setOf("artifact"), state.artifactIds)
        assertEquals(mapOf("approval" to "allow_once"), state.approvalDecisions)
        assertEquals(setOf("receipt"), state.sideEffectReceiptIds)
    }

    @Test fun mismatchedSessionRunOrHandoffFailsClosed() {
        val base = DesktopHandoffContinuityReducer.reduce(HandoffContinuityState(), HandoffContinuityEvent("1", "h", "s", "r", "d"))
        listOf(
            HandoffContinuityEvent("2", "other", "s", "r", "d"),
            HandoffContinuityEvent("3", "h", "other", "r", "d"),
            HandoffContinuityEvent("4", "h", "s", "other", "d"),
            HandoffContinuityEvent("5", "h", "s", "r", "other"),
        ).forEach { event -> assertThrows(IllegalArgumentException::class.java) { DesktopHandoffContinuityReducer.reduce(base, event) } }
    }
}
