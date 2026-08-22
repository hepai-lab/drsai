package ai.drsai.remote.ui

import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ModelInfo
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.FileOutputStream

class ModelProviderVisualEvidenceTest {
    @get:Rule val rule = createComposeRule()

    @Test fun exportsSamsungEditorEvidenceWithStoredKeyHidden() {
        val models = listOf(
            model("gpt-5.1").copy(name = "GPT-5.1", tools = true, reasoning = true),
            model("gpt-5-mini").copy(name = "GPT-5 mini", vision = true),
            model("gpt-4o").copy(name = "GPT-4o", enabled = false, vision = true),
        )
        rule.setContent {
            MaterialTheme {
                ModelProviderEditorScreen(
                    providerId = "provider", presetId = "custom", name = "Provider", onNameChange = {},
                    baseUrl = "https://example.com/v1", onBaseUrlChange = {}, wireApi = "openai", onWireApiChange = {},
                    apiKey = "", onApiKeyChange = {}, models = models, onModelsChange = {}, busy = false, message = null,
                    hasSavedKey = true, nameEditable = true, baseUrlEditable = true, selectedModelId = null,
                    onBack = {}, onDiscover = {}, onTestConnection = {}, onSave = {},
                )
            }
        }
        rule.onNodeWithText("已安全保存；留空表示不修改").assertExists()
        rule.onAllNodesWithText("sk-", substring = true).assertCountEquals(0)

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val orientation = context.resources.configuration.orientation
        val suffix = if (orientation == Configuration.ORIENTATION_LANDSCAPE) "landscape" else "portrait"
        val output = File(context.getExternalFilesDir(null), "model-provider-editor-$suffix.png")
        val bitmap = rule.onRoot().captureToImage().asAndroidBitmap()
        FileOutputStream(output).use { stream -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream) }
        assertTrue("Screenshot was not created", output.isFile && output.length() > 0)
    }

    private fun model(id: String) = ModelInfo(id, id, upstreamId = id, enabled = true)
}
