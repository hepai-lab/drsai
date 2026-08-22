package ai.drsai.remote.ui

import android.graphics.Bitmap
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ai.drsai.remote.remote.model.OaepProcessItem
import ai.drsai.remote.remote.model.OaepResultItem
import ai.drsai.remote.remote.model.OaepSourceLink
import ai.drsai.remote.remote.model.OaepTimelineEntry
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import org.junit.Rule
import org.junit.Test

class OaepToolVisibilityUiTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun toolProgressSourcesFailureAndExecutionLocationAreVisible() {
        val turn = OaepTimelineEntry.AssistantTurn(
            stableId = "run:visibility", runId = "visibility", status = "failed",
            startedAt = "now", completedAt = "later",
            process = listOf(
                OaepProcessItem(
                    "search", "tool", "正在搜索网页", "正在检索 HEPiX 2026", "running",
                    detail = "web.search", executionLocation = "Android Agent Runtime · Android Host",
                    sources = listOf(OaepSourceLink("HEPiX search result", "https://www.hepix.org/")),
                ),
                OaepProcessItem(
                    "fetch", "tool", "网页读取", "provider_http_408 · api_key=[REDACTED]", "failed",
                    detail = "web.fetch · Provider request timed out; retry later.",
                    executionLocation = "Android Agent Runtime · Android Host",
                ),
                OaepProcessItem(
                    "delegate", "subtask", "正在委派 · 核验会议日期", "等待 Subagent", "running",
                    executionLocation = "Subagent · explore",
                ),
            ),
            interactions = emptyList(),
            results = listOf(OaepResultItem(
                "answer", "markdown", text = "已核验的回答", status = "completed",
                sources = listOf(OaepSourceLink("HEPiX 官方来源", "https://www.hepix.org/")),
            )),
        )
        rule.setContent { MaterialTheme { androidx.compose.foundation.layout.Column(Modifier.verticalScroll(rememberScrollState())) { OaepAssistantTurn(turn) } } }

        rule.onNodeWithText("执行过程").performClick()
        rule.onNodeWithText("正在搜索网页").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("正在委派 · 核验会议日期").performScrollTo().assertIsDisplayed()
        rule.onAllNodesWithText("执行位置：Android Agent Runtime · Android Host").assertCountEquals(2)
        rule.onNodeWithText("provider_http_408 · api_key=[REDACTED]").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("web.fetch · Provider request timed out; retry later.").assertIsDisplayed()
        rule.onAllNodesWithText("sk-never-render-this-secret").assertCountEquals(0)
        rule.onNodeWithText("HEPiX search result").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("HEPiX 官方来源").performScrollTo().assertIsDisplayed()

        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(checkNotNull(target.getExternalFilesDir(null)), "p9-m10-f02-tool-source-visibility.png")
        val captured = rule.onRoot().captureToImage().asAndroidBitmap()
        FileOutputStream(output).use { captured.compress(Bitmap.CompressFormat.PNG, 100, it) }
        check(output.length() > 0L)
    }
}
