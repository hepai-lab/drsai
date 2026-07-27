package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ai.drsai.remote.remote.data.parseAccessGrantCode

class RemoteWorkspaceUiTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun emptyStateAndOverflowBothExposeAssociation() {
        var associateCalls = 0
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(),
                    onBack = {},
                    onAssociate = { associateCalls += 1 },
                    onRefresh = {},
                    onOpenWorkspace = {},
                )
            }
        }

        composeRule.onNodeWithText("还没有关联的计算机").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("扫码关联主按钮").assertIsDisplayed().performClick()
        composeRule.onNodeWithContentDescription("更多").performClick()
        composeRule.onNodeWithContentDescription("扫码关联菜单项").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(2, associateCalls) }
    }

    @Test
    fun computerExpandsWorkspaceAndRoutesByReference() {
        var opened: RemoteWorkspaceRef? = null
        val workspace = RemoteWorkspaceRef(RuntimeId("runtime-a"), WorkspaceId("workspace-a"), "OpenDrSai")
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(
                        computers = listOf(
                            RemoteComputerUi(
                                runtimeId = RuntimeId("runtime-a"),
                                displayName = "开发服务器",
                                state = RemoteConnectionState.ONLINE,
                                lastSeenLabel = "刚刚",
                                version = "1.4.6",
                                instanceId = "boot-2",
                                connectionGeneration = 2,
                                workspaces = listOf(workspace),
                            )
                        )
                    ),
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onOpenWorkspace = { opened = it },
                )
            }
        }

        composeRule.onNodeWithText("开发服务器").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("连接状态：在线").assertIsDisplayed()
        composeRule.onNodeWithText("刚刚").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai 1.4.6").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(workspace, opened) }
    }

    @Test
    fun computerConnectionStatesUseAccessibleDotIndicators() {
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(
                        computers = listOf(
                            RemoteComputerUi(
                                RuntimeId("online"),
                                "在线计算机",
                                RemoteConnectionState.ONLINE,
                                "刚刚连接",
                                emptyList(),
                            ),
                            RemoteComputerUi(
                                RuntimeId("offline"),
                                "离线计算机",
                                RemoteConnectionState.OFFLINE,
                                "离线",
                                emptyList(),
                            ),
                            RemoteComputerUi(
                                RuntimeId("connecting"),
                                "连接中计算机",
                                RemoteConnectionState.CONNECTING,
                                "",
                                emptyList(),
                            ),
                        ),
                    ),
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onOpenWorkspace = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription("连接状态：在线").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("连接状态：离线").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("连接状态：正在连接").assertIsDisplayed()
        composeRule.onNodeWithText("连接中…").assertIsDisplayed()
    }

    @Test fun associationQrDeepLinkExtractsOnlyOneTimeCode() {
        assertEquals(
            "abcdefghijklmnop",
            parseAccessGrantCode(
                "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=abcdefghijklmnop",
            ),
        )
    }

    @Test fun newlyAssociatedComputerIsHighlightedAfterRefresh() {
        val runtimeId = RuntimeId("runtime-new")
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(
                        computers = listOf(RemoteComputerUi(runtimeId, "刚关联的电脑", RemoteConnectionState.ONLINE,
                            "刚刚连接", emptyList())),
                        recentlyAssociatedRuntimeId = runtimeId,
                    ),
                    onBack = {}, onAssociate = {}, onRefresh = {}, onOpenWorkspace = {},
                )
            }
        }
        composeRule.onNodeWithText("刚关联的电脑").assertIsDisplayed()
        composeRule.onNodeWithText("刚刚关联").assertIsDisplayed()
    }

    @Test fun directorySearchIsVisibleAndForwardsInput() {
        var query = ""
        val state = mutableStateOf(RemoteHomeUiState(computers = emptyList()))
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = state.value,
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onOpenWorkspace = {},
                    onQueryChange = {
                        query = it
                        state.value = state.value.copy(query = it)
                    },
                )
            }
        }

        composeRule.onNodeWithContentDescription("搜索远程工作区").assertIsDisplayed().performTextInput("项目")
        composeRule.runOnIdle { assertEquals("项目", query) }
    }

    @Test fun workspaceSessionScreenShowsVerifiedProjectInstructionSnapshot() {
        var confirmed = 0
        composeRule.setContent {
            MaterialTheme {
                WorkspaceSessionsScreen(
                    state = WorkspaceSessionsUiState(
                        runtimeName = "开发机",
                        workspaceName = "项目",
                        instructionVersions = mapOf("remote:AGENTS.md" to "abcdef1234567890"),
                        instructionStatus = "项目指令版本已变化，请确认后再新建会话",
                        instructionRefreshRequired = true,
                    ),
                    onBack = {}, onRefresh = {}, onSearch = {}, onCreate = {}, onOpen = {},
                    onConfirmInstructions = { confirmed += 1 },
                )
            }
        }
        composeRule.onNodeWithText("项目指令版本已变化，请确认后再新建会话 · abcdef123456").assertIsDisplayed()
        composeRule.onNodeWithText("新会话").assertIsNotEnabled()
        composeRule.onNodeWithText("确认使用最新项目指令").performClick()
        composeRule.runOnIdle { assertEquals(1, confirmed) }
    }

    @Test fun workspaceDetailsExposeOnlyCapabilityGatedReadsAndExplainDangerousApproval() {
        composeRule.setContent {
            MaterialTheme {
                WorkspaceSessionsScreen(
                    state = WorkspaceSessionsUiState(
                        runtimeName = "开发机",
                        workspaceName = "项目",
                        capabilities = listOf(
                            RemoteCapabilityUi("Files", false),
                            RemoteCapabilityUi("Git", true),
                        ),
                    ),
                    onBack = {}, onRefresh = {}, onSearch = {}, onCreate = {}, onOpen = {},
                )
            }
        }

        composeRule.onNodeWithText("Files").assertIsNotEnabled()
        composeRule.onNodeWithText("Git").assertIsEnabled()
        composeRule.onNodeWithText(
            "文件写入、命令和 Git 修改只能在远程会话中发起，并需要逐项审批；Android 不会在设备上静默执行。",
        ).assertIsDisplayed()
        composeRule.onAllNodesWithText("执行 Shell").assertCountEquals(0)
        composeRule.onAllNodesWithText("写入文件").assertCountEquals(0)
    }
}
