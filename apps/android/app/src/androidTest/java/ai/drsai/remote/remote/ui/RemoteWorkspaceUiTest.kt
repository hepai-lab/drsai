package ai.drsai.remote.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
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
        composeRule.onNodeWithText("在线 · 刚刚").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai 1.4.6").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed().performClick()
        composeRule.runOnIdle { assertEquals(workspace, opened) }
    }

    @Test fun associationQrDeepLinkExtractsOnlyOneTimeCode() {
        assertEquals("abcdefghijklmnop", parseAccessGrantCode("opendrsai://associate?code=abcdefghijklmnop"))
    }

    @Test fun directorySearchIsVisibleAndForwardsInput() {
        var query = ""
        composeRule.setContent {
            MaterialTheme {
                RemoteHomeScreen(
                    state = RemoteHomeUiState(computers = emptyList()),
                    onBack = {},
                    onAssociate = {},
                    onRefresh = {},
                    onOpenWorkspace = {},
                    onQueryChange = { query = it },
                )
            }
        }

        composeRule.onNodeWithContentDescription("搜索远程工作区").assertIsDisplayed().performTextInput("项目")
        composeRule.runOnIdle { assertEquals("项目", query) }
    }
}
