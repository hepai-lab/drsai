package ai.drsai.remote

import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.ui.remoteMarkdown
import ai.drsai.remote.remote.ui.remoteRoleLabel
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

    @Test fun `Windows conversation projection becomes ordered Android messages`() {
        val items = listOf(
            RemoteConversationItem("user:run", 1, "message.user", "now", mapOf("content" to "从 Windows 创建", "run_id" to "run")),
            RemoteConversationItem("delta-1", 2, "message.delta", "now", mapOf("delta" to "远程", "run_id" to "run")),
            RemoteConversationItem("tool-1", 3, "tool.started", "now", mapOf("run_id" to "run")),
            RemoteConversationItem("delta-2", 4, "message.delta", "now", mapOf("delta" to "回复", "run_id" to "run")),
        )

        val messages = projectConversationMessages(items)

        assertEquals(listOf("从 Windows 创建", "远程回复"), messages.map { it.text })
        assertEquals("tool.started", messages.last().progress)
    }

    @Test fun `reasoning system terminal and unknown messages degrade safely`() {
        val items = listOf(
            RemoteConversationItem("reasoning", 1, "reasoning.summary", "now",
                mapOf("summary" to "先检查状态")),
            RemoteConversationItem("system", 2, "message.system", "now",
                mapOf("content" to "系统提示")),
            RemoteConversationItem("terminal", 3, "run.completed", "now", emptyMap()),
            RemoteConversationItem("future", 4, "future.kind", "now",
                mapOf("content" to "可安全显示", "token" to "must-not-render")),
            RemoteConversationItem("opaque", 5, "opaque.kind", "now",
                mapOf("token" to "must-not-render")),
        )

        val messages = projectConversationMessages(items)

        assertEquals(
            listOf("reasoning", "system", "system", "system"),
            messages.map { it.role },
        )
        assertEquals(
            listOf("先检查状态", "系统提示", "任务已完成", "可安全显示"),
            messages.map { it.text },
        )
        assertFalse(messages.toString().contains("must-not-render"))
        assertEquals("未知事件：future.kind", messages.last().progress)
    }

    @Test fun `conversation digest is stable but changes with projected content`() {
        val original = listOf(
            RemoteConversationItem(
                "user", 1, "message.user", "now",
                mapOf("content" to "原始正文", "run_id" to "run"),
            ),
            RemoteConversationItem(
                "tool", 2, "tool.started", "now", mapOf("run_id" to "run"),
            ),
        )
        val changed = original.toMutableList().also {
            it[0] = it[0].copy(payload = mapOf("content" to "被替换正文", "run_id" to "run"))
        }

        assertEquals(conversationProjectionDigest(original), conversationProjectionDigest(original))
        assertFalse(conversationProjectionDigest(original) == conversationProjectionDigest(changed))
        assertEquals(64, conversationProjectionDigest(original).length)
    }

    @Test fun `offline markdown renderer styles without WebView or network`() {
        val rendered = remoteMarkdown("# 标题\n**加粗** 与 `code`")
        assertEquals("标题\n加粗 与 code", rendered.text)
        assertEquals(3, rendered.spanStyles.size)
        assertEquals("你", remoteRoleLabel("user"))
        assertEquals("系统", remoteRoleLabel("system"))
        assertEquals("思考摘要", remoteRoleLabel("reasoning"))
        assertEquals("OpenDrSai", remoteRoleLabel("future"))
    }
}
