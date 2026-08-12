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
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ai.drsai.remote.remote.data.parseAccessGrantCode
import ai.drsai.remote.remote.data.RemoteActionableState
import ai.drsai.remote.remote.data.RemoteRecoveryAction

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
        var refreshed: RuntimeId? = null
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
                                workspaces = listOf(workspace),
                                workspaceSyncStatus = "已同步 07-28 12:00",
                            )
                        )
                    ),
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onRefreshWorkspaces = { refreshed = it },
                    onOpenWorkspace = { opened = it },
                )
            }
        }

        composeRule.onNodeWithText("开发服务器").assertIsDisplayed()
        composeRule.onNodeWithContentDescription(
            "电脑状态：在线。电脑可用，工作区与会话会保持同步。", useUnmergedTree = true,
        ).assertExists()
        composeRule.onNodeWithText("电脑可用，工作区与会话会保持同步。").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai 1.4.6").assertExists()
        composeRule.onNodeWithText("已同步 07-28 12:00").assertExists()
        composeRule.onNodeWithContentDescription("刷新 开发服务器 的工作区")
            .performScrollTo()
            .performClick()
        composeRule.onNodeWithText("OpenDrSai").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals(RuntimeId("runtime-a"), refreshed)
            assertEquals(workspace, opened)
        }
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
                                "缓存 · 上次同步 07-28 10:30",
                                listOf(
                                    RemoteWorkspaceRef(
                                        RuntimeId("offline"),
                                        WorkspaceId("cached"),
                                        "缓存项目",
                                    )
                                ),
                                workspacesCached = true,
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

        composeRule.onNodeWithContentDescription(
            "电脑状态：在线。电脑可用，工作区与会话会保持同步。", useUnmergedTree = true,
        ).assertExists()
        composeRule.onNodeWithContentDescription(
            "电脑状态：离线。暂时无法联系电脑；缓存 · 上次同步 07-28 10:30。可执行：重试",
            useUnmergedTree = true,
        ).assertExists()
        composeRule.onNodeWithText("缓存项目").assertExists()
        composeRule.onNodeWithContentDescription(
            "电脑状态：正在连接。正在确认电脑是否可用，请稍候。", useUnmergedTree = true,
        ).assertExists()
        composeRule.onNodeWithText("正在连接").assertExists()
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

    @Test
    fun notificationPermissionGapIsActionableWithoutHidingWorkspaces() {
        var enableCalls = 0
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(
                        computers = listOf(
                            RemoteComputerUi(
                                runtimeId = RuntimeId("runtime-notify"),
                                displayName = "开发电脑",
                                state = RemoteConnectionState.ONLINE,
                                lastSeenLabel = "刚刚",
                                workspaces = emptyList(),
                            ),
                        ),
                        notificationState = RemoteNotificationReadiness.PERMISSION_REQUIRED,
                    ),
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onOpenWorkspace = {},
                    onEnableNotifications = { enableCalls += 1 },
                )
            }
        }

        composeRule.onNodeWithText("通知未启用").assertIsDisplayed()
        composeRule.onNodeWithText("允许系统通知后，应用关闭时也能收到任务结果和审批提醒。").assertIsDisplayed()
        composeRule.onNodeWithText("启用通知").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(1, enableCalls) }
        composeRule.onNodeWithText("开发电脑").assertIsDisplayed()
    }

    @Test
    fun hostStatusSemanticAndScreenshotMatrixCoversSixProductStates() {
        val runtimeId = RuntimeId("status-matrix")
        val uiState = mutableStateOf(hostMatrixState(runtimeId, RemoteConnectionState.ONLINE))
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = uiState.value,
                    onBack = {}, onAssociate = {}, onRefresh = {}, onOpenWorkspace = {},
                )
            }
        }

        val snapshots = linkedSetOf<Int>()
        fun verify(state: RemoteHomeUiState, description: String) {
            composeRule.runOnIdle { uiState.value = state }
            composeRule.waitForIdle()
            composeRule.onNodeWithContentDescription(description, useUnmergedTree = true).assertExists()
            val pixels = composeRule.onRoot().captureToImage().asAndroidBitmap()
            var hash = 1
            for (y in 0 until pixels.height step 8) {
                for (x in 0 until pixels.width step 8) hash = 31 * hash + pixels.getPixel(x, y)
            }
            snapshots += hash
        }

        verify(
            hostMatrixState(runtimeId, RemoteConnectionState.ONLINE),
            "电脑状态：在线。电脑可用，工作区与会话会保持同步。",
        )
        verify(
            hostMatrixState(runtimeId, RemoteConnectionState.OFFLINE),
            "电脑状态：离线。暂时无法联系电脑，请确认电脑已开机并联网。可执行：重试",
        )
        verify(
            hostMatrixState(runtimeId, RemoteConnectionState.PAUSED),
            "电脑状态：已暂停。电脑端暂停了移动访问，现有授权仍保留。可执行：恢复后重试",
        )
        verify(
            RemoteHomeUiState(
                error = "access_denied",
                actionableError = RemoteActionableState(
                    "此设备已解除关联", "请在电脑端生成新的二维码。",
                    RemoteRecoveryAction.REASSOCIATE, "重新扫码",
                ),
            ),
            "电脑状态：此设备已解除关联。请在电脑端生成新的二维码。可执行：重新扫码",
        )
        verify(
            hostMatrixState(runtimeId, RemoteConnectionState.INCOMPATIBLE),
            "电脑状态：需要更新。手机或电脑端版本不兼容，更新后才能打开工作区。可执行：检查更新",
        )
        verify(
            hostMatrixState(runtimeId, RemoteConnectionState.ONLINE).copy(
                notificationState = RemoteNotificationReadiness.PERMISSION_REQUIRED,
            ),
            "电脑状态：通知未启用。允许系统通知后，应用关闭时也能收到任务结果和审批提醒。可执行：启用通知",
        )
        assertEquals(6, snapshots.size)
    }

    private fun hostMatrixState(runtimeId: RuntimeId, state: RemoteConnectionState) =
        RemoteHomeUiState(
            computers = listOf(
                RemoteComputerUi(
                    runtimeId = runtimeId,
                    displayName = "状态测试电脑",
                    state = state,
                    lastSeenLabel = "",
                    workspaces = emptyList(),
                ),
            ),
        )

    @Test fun actionableStateShowsOneSafePrimaryAction() {
        var selected: RemoteRecoveryAction? = null
        composeRule.setContent {
            MaterialTheme {
                RemoteActionableStateCard(
                    RemoteActionableState(
                        "登录已过期",
                        "重新登录后可继续使用原有设备授权。",
                        RemoteRecoveryAction.SIGN_IN,
                        "重新登录",
                    ),
                    onAction = { selected = it },
                )
            }
        }
        composeRule.onNodeWithText("登录已过期").assertIsDisplayed()
        composeRule.onNodeWithText("重新登录").assertIsDisplayed().performClick()
        composeRule.onAllNodesWithText("https://internal.example").assertCountEquals(0)
        composeRule.runOnIdle { assertEquals(RemoteRecoveryAction.SIGN_IN, selected) }
    }
}
