package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.RemoteAuditEntry
import ai.drsai.remote.remote.data.RemoteFileNode
import ai.drsai.remote.remote.data.RemoteLifecycleState
import ai.drsai.remote.remote.data.RemoteSessionUiAuthorityState
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
            listOf(RemoteMessageUi("m", "assistant", "正在处理", "读取文件")), approval,
            authority = RemoteSessionUiAuthorityState(runStatus = RemoteRunStatus.RUNNING),
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
            authority = RemoteSessionUiAuthorityState(
                connectionState = RemoteConnectionState.OFFLINE,
                lifecycleState = RemoteLifecycleState.OFFLINE,
                runStatus = RemoteRunStatus.RUNNING,
            )), {}, {}, {}, { _, _ -> error("offline decision") }, {}) } }
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

    @Test fun auditScreenShowsSafeSummaryWithoutInternalCorrelationOrWriteControls() {
        val entry = RemoteAuditEntry("audit", RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), RunId("r"),
            "approval.approved", "alice", "2026-01-01T00:00:00Z", "corr-123", ApprovalId("a"))
        rule.setContent { MaterialTheme { RemoteAuditScreen(
            runtimeName = "开发机", workspaceName = "项目", entries = listOf(entry), loading = false,
            error = null, onBack = {}, onRefresh = {},
        ) } }
        rule.onNodeWithText(remoteAuditActionLabel(entry.action)).assertIsDisplayed()
        rule.onNodeWithText("操作方：alice").assertIsDisplayed()
        rule.onNodeWithText("工作区：项目").assertIsDisplayed()
        rule.onAllNodesWithText("corr-123", substring = true).assertCountEquals(0)
        rule.onAllNodesWithText("修改").assertCountEquals(0)
        rule.onAllNodesWithText("删除").assertCountEquals(0)
    }

    @Test fun rapidRemoteSessionSwitchRestoresEachScopedDraftAndResetsAuthorityContent() {
        val identityB = RemoteRunIdentity(RuntimeId("rt-b"), WorkspaceId("same"), SessionId("s"), RunId("r"), "opendrsai")
        val current = mutableStateOf(RemoteChatUiState("Runtime A", "Same", "Session A",
            messages = listOf(RemoteMessageUi("a", "assistant", "only-a")), scopeKey = "rt-a/same/s"))
        rule.setContent { MaterialTheme { RemoteChatScreen(
            current.value, {}, {}, {}, { _, _ -> }, {},
            onDraftChange = { value -> current.value = current.value.copy(draft = value) },
        ) } }
        rule.onNodeWithText("发送消息").performTextInput("draft-a")
        rule.runOnIdle {
            current.value = RemoteChatUiState("Runtime B", "Same", "Session B",
                messages = listOf(RemoteMessageUi("b", "assistant", "only-b")),
                approval = RemoteApprovalCard(ApprovalId("approval"), identityB, "Runtime B", "Same", "Agent",
                    "shell.execute", "safe", "workspace", "later", "corr-b"), scopeKey = "rt-b/same/s",
                draft = "draft-b")
        }
        rule.onNodeWithText("Runtime B · Same").assertExists()
        rule.onNodeWithText("Session B").assertExists()
        rule.onNodeWithText("only-b").assertExists()
        rule.onNodeWithText("需要你的确认").assertExists()
        rule.onAllNodesWithText("only-a").assertCountEquals(0)
        rule.onNodeWithText("draft-b").assertExists()
        rule.onAllNodesWithText("draft-a").assertCountEquals(0)
        rule.runOnIdle {
            current.value = RemoteChatUiState("Runtime A", "Same", "Session A",
                messages = listOf(RemoteMessageUi("a", "assistant", "only-a")),
                scopeKey = "rt-a/same/s", draft = "draft-a")
        }
        rule.onNodeWithText("draft-a").assertExists()
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

    @Test fun sessionManagementRenamesArchivesAndRestoresWithoutOpeningArchivedSession() {
        val active = RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId("active"), "Original", "opendrsai")
        var renamed: Pair<String, String>? = null
        var archive: Pair<String, Boolean>? = null
        val current = mutableStateOf(WorkspaceSessionsUiState("PC", "WS",
            sessions = listOf(RemoteSessionUi(active, "completed", "now"))))
        rule.setContent { MaterialTheme { WorkspaceSessionsScreen(
            state = current.value, onBack = {}, onRefresh = {}, onSearch = {}, onCreate = {}, onOpen = {},
            onToggleArchived = { current.value = current.value.copy(showArchived = !current.value.showArchived) },
            onRename = { ref, title -> renamed = ref.sessionId.value to title },
            onSetArchived = { ref, value -> archive = ref.sessionId.value to value },
        ) } }
        rule.onNodeWithText("管理").performClick()
        rule.onNodeWithText("重命名").performClick()
        rule.onNodeWithTag("session-rename-input").performTextClearance()
        rule.onNodeWithTag("session-rename-input").performTextInput("Renamed")
        rule.onNodeWithText("保存").performClick()
        rule.runOnIdle { assertEquals("active" to "Renamed", renamed) }
        rule.onNodeWithText("管理").performClick()
        rule.onNodeWithText("归档").performClick()
        rule.runOnIdle { assertEquals("active" to true, archive) }

        val archived = active.copy(title = "Renamed", lifecycle = RemoteResourceLifecycle.ARCHIVED)
        rule.runOnIdle { current.value = current.value.copy(showArchived = true,
            sessions = listOf(RemoteSessionUi(archived, "completed", "later", lifecycle = "archived"))) }
        rule.onNodeWithText("管理").performClick()
        rule.onNodeWithText("取消归档").performClick()
        rule.runOnIdle { assertEquals("active" to false, archive) }
    }

    @Test fun incomingMessagesDoNotInterruptHistoryReadingAndExposeJumpToLatest() {
        val current = mutableStateOf(RemoteChatUiState(
            "PC", "WS", "Long session",
            messages = (0 until 100).map { RemoteMessageUi("m-$it", "assistant", "item-$it") },
            scopeKey = "rt/ws/long",
        ))
        rule.setContent { MaterialTheme { RemoteChatScreen(current.value, {}, {}, {}, { _, _ -> }, {}) } }
        rule.onNodeWithTag("remote-transcript").performScrollToIndex(0)
        rule.waitForIdle()
        rule.runOnIdle {
            current.value = current.value.copy(
                messages = current.value.messages + RemoteMessageUi("m-100", "assistant", "new-item"),
            )
        }
        rule.onNodeWithText("跳到最新（1）").assertIsDisplayed()
        rule.onNodeWithText("item-0").assertExists()
        rule.onNodeWithText("跳到最新（1）").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("new-item").assertIsDisplayed()
    }
}
