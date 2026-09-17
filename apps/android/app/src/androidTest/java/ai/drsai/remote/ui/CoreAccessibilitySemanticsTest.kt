package ai.drsai.remote.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.AppState
import ai.drsai.remote.remote.model.OaepTimelineEntry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class CoreAccessibilitySemanticsTest {
    @get:Rule val rule = createComposeRule()

    @Test fun timeline_reading_order_matches_visual_event_order() {
        rule.setContent {
            MaterialTheme {
                OaepTimeline(
                    listOf(
                        OaepTimelineEntry.UserMessage("first", "第一条消息"),
                        OaepTimelineEntry.UserMessage("second", "第二条消息"),
                    ),
                    2, false, Modifier.fillMaxSize(),
                )
            }
        }
        val first = rule.onNodeWithContentDescription("你的消息，第一条消息").assertIsDisplayed().fetchSemanticsNode()
        val second = rule.onNodeWithContentDescription("你的消息，第二条消息").assertIsDisplayed().fetchSemanticsNode()
        assertTrue(first.boundsInRoot.top < second.boundsInRoot.top)
    }

    @Test fun icon_controls_and_composer_expose_names_and_state() {
        rule.setContent {
            MaterialTheme {
                Composer(
                    AppState(selectedAgent = Agent("local", "OpenDrSai", "", "local", chatSupported = true)),
                    onSend = {}, onStop = {},
                )
            }
        }
        rule.onNodeWithContentDescription("添加附件").assertIsDisplayed().assertIsEnabled()
        rule.onNodeWithContentDescription("语音输入").assertIsDisplayed().assertIsEnabled()
        rule.onNodeWithTag("runtime-composer-input").assertIsDisplayed().assertIsEnabled()
    }

    @Test fun disabled_new_task_control_retains_accessible_name_and_state() {
        rule.setContent { MaterialTheme { FloatingHeader({}, {}, false) } }
        rule.onNodeWithContentDescription("展开侧栏").assertIsDisplayed().assertIsEnabled()
        rule.onNodeWithContentDescription("新对话").assertIsDisplayed().assertIsNotEnabled()
    }
}
