package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.RemoteAuditEntry
import ai.drsai.remote.remote.data.RemoteFileNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class RemoteSessionUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun workspaceShowsCapabilitiesSessionMetadataSearchAndLifecycle() {
        var search = ""; var opened: RemoteSessionRef? = null
        val session = RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), "分析任务", "codex")
        val uiState = mutableStateOf(WorkspaceSessionsUiState(runtimeName = "开发机", workspaceName = "项目",
            capabilities = listOf(RemoteCapabilityUi("Files", true), RemoteCapabilityUi("Git", false)),
            sessions = listOf(RemoteSessionUi(session, "running", "刚刚"), RemoteSessionUi(session.copy(sessionId = SessionId("lost")), "failed", "昨天", "permission_lost"))))
        rule.setContent { MaterialTheme { WorkspaceSessionsScreen(
            uiState.value,
            {}, {}, { search = it; uiState.value = uiState.value.copy(query = it) }, {}, { opened = it }) } }
        rule.onNodeWithText("项目").assertIsDisplayed(); rule.onNodeWithText("codex · running · 刚刚").assertIsDisplayed()
        rule.onNodeWithText("Git").assertIsNotEnabled()
        rule.onNodeWithText("搜索会话").performTextInput("分析")
        rule.onAllNodesWithText("分析任务")[0].performClick()
        rule.runOnIdle { assertEquals("分析", search); assertEquals(session, opened) }
    }

    @Test fun newSessionRequiresExplicitHealthyExactAgentDefinition() {
        var selected: RemoteAgentDefinition? = null
        val healthy = RemoteAgentDefinition("open", "1.4.6", "OpenDrSai", "opendrsai", "healthy", setOf("chat"))
        val unhealthy = RemoteAgentDefinition("down", "2.0", "Unavailable", "opendrsai", "unavailable", setOf("chat"))
        rule.setContent { MaterialTheme { WorkspaceSessionsScreen(
            state = WorkspaceSessionsUiState("开发机", "项目", agentDefinitions = listOf(healthy, unhealthy)),
            onBack = {}, onRefresh = {}, onSearch = {}, onCreate = { selected = it }, onOpen = {},
        ) } }

        rule.onNodeWithText("新会话").performClick()
        rule.onNodeWithText("Unavailable").assertIsNotEnabled()
        rule.onNodeWithText("OpenDrSai").performClick()
        rule.runOnIdle { assertEquals(healthy, selected) }
    }

    @Test fun workspaceSessionListExcludesArchivedAndRemovedLifecycle() {
        fun session(id: String, title: String, lifecycle: RemoteResourceLifecycle) = RemoteSessionUi(
            RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId(id), title, "opendrsai", lifecycle),
            null,
            "刚刚",
            lifecycle.toWire(),
        )
        rule.setContent { MaterialTheme { WorkspaceSessionsScreen(
            state = WorkspaceSessionsUiState("开发机", "项目", sessions = listOf(
                session("active", "活动会话", RemoteResourceLifecycle.ACTIVE),
                session("archived", "归档会话", RemoteResourceLifecycle.ARCHIVED),
                session("removed", "已移除会话", RemoteResourceLifecycle.REMOVED),
            )),
            onBack = {}, onRefresh = {}, onSearch = {}, onCreate = {}, onOpen = {},
        ) } }

        rule.onNodeWithText("活动会话").assertIsDisplayed()
        rule.onAllNodesWithText("归档会话").assertCountEquals(0)
        rule.onAllNodesWithText("已移除会话").assertCountEquals(0)
    }

    @Test fun chatShowsIdentityOfflineAuthorityApprovalAndAuditWithoutPrivateIds() {
        val identity = RemoteRunIdentity(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), RunId("run"), "codex")
        val approval = RemoteApprovalCard(ApprovalId("approval"), identity, "开发机", "项目", "Agent", "shell.execute",
            "执行命令", "workspace", "12:00", "corr-1")
        val decisions = mutableListOf<String>(); var audits = 0
        rule.setContent { MaterialTheme { RemoteChatScreen(RemoteChatUiState("开发机", "项目", "会话",
            listOf(RemoteMessageUi("m", "assistant", "正在处理", "读取文件")), approval, running = true, online = true,
            correlationId = "corr-1"), {}, {}, {}, { _, decision -> decisions += decision }, { audits++ }) } }
        rule.onNodeWithText("开发机 · 项目").assertIsDisplayed()
        rule.onNodeWithText("需要你的确认").assertIsDisplayed()
        rule.onNodeWithText("同意").performClick(); rule.onNodeWithText("拒绝").performClick(); rule.onNodeWithText("取消").performClick()
        rule.onNodeWithText("审计").performClick()
        rule.onAllNodesWithText("thread_id").assertCountEquals(0); rule.onAllNodesWithText("turn_id").assertCountEquals(0)
        rule.runOnIdle { assertEquals(listOf("approve", "deny", "cancel"), decisions); assertEquals(1, audits) }
    }

    @Test fun offlineNeverSendsOrDecides() {
        val identity = RemoteRunIdentity(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), RunId("run"), "codex")
        val approval = RemoteApprovalCard(ApprovalId("approval"), identity, "PC", "WS", "Agent", "shell.execute", "x", "ws", "later", "c")
        rule.setContent { MaterialTheme { RemoteChatScreen(RemoteChatUiState("PC", "WS", "Session", approval = approval,
            running = true, online = false), {}, {}, {}, { _, _ -> error("offline decision") }, {}) } }
        rule.onNodeWithText("连接已中断，任务可能仍在运行").assertIsDisplayed()
        rule.onNodeWithText("同意").assertIsNotEnabled()
        rule.onNodeWithText("停止").assertIsNotEnabled()
    }

    @Test fun artifactCardIsScopedAndInvokesAuthenticatedDownload() {
        var opened: String? = null
        val artifact = RemoteArtifactUi("artifact-1", "result.txt", "text/plain", 12, "a".repeat(64))
        rule.setContent { MaterialTheme { RemoteChatScreen(
            RemoteChatUiState("PC", "Workspace", "Session", artifacts = listOf(artifact), scopeKey = "rt/ws/s"),
            {}, {}, {}, { _, _ -> }, {}, { opened = it },
        ) } }
        rule.onNodeWithText("result.txt").assertIsDisplayed()
        rule.onNodeWithText("text/plain · 12 B").assertIsDisplayed()
        rule.onNodeWithText("下载并打开").performClick()
        rule.runOnIdle { assertEquals("artifact-1", opened) }
    }

    @Test fun auditScreenShowsSafeSummaryAndCorrelationWithoutWriteControls() {
        val entry = RemoteAuditEntry("audit", RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), RunId("r"),
            "approval.approved", "alice", "2026-01-01T00:00:00Z", "corr-123", ApprovalId("a"))
        rule.setContent { MaterialTheme { RemoteAuditScreen(
            runtimeName = "开发机", workspaceName = "项目", entries = listOf(entry), loading = false,
            error = null, onBack = {}, onRefresh = {},
        ) } }
        rule.onNodeWithText("approval.approved").assertIsDisplayed()
        rule.onNodeWithText("关联 ID：corr-123").assertIsDisplayed()
        rule.onAllNodesWithText("修改").assertCountEquals(0)
        rule.onAllNodesWithText("删除").assertCountEquals(0)
    }

    @Test fun rapidRemoteSessionSwitchResetsDraftMessagesApprovalAndHeaderByScope() {
        val identityB = RemoteRunIdentity(RuntimeId("rt-b"), WorkspaceId("same"), SessionId("s"), RunId("r"), "opendrsai")
        val current = mutableStateOf(RemoteChatUiState("Runtime A", "Same", "Session A",
            messages = listOf(RemoteMessageUi("a", "assistant", "only-a")), scopeKey = "rt-a/same/s"))
        rule.setContent { MaterialTheme { RemoteChatScreen(current.value, {}, {}, {}, { _, _ -> }, {}) } }
        rule.onNodeWithText("发送消息").performTextInput("draft-a")
        rule.runOnIdle {
            current.value = RemoteChatUiState("Runtime B", "Same", "Session B",
                messages = listOf(RemoteMessageUi("b", "assistant", "only-b")),
                approval = RemoteApprovalCard(ApprovalId("approval"), identityB, "Runtime B", "Same", "Agent",
                    "shell.execute", "safe", "workspace", "later", "corr-b"), scopeKey = "rt-b/same/s")
        }
        rule.onNodeWithText("Runtime B · Same").assertExists()
        rule.onNodeWithText("Session B").assertExists()
        rule.onNodeWithText("only-b").assertExists()
        rule.onNodeWithText("需要你的确认").assertExists()
        rule.onAllNodesWithText("only-a").assertCountEquals(0)
        rule.onAllNodesWithText("draft-a").assertCountEquals(0)
    }

    @Test fun rapidFileWorkspaceSwitchResetsSearchTreeAndTitleByRuntimeScope() {
        val current = mutableStateOf(FileTreeUiState("Workspace A", nodes = listOf(
            RemoteFileNode("a", "only-a.txt", "file", 1, null, null)), scopeKey = "rt-a/same"))
        rule.setContent { MaterialTheme { WorkspaceFilesScreen(current.value, {}, {}, {}, {}, {}) } }
        rule.onNodeWithText("在工作区中搜索").performTextInput("old-query")
        rule.runOnIdle {
            current.value = FileTreeUiState("Workspace B", nodes = listOf(
                RemoteFileNode("b", "only-b.txt", "file", 1, null, null)), scopeKey = "rt-b/same")
        }
        rule.onNodeWithText("Workspace B · 文件").assertIsDisplayed()
        rule.onNodeWithText("only-b.txt").assertIsDisplayed()
        rule.onAllNodesWithText("only-a.txt").assertCountEquals(0)
        rule.onAllNodesWithText("old-query").assertCountEquals(0)
    }
}
