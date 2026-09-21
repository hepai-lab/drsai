package ai.drsai.remote.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.WindowManager
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextReplacement
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelProviderConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ModelSettingsScreenUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun editingThenBackRequiresUnsavedChangesConfirmation() {
        render()
        rule.onNodeWithTag("edit-model-provider-custom-provider").performClick()
        rule.onAllNodes(hasSetTextAction())[0].performTextReplacement("Renamed")
        rule.onNodeWithTag("model-provider-editor-back").performClick()

        rule.onNodeWithText("放弃未保存的修改？").assertIsDisplayed()
        rule.onNodeWithText("继续编辑").performClick()
        rule.onNodeWithTag("model-provider-save").assertIsDisplayed()
    }

    @Test fun providerRowExpandsAndCollapsesItsModels() {
        render()
        rule.onNodeWithText("Custom model").assertIsDisplayed()
        rule.onNodeWithTag("model-provider-row-custom-provider").performClick()
        rule.onAllNodesWithText("Custom model").assertCountEquals(0)
        rule.onNodeWithTag("model-provider-row-custom-provider").performClick()
        rule.onNodeWithText("Custom model").assertIsDisplayed()
    }

    @Test fun deletingProviderShowsModelAndDefaultImpactBeforeCallback() {
        var deleted: String? = null
        render(onDelete = { deleted = it })
        rule.onNodeWithTag("delete-model-provider-custom-provider").performClick()

        rule.onNodeWithText("当前默认模型", substring = true).assertIsDisplayed()
        rule.runOnIdle { assertEquals(null, deleted) }
        rule.onNodeWithText("删除").performClick()
        rule.runOnIdle { assertEquals("custom-provider", deleted) }
    }

    @Test fun savedStateRestorationNeverRepeatsACompletedSaveSubmission() {
        var saves = 0
        val restoration = StateRestorationTester(rule)
        restoration.setContent {
            MaterialTheme {
                ModelSettingsScreen(
                    state = state(), onBack = {}, onSelectModel = {}, onDeleteProvider = {},
                    onSaveProvider = { _, _, _, _, _, _, _, _ -> saves += 1 },
                    onDiscoverModels = { _, _, _, _ -> }, onTestConnection = { _, _, _, _, _ -> },
                    onClearMessage = {},
                )
            }
        }
        rule.onNodeWithTag("edit-model-provider-custom-provider").performClick()
        rule.onNodeWithTag("model-provider-save").performClick()
        rule.runOnIdle { assertEquals(1, saves) }

        restoration.emulateSavedInstanceStateRestore()

        rule.runOnIdle { assertEquals(1, saves) }
    }

    @Test fun zhizengzengPresetPrefillsEndpointAndDefaultModels() {
        render()
        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("智增增").assertIsDisplayed().performClick()

        rule.onNodeWithText("https://api.zhizengzeng.com/v1/chat/completions").assertIsDisplayed()
        rule.onAllNodesWithText("deepseek-v4-flash").assertCountEquals(2)
        rule.onNodeWithTag("provider-api-key").assertIsEnabled()
        rule.onAllNodesWithText("OpenAI Compatible").assertCountEquals(0)
        rule.onNodeWithTag("model-provider-editor-list").performScrollToIndex(6)
        rule.onAllNodesWithText("deepseek-v4-pro").assertCountEquals(2)
    }

    @Test fun openAiPresetNeedsOnlyKeyAndRecommendedModelChoice() {
        render()
        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("OpenAI").assertIsDisplayed().performClick()

        rule.onNodeWithText("https://api.openai.com/v1/chat/completions").assertIsDisplayed()
        rule.onNodeWithTag("provider-api-key").assertIsEnabled()
        rule.onAllNodesWithText("gpt-5.1").assertCountEquals(2)
    }

    @Test fun hepAiPresetPinsSignedInEndpointAndRecommendedModel() {
        render()
        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("HepAI").assertIsDisplayed().performClick()

        rule.onAllNodesWithText("deepseek-ai/deepseek-v4-pro").assertCountEquals(2)
    }

    @Test fun credentialEditorBlocksScreenshotsAndScrubsDraftWhenDiscarded() {
        var activity: Activity? = null
        rule.setContent {
            activity = LocalContext.current as? Activity
            MaterialTheme {
                ModelSettingsScreen(
                    state = state(), onBack = {}, onSelectModel = {}, onDeleteProvider = {},
                    onSaveProvider = { _, _, _, _, _, _, _, _ -> },
                    onDiscoverModels = { _, _, _, _ -> }, onTestConnection = { _, _, _, _, _ -> },
                    onClearMessage = {},
                )
            }
        }
        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("智增增").performClick()
        val clipboard = activity!!.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("sentinel", "clipboard-before-entry"))
        rule.onNodeWithTag("provider-api-key").performTextReplacement("secret-draft-canary")
        rule.runOnIdle {
            assertTrue(activity!!.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        }
        assertTrue(
            rule.onNodeWithTag("provider-api-key").fetchSemanticsNode()
                .config.contains(SemanticsProperties.Password),
        )
        assertEquals("clipboard-before-entry", clipboard.primaryClip?.getItemAt(0)?.text?.toString())

        rule.onNodeWithTag("model-provider-editor-back").performClick()
        rule.onNodeWithText("放弃修改").performClick()
        rule.runOnIdle {
            assertEquals(0, activity!!.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE)
        }

        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("智增增").performClick()
        val editable = rule.onNodeWithTag("provider-api-key").fetchSemanticsNode()
            .config[SemanticsProperties.EditableText].text
        assertEquals("", editable)
        clipboard.clearPrimaryClip()
    }

    @Test fun credentialDraftIsExcludedFromSavedInstanceState() {
        val restoration = StateRestorationTester(rule)
        restoration.setContent {
            MaterialTheme {
                ModelSettingsScreen(
                    state = state(), onBack = {}, onSelectModel = {}, onDeleteProvider = {},
                    onSaveProvider = { _, _, _, _, _, _, _, _ -> },
                    onDiscoverModels = { _, _, _, _ -> }, onTestConnection = { _, _, _, _, _ -> },
                    onClearMessage = {},
                )
            }
        }
        rule.onNodeWithTag("add-model-provider").performClick()
        rule.onNodeWithText("智增增").performClick()
        rule.onNodeWithTag("provider-api-key").performTextReplacement("saved-state-secret-canary")

        restoration.emulateSavedInstanceStateRestore()

        rule.onNodeWithTag("add-model-provider").assertIsDisplayed()
        rule.onAllNodesWithText("saved-state-secret-canary").assertCountEquals(0)
    }

    private fun render(onDelete: (String) -> Unit = {}) {
        val state = state()
        rule.setContent {
            MaterialTheme {
                ModelSettingsScreen(
                    state = state, onBack = {}, onSelectModel = {}, onDeleteProvider = onDelete,
                    onSaveProvider = { _, _, _, _, _, _, _, _ -> },
                    onDiscoverModels = { _, _, _, _ -> }, onTestConnection = { _, _, _, _, _ -> },
                    onClearMessage = {},
                )
            }
        }
    }

    private fun state(): AppState {
        val model = ModelInfo(
            "stable-model", "Custom model", providerId = "custom-provider", upstreamId = "upstream-model",
        )
        val provider = ModelProviderConfig(
            "custom-provider", "Custom provider", "https://example.com/v1", listOf(model.id),
            presetId = "custom", hasApiKey = true,
        )
        return AppState(
            modelProviders = listOf(provider), configuredProviderModels = listOf(model), selectedModel = model,
        )
    }
}
