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
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import ai.drsai.remote.remote.model.OaepProcessItem
import ai.drsai.remote.remote.model.OaepResultItem
import ai.drsai.remote.remote.model.OaepSourceLink
import ai.drsai.remote.remote.model.OaepTimelineEntry
import ai.drsai.remote.remote.model.OaepTaskProgress
import ai.drsai.remote.remote.model.OaepTaskStep
import ai.drsai.remote.runtime.security.ToolOperationOutcome
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileOutputStream
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

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
                OaepProcessItem(
                    "plan", "plan", "任务计划", "", "running",
                    taskProgress = OaepTaskProgress("调研并形成报告", listOf(
                        OaepTaskStep("检索资料", "completed"), OaepTaskStep("核对来源", "running"),
                        OaepTaskStep("生成图表", "failed"),
                    )),
                ),
            ),
            interactions = emptyList(),
            results = listOf(OaepResultItem(
                "answer", "markdown", text = "已核验的回答", status = "completed",
                sources = listOf(OaepSourceLink("HEPiX 官方来源", "https://www.hepix.org/")),
            )),
        )
        rule.setContent { MaterialTheme { androidx.compose.foundation.layout.Column(Modifier.verticalScroll(rememberScrollState())) { OaepAssistantTurn(turn) } } }

        val target = InstrumentationRegistry.getInstrumentation().targetContext
        fun screenshot(name: String) {
            val output = File(checkNotNull(target.getExternalFilesDir(null)), name)
            val captured = rule.onRoot().captureToImage().asAndroidBitmap()
            FileOutputStream(output).use { captured.compress(Bitmap.CompressFormat.PNG, 100, it) }
            check(output.length() > 0L)
        }

        rule.onAllNodesWithText("web.search").assertCountEquals(0)
        screenshot("p10-m04-f02-default.png")
        rule.onNodeWithText(target.getString(ai.drsai.remote.R.string.execution_process)).performClick()
        rule.onNodeWithText("正在搜索网页").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("正在委派 · 核验会议日期").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(target.getString(ai.drsai.remote.R.string.task_goal, "调研并形成报告")).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(target.getString(ai.drsai.remote.R.string.task_progress_summary, 1, 1, 0, 1)).assertIsDisplayed()
        rule.onNodeWithText(target.getString(ai.drsai.remote.R.string.partial_failure_notice)).assertIsDisplayed()
        rule.onAllNodesWithText(target.getString(ai.drsai.remote.R.string.execution_location, "Android Agent Runtime · Android Host")).assertCountEquals(2)
        rule.onAllNodesWithText("web.fetch · Provider request timed out; retry later.").assertCountEquals(0)
        screenshot("p10-m04-f02-expanded.png")
        rule.onNodeWithTag("oaep-advanced-details").performScrollTo().performClick()
        rule.onNodeWithText(target.getString(ai.drsai.remote.R.string.internal_detail, "web.fetch · Provider request timed out; retry later.")).performScrollTo().assertIsDisplayed()
        rule.onAllNodesWithText("sk-never-render-this-secret").assertCountEquals(0)
        val webLabel = target.getString(ai.drsai.remote.R.string.source_web)
        rule.onNodeWithText("$webLabel · HEPiX search result").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("$webLabel · HEPiX 官方来源").performScrollTo().assertIsDisplayed()
        screenshot("p10-m04-f02-advanced.png")
    }

    @Test
    fun eachRunHasExactlyOneVisibleSnapshotDerivedOutcome() {
        val turns = listOf(
            OaepTimelineEntry.AssistantTurn("run:done", "done", "completed", "now", "later", emptyList(), emptyList(), emptyList()),
            OaepTimelineEntry.AssistantTurn("run:failed", "failed", "failed", "now", "later", emptyList(), emptyList(), emptyList()),
            OaepTimelineEntry.AssistantTurn("run:cancel", "cancel", "cancelled", "now", "later", emptyList(), emptyList(), emptyList()),
            OaepTimelineEntry.AssistantTurn("run:resume", "resume", "waiting", "now", null, emptyList(), emptyList(), emptyList()),
            OaepTimelineEntry.AssistantTurn(
                "run:partial", "partial", "completed", "now", "later",
                listOf(OaepProcessItem("failed-step", "tool", "步骤", "", "failed")), emptyList(), emptyList(),
            ),
        )
        rule.setContent {
            MaterialTheme {
                androidx.compose.foundation.layout.Column(Modifier.verticalScroll(rememberScrollState())) {
                    turns.forEach { OaepAssistantTurn(it) }
                }
            }
        }

        mapOf("done" to "已完成", "failed" to "执行失败", "cancel" to "已取消", "resume" to "已暂停，可继续", "partial" to "部分完成")
            .forEach { (runId, label) ->
                rule.onAllNodesWithTag("run-outcome-$runId").assertCountEquals(1)
                rule.onNodeWithText(label).assertIsDisplayed()
            }
    }

    @Test fun operationOutcomeShowsExactCompletedAndMissingWorkAndOnlyRealUndoEntry() {
        var remedy = ""
        val turn = OaepTimelineEntry.AssistantTurn(
            "run:operation", "operation", "completed", "now", "later",
            process = listOf(
                OaepProcessItem(
                    "write", "tool", "工作区文件已修改", "", "completed",
                    operationOutcome = ToolOperationOutcome(
                        completed = "notes.txt 已更新", notExecuted = null,
                        remedyLabel = "撤销此修改", remedyPrompt = "undo-token-1",
                    ),
                ),
                OaepProcessItem(
                    "partial", "tool", "服务操作失败", "", "failed",
                    operationOutcome = ToolOperationOutcome(
                        completed = "已创建 2 项", notExecuted = "第 3 项未创建",
                        irreversibleNotice = "该外部操作通常不可撤销；如需补救，请执行新的反向操作",
                    ),
                ),
            ), interactions = emptyList(), results = emptyList(),
        )
        rule.setContent { MaterialTheme { OaepAssistantTurn(turn, onRemedy = { remedy = it }) } }
        rule.onNodeWithText(
            InstrumentationRegistry.getInstrumentation().targetContext.getString(ai.drsai.remote.R.string.execution_process),
        ).performClick()
        rule.onNodeWithText("已完成：notes.txt 已更新").assertIsDisplayed()
        rule.onNodeWithText("未执行：第 3 项未创建").assertIsDisplayed()
        rule.onNodeWithText("该外部操作通常不可撤销；如需补救，请执行新的反向操作").assertIsDisplayed()
        rule.onAllNodesWithText("撤销此修改").assertCountEquals(1)
        rule.onNodeWithText("撤销此修改").performClick()
        rule.runOnIdle { assertEquals("undo-token-1", remedy) }
    }
}
