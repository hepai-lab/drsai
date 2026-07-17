package ai.drsai.remote.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.FileOutputStream

class MainInterfaceTest {
    @get:Rule
    val composeRule = createComposeRule()

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
