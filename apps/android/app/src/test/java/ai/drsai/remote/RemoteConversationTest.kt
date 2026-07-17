package ai.drsai.remote

import ai.drsai.remote.remote.model.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteConversationTest {
    private val identity = RemoteRunIdentity(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), RunId("run"), "codex")
    private fun event(sequence: Long, type: String) = RemoteRuntimeEvent(EventId("event-$sequence"), identity, sequence, type, "now")

    @Test fun `all runtime event kinds map without backend private ids`() {
        val values = listOf("run.queued", "run.started", "message.delta", "tool.started", "tool.finished",
            "workspace.changed", "approval.requested", "approval.resolved", "artifact.created",
            "run.completed", "run.failed", "run.cancelled")
        assertEquals(RemoteEventKind.entries.toSet(), values.map(::remoteEventKind).toSet())
        assertFalse(values.any { it.contains("thread") || it.contains("turn") || it.contains("jsonrpc") })
    }

    @Test fun `accumulator requires contiguous scoped authoritative events`() {
        val accumulator = RemoteRunEventAccumulator(identity)
        accumulator.apply(event(1, "run.started"))
        accumulator.apply(event(2, "message.delta"), "你好")
        accumulator.apply(event(3, "approval.requested"))
        assertEquals("你好", accumulator.text)
        assertEquals(RemoteRunStatus.WAITING_APPROVAL, accumulator.status)
        kotlin.runCatching { accumulator.apply(event(5, "run.completed")) }.onSuccess { error("gap accepted") }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `run request rejects Android local attachment path`() {
        RemoteRunRequest(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "x",
            listOf("/sdcard/photo.jpg"), "idempotency-key")
    }

    @Test fun `approval risk is typed redacted and bounded`() {
        val card = RemoteApprovalCard(ApprovalId("a"), identity, "PC", "Project", "Agent", "shell.execute",
            "token=secret " + "x".repeat(700), "workspace".repeat(100), "later", "corr")
        assertEquals(ApprovalRisk.COMMAND, card.risk)
        assertFalse(card.safeSummary.contains("secret"))
        assertEquals(512, card.safeSummary.length)
        assertEquals(256, card.safeScope.length)
    }
}
