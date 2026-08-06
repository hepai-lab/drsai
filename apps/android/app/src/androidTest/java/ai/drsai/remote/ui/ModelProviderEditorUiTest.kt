package ai.drsai.remote.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import ai.drsai.remote.data.ModelInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ModelProviderEditorUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun bulkClearRequiresConfirmationAndOnlyChangesDraft() {
        var models by mutableStateOf(listOf(model("a"), model("b")))
        render(models, onModelsChange = { models = it })

        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(4)
        rule.onNodeWithTag("clear-all-models").performClick()
        rule.onNodeWithTag("clear-models-confirmation").assertExists()
        rule.onAllNodesWithText("清空")[1].performClick()
        rule.runOnIdle { assertEquals(0, models.size) }
    }

    @Test fun searchFiltersWithoutDeletingDraftModels() {
        var models by mutableStateOf(listOf(model("alpha"), model("beta")))
        render(models, onModelsChange = { models = it })
        rule.onNodeWithTag("model-search").performTextInput("alpha")

        rule.onAllNodesWithText("beta", substring = true).assertCountEquals(0)
        rule.runOnIdle { assertEquals(2, models.size) }
    }

    @Test fun disablingDefaultModelRequiresImpactConfirmationBeforeSave() {
        var saves = 0
        val disabled = model("current").copy(enabled = false)
        render(listOf(disabled), selectedModelId = "current", onSave = { saves += 1 })

        rule.onNodeWithTag("model-provider-save").performClick()
        rule.onNodeWithText("当前默认模型将被停用").assertIsDisplayed()
        rule.runOnIdle { assertEquals(0, saves) }
        rule.onNodeWithText("继续保存").performClick()
        rule.runOnIdle { assertEquals(1, saves) }
    }

    @Test fun bulkEnableAndDisableUpdateEveryDraftModel() {
        var updated = emptyList<ModelInfo>()
        val initial = listOf(model("enabled"), model("disabled").copy(enabled = false))
        render(initial, onModelsChange = { updated = it })

        rule.onNodeWithText("全部启用").performClick()
        rule.runOnIdle { assertEquals(listOf(true, true), updated.map(ModelInfo::enabled)) }

        rule.onNodeWithText("全部停用").performClick()
        rule.runOnIdle { assertEquals(listOf(false, false), updated.map(ModelInfo::enabled)) }
    }

    @Test fun multiSelectDeleteCanBeUndoneBeforeSave() {
        var updated = emptyList<ModelInfo>()
        val initial = listOf(model("a"), model("b"), model("c"))
        render(initial, onModelsChange = { updated = it })

        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(4)
        rule.onNodeWithTag("toggle-model-selection").performClick()
        rule.onNodeWithTag("select-model-0").performClick()
        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(8)
        rule.onNodeWithTag("select-model-2").performClick()
        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(4)
        rule.onNodeWithTag("delete-selected-models").performClick()
        rule.runOnIdle { assertEquals(listOf("b"), updated.map(ModelInfo::id)) }

        rule.onNodeWithText("撤销").performClick()
        rule.runOnIdle { assertEquals(listOf("a", "b", "c"), updated.map(ModelInfo::id)) }
    }

    @Test fun fiveHundredModelsScrollAndBulkUpdateWithoutAnrOrSlowDraftMutation() {
        val models = (0 until 500).map { model("model-$it") }
        var updatedCount = 0
        render(models, onModelsChange = { updatedCount = it.size })

        val start = android.os.SystemClock.elapsedRealtime()
        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(505)
        rule.onNodeWithTag("model-card-499").assertIsDisplayed()
        val scrollElapsed = android.os.SystemClock.elapsedRealtime() - start
        assertTrue("500-model scroll took ${scrollElapsed}ms", scrollElapsed < 5_000)

        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(4)
        val bulkStart = android.os.SystemClock.elapsedRealtime()
        rule.onNodeWithText("全部停用").performClick()
        rule.runOnIdle { assertEquals(500, updatedCount) }
        val bulkElapsed = android.os.SystemClock.elapsedRealtime() - bulkStart
        assertTrue("500-model bulk mutation took ${bulkElapsed}ms", bulkElapsed < 300)
    }

    private fun render(
        initialModels: List<ModelInfo>,
        selectedModelId: String? = null,
        onModelsChange: (List<ModelInfo>) -> Unit = {},
        onSave: () -> Unit = {},
    ) {
        rule.setContent {
            MaterialTheme {
                ModelProviderEditorScreen(
                    providerId = "provider", presetId = "custom", name = "Provider", onNameChange = {},
                    baseUrl = "https://example.com/v1", onBaseUrlChange = {}, wireApi = "openai", onWireApiChange = {},
                    apiKey = "", onApiKeyChange = {}, models = initialModels, onModelsChange = onModelsChange,
                    busy = false, message = null, hasSavedKey = true, nameEditable = true, baseUrlEditable = true,
                    selectedModelId = selectedModelId, onBack = {}, onDiscover = {}, onTestConnection = {}, onSave = onSave,
                )
            }
        }
    }

    private fun model(id: String) = ModelInfo(id, id, upstreamId = id, enabled = true)
}
