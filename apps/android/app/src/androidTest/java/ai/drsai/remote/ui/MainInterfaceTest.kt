package ai.drsai.remote.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.ApprovalUiItem
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.WorkbenchSessionItem
import ai.drsai.remote.data.WorkbenchWorkspaceItem
import ai.drsai.remote.data.WorkbenchSearchItem
import ai.drsai.remote.runtime.security.ApprovalDecision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.FileOutputStream

class MainInterfaceTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun workbenchDrawerUsesTheDocumentedWideScreenBreakpoint() {
        assertFalse(usesPermanentWorkbenchDrawer(839.dp))
        assertTrue(usesPermanentWorkbenchDrawer(840.dp))
        assertTrue(usesPermanentWorkbenchDrawer(1280.dp))
    }

    @Test
    fun permanentWorkbenchDrawerRendersItsPrimaryNavigation() {
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(user = ai.drsai.remote.data.User("wide", "宽屏账户")),
                    modal = false,
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithText("远程工作区").assertIsDisplayed()
        composeRule.onNodeWithText("宽屏账户").assertIsDisplayed()
    }

    @Test
    fun floatingHeaderKeepsOnlyPrimaryActions() {
        composeRule.setContent {
            MaterialTheme {
                FloatingHeader({}, {}, true)
            }
        }

        composeRule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("新对话").assertIsDisplayed()
        composeRule.onAllNodesWithContentDescription("本机历史").assertCountEquals(0)
        composeRule.onAllNodesWithContentDescription("个人中心").assertCountEquals(0)
    }

    @Test fun headerAndComposerRemainOperableAtTwoHundredPercentFontScale() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 2f)) {
                MaterialTheme {
                    Box(Modifier.fillMaxSize()) {
                        FloatingHeader({}, {}, true)
                        Composer(
                            state = AppState(destination = AppDestination.Chat),
                            onSend = {},
                            onStop = {},
                            modifier = Modifier.align(Alignment.BottomCenter),
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("新对话").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("添加附件").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Test fun workbenchDrawerRemainsNavigableAtOneHundredFiftyPercentFontScale() {
        composeRule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                MaterialTheme {
                    NavigationDrawer(
                        state = AppState(destination = AppDestination.Chat),
                        onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                        onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                    )
                }
            }
        }
        composeRule.onNode(hasSetTextAction()).assertIsDisplayed()
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(2)
        composeRule.onNodeWithText("工作区与会话").assertIsDisplayed()
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(0)
        composeRule.onNodeWithText("智能体").assertIsDisplayed()
    }

    @Test fun primaryHeaderTouchTargetsAreAtLeastFortyEightDp() {
        composeRule.setContent { MaterialTheme { FloatingHeader({}, {}, true) } }
        val density = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics.density
        listOf("展开侧栏", "新对话").forEach { description ->
            val bounds = composeRule.onNodeWithContentDescription(description).fetchSemanticsNode().boundsInRoot
            assertTrue("$description width=${bounds.width}", bounds.width >= 48 * density)
            assertTrue("$description height=${bounds.height}", bounds.height >= 48 * density)
        }
    }

    @Test
    fun composerChangesFromVoiceToSendWhenTextIsEntered() {
        var sent = ""
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = AppState(destination = AppDestination.Chat),
                    onSend = { sent = it },
                    onStop = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription("添加附件").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("语音输入").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).performTextInput("你好")
        composeRule.onAllNodesWithContentDescription("语音输入").assertCountEquals(0)
        composeRule.onNodeWithContentDescription("发送").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("你好", sent) }
    }

    @Test
    fun drawerExposesRemoteWorkspaceAsAProductEntry() {
        var opened = 0
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(destination = AppDestination.Chat),
                    onNewConversation = {},
                    onOpenConversation = {},
                    onSelectAgent = {},
                    onRefreshAgents = {},
                    onOpenProfile = {},
                    onOpenRemoteWorkspaces = { opened += 1 },
                )
            }
        }
        composeRule.onNodeWithText("远程工作区").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, opened) }
    }

    @Test
    fun drawerExposesWorkbenchEntriesAndFiltersSessions() {
        var resultsOpened = 0
        var pinned: Pair<String, Boolean>? = null
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(WorkbenchWorkspaceItem(
                            "local", "android-local", "local", "OpenDrSai 本地", true,
                            listOf(
                                WorkbenchSessionItem("one", "android-local", "local", "Alpha", true, false, false, 1),
                                WorkbenchSessionItem("two", "android-local", "local", "Beta", true, true, true, 2, "WAITING_APPROVAL"),
                            ),
                        )),
                    ),
                    onNewConversation = {},
                    onOpenConversation = {},
                    onSelectAgent = {},
                    onRefreshAgents = {},
                    onOpenProfile = {},
                    onOpenRemoteWorkspaces = {},
                    onOpenResults = { resultsOpened += 1 },
                    onSetSessionPinned = { id, value -> pinned = id to value },
                )
            }
        }
        composeRule.onNodeWithText("定时任务").assertIsDisplayed()
        composeRule.onNodeWithText("结果").performScrollTo().assertIsDisplayed().performClick()
        composeRule.onNodeWithText("智能体与技能").performScrollTo().assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(1, resultsOpened) }
        composeRule.onNode(hasSetTextAction()).performTextInput("Beta")
        assertTrue(composeRule.onAllNodesWithText("Beta").fetchSemanticsNodes().isNotEmpty())
        composeRule.onAllNodesWithText("Alpha").assertCountEquals(0)
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(3).performTouchInput {
            swipe(Offset(center.x, bottom - 8), Offset(center.x, bottom - 104), 200)
        }
        assertTrue(composeRule.onAllNodesWithText("待审批").fetchSemanticsNodes().isNotEmpty())
        composeRule.onNodeWithContentDescription("会话操作").performSemanticsAction(SemanticsActions.OnClick)
        composeRule.onNodeWithText("取消置顶").performClick()
        composeRule.runOnIdle { assertEquals("two" to false, pinned) }
    }

    @Test fun remoteWorkspaceShowsAuthoritativeConnectionFreshness() {
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem("remote", "runtime", "workspace", "远程实验", false, emptyList(), "online"),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(3)
        assertTrue(composeRule.onAllNodesWithText("在线").fetchSemanticsNodes().isNotEmpty())
    }

    @Test fun drawerRequestsTheNextSessionPageForTheExactWorkspace() {
        var requested = ""
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem(
                                "runtime:workspace", "runtime", "workspace", "分页工作区", false,
                                listOf(WorkbenchSessionItem("one", "runtime", "workspace", "第一页会话", false, false, false, 1)),
                                "online", sessionHasMore = true,
                            ),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {}, onLoadMoreSessions = { requested = it },
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(5)
        composeRule.onNode(hasText("加载更多会话") and hasClickAction())
            .performSemanticsAction(SemanticsActions.OnClick)
        composeRule.runOnIdle { assertEquals("runtime:workspace", requested) }
    }

    @Test fun collapsedWorkspaceStateSurvivesSavedInstanceStateRestoration() {
        val restoration = StateRestorationTester(composeRule)
        restoration.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchWorkspaces = listOf(
                            WorkbenchWorkspaceItem(
                                "restore", "runtime", "workspace", "恢复工作区", false,
                                listOf(WorkbenchSessionItem("session", "runtime", "workspace", "恢复会话", false, false, false, 1)),
                            ),
                        ),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onSelectAgent = {}, onRefreshAgents = {},
                    onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(3)
        composeRule.onNodeWithContentDescription("展开或收起工作区").performClick()
        composeRule.onAllNodesWithText("恢复会话").assertCountEquals(0)

        restoration.emulateSavedInstanceStateRestore()
        composeRule.onAllNodesWithText("恢复会话").assertCountEquals(0)
    }

    @Test fun newTaskTargetSelectionIsExplicitAndUserCanOverrideTheRemoteSuggestion() {
        var selected = ""
        val remote = WorkbenchWorkspaceItem("remote", "runtime", "workspace", "计算节点", false, emptyList(), "online")
        composeRule.setContent {
            MaterialTheme {
                NewTaskTargetDialog(
                    remoteTargets = listOf(remote),
                    onDismiss = {},
                    onLocal = { selected = "local" },
                    onRemote = { selected = it.key },
                )
            }
        }
        composeRule.onNodeWithText("Run 创建后会固定到所选 Runtime，不会静默切换。").assertIsDisplayed()
        composeRule.onNodeWithText("计算节点 · 远程 Runtime").assertIsDisplayed()
        composeRule.onNodeWithText("Android 本地 · Lite Runtime").performClick()
        composeRule.runOnIdle { assertEquals("local", selected) }
    }

    @Test
    fun approvalCenterShowsPendingOperationAndEmitsExactDecision() {
        var decision: Pair<String, ApprovalDecision>? = null
        val approval = ApprovalUiItem(
            "approval-1", "files.write", "session", "android-local", "session-1", "9999999999999",
        )
        composeRule.setContent {
            MaterialTheme {
                ApprovalsScreen(listOf(approval), onBack = {}) { id, value -> decision = id to value }
            }
        }
        composeRule.onNodeWithText("files.write").assertIsDisplayed()
        composeRule.onNodeWithText("本会话允许").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals("approval-1" to ApprovalDecision.ALLOW_SESSION, decision) }
    }

    @Test fun inlineApprovalCardUsesTheSameExactDecisionContract() {
        var decision: Pair<String, ApprovalDecision>? = null
        composeRule.setContent {
            MaterialTheme {
                PendingApprovalCard(
                    ApprovalUiItem("approval-inline", "workspace.write", "session", "android-local", "s", "9999999999999"),
                    count = 2,
                    onOpenAll = {},
                    onDecision = { id, value -> decision = id to value },
                )
            }
        }
        composeRule.onNodeWithText("workspace.write").assertIsDisplayed()
        composeRule.onNodeWithText("允许一次").performClick()
        composeRule.runOnIdle { assertEquals("approval-inline" to ApprovalDecision.ALLOW_ONCE, decision) }
    }

    @Test fun drawerGlobalMessageResultOpensItsOwningSession() {
        val session = WorkbenchSessionItem("s1", "android-local", "local", "会话", true, false, false, 1)
        var opened = ""
        composeRule.setContent {
            MaterialTheme {
                NavigationDrawer(
                    state = AppState(
                        destination = AppDestination.Chat,
                        workbenchSearchResults = listOf(WorkbenchSearchItem(session, "needle in message", true)),
                    ),
                    onNewConversation = {}, onOpenConversation = {}, onOpenWorkbenchSession = { opened = it.sessionId },
                    onSelectAgent = {}, onRefreshAgents = {}, onOpenProfile = {}, onOpenRemoteWorkspaces = {},
                )
            }
        }
        composeRule.onNode(hasSetTextAction()).performTextInput("needle")
        composeRule.onNodeWithTag("drawer-list").performScrollToIndex(4)
        composeRule.onNodeWithText("needle in message").performSemanticsAction(SemanticsActions.OnClick)
        composeRule.runOnIdle { assertEquals("s1", opened) }
    }

    @Test
    fun attachmentMenuAndAttachmentOnlySendAreAvailable() {
        var sends = 0
        val draft = AttachmentDraft(
            id = "a1", name = "report.pdf", mimeType = "application/pdf", size = 1024,
            kind = "file", localPath = "/cache/report.pdf", status = AttachmentStatus.READY,
        )
        composeRule.setContent {
            MaterialTheme {
                Composer(
                    state = AppState(destination = AppDestination.Chat, attachmentDrafts = listOf(draft)),
                    onSend = { sends += 1 },
                    onStop = {},
                )
            }
        }
        composeRule.onNodeWithText("report.pdf").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("发送").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, sends) }
        composeRule.onNodeWithContentDescription("添加附件").performClick()
        composeRule.onNodeWithText("拍照").assertIsDisplayed()
        composeRule.onNodeWithText("从相册选择").assertIsDisplayed()
        composeRule.onNodeWithText("选择文件").assertIsDisplayed()
    }

    @Test
    fun attachmentSendKeepsTextUntilUploadsAreAccepted() {
        val draft = AttachmentDraft(
            id = "a1", name = "report.pdf", mimeType = "application/pdf", size = 1024,
            kind = "file", localPath = "/cache/report.pdf", status = AttachmentStatus.READY,
        )
        val currentState = mutableStateOf(AppState(destination = AppDestination.Chat, attachmentDrafts = listOf(draft)))
        composeRule.setContent {
            MaterialTheme {
                Composer(state = currentState.value, onSend = {}, onStop = {})
            }
        }

        composeRule.onNode(hasSetTextAction()).performTextInput("保留这段说明")
        composeRule.onNodeWithContentDescription("发送").performClick()
        composeRule.onNodeWithText("保留这段说明").assertIsDisplayed()

        composeRule.runOnIdle {
            currentState.value = currentState.value.copy(
                streaming = false,
                attachmentDrafts = listOf(draft.copy(status = AttachmentStatus.FAILED, error = "网络中断")),
            )
        }
        composeRule.onNodeWithText("保留这段说明").assertIsDisplayed()

        composeRule.runOnIdle {
            currentState.value = currentState.value.copy(
                streaming = true,
                attachmentDrafts = emptyList(),
                messages = listOf(ChatMessage("m1", "c1", "user", "保留这段说明")),
            )
        }
        composeRule.onAllNodesWithText("保留这段说明").assertCountEquals(0)
    }

    @Test
    fun mainInterfaceReferenceRenders() {
        composeRule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    Welcome(DEFAULT_AGENT, Modifier.fillMaxSize().padding(top = 82.dp, bottom = 92.dp))
                    FloatingHeader({}, {}, true, Modifier.align(Alignment.TopCenter).padding(12.dp))
                    Composer(
                        state = AppState(destination = AppDestination.Chat),
                        onSend = {},
                        onStop = {},
                        modifier = Modifier.align(Alignment.BottomCenter),
                    )
                }
            }
        }

        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(target.filesDir, "main-interface-reference.png")
        val captured = composeRule.onRoot().captureToImage().asAndroidBitmap()
        val scaled = Bitmap.createScaledBitmap(captured, 240, 533, true)
        FileOutputStream(output).use { stream ->
            scaled.compress(Bitmap.CompressFormat.PNG, 100, stream)
        }
    }
}
