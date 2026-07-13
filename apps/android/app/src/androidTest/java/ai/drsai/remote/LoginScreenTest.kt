package ai.drsai.remote

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LoginScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun signedOutUserSeesRealLoginEntry() {
        composeRule.onNodeWithContentDescription("OpenDrSai Logo").assertIsDisplayed()
        composeRule.onNodeWithText("OpenDrSai").assertIsDisplayed()
        composeRule.onNodeWithText("使用 HepAI 继续").assertIsDisplayed()
    }
}
