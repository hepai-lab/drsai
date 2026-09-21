package ai.drsai.remote.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.waitUntilExactlyOneExists
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.StateRestorationTester
import ai.drsai.remote.remote.model.OaepTimelineEntry
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalTestApi::class)
class OaepTimelineScrollUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun userScrollIsPreservedAcrossRapidDeltasAndReturnToLatestIsExplicit() {
        val timeline = mutableStateOf((0 until 50).map(::message))
        val sequence = mutableStateOf(50L)
        rule.setContent {
            MaterialTheme {
                OaepTimeline(timeline.value, sequence.value, false, Modifier.fillMaxSize())
            }
        }
        rule.waitForIdle()
        rule.onNodeWithTag("oaep-timeline-list").performTouchInput { swipeDown() }
        rule.waitUntilExactlyOneExists(hasTestTag("timeline-return-latest"), 5_000)
        rule.runOnIdle {
            repeat(20) { delta ->
                val index = 50 + delta
                timeline.value = timeline.value + message(index)
                sequence.value = index.toLong()
            }
        }
        rule.waitForIdle()

        rule.onNodeWithTag("timeline-return-latest").assertIsDisplayed().performClick()
        rule.waitUntilExactlyOneExists(hasText("message-69"), 5_000)
        rule.onNodeWithText("message-69").assertIsDisplayed()
    }

    @Test fun userScrollPreferenceSurvivesRotationStyleStateRestoration() {
        val restoration = StateRestorationTester(rule)
        restoration.setContent {
            MaterialTheme { OaepTimeline((0 until 50).map(::message), 50, false, Modifier.fillMaxSize()) }
        }
        rule.waitForIdle()
        rule.onNodeWithTag("oaep-timeline-list").performTouchInput { swipeDown() }
        rule.waitUntilExactlyOneExists(hasTestTag("timeline-return-latest"), 5_000)

        restoration.emulateSavedInstanceStateRestore()

        rule.onNodeWithTag("timeline-return-latest").assertIsDisplayed()
    }

    private fun message(index: Int) = OaepTimelineEntry.UserMessage("message-$index", "message-$index")
}
