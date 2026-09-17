package ai.drsai.remote

import ai.drsai.remote.data.AndroidModelProviderPresets
import org.junit.Assert.*
import org.junit.Test

class ModelProviderPresetTest {
    @Test fun `product presets pin endpoint protocol and recommended models`() {
        val hepaiUrl = "https://hai.example/apiv2/v1"
        val presets = AndroidModelProviderPresets.all(hepaiUrl).associateBy { it.id }

        presets.getValue("hepai").also {
            assertEquals(hepaiUrl, it.baseUrl)
            assertEquals("openai", it.wireApi)
            assertEquals(listOf("deepseek-ai/deepseek-v4-pro"), it.suggestedModels)
            assertFalse(it.baseUrlEditable)
        }
        presets.getValue("openai").also {
            assertEquals("https://api.openai.com/v1", it.baseUrl)
            assertEquals("openai", it.wireApi)
            assertTrue(it.suggestedModels.isNotEmpty())
            assertFalse(it.baseUrlEditable)
        }
        presets.getValue("zhizengzeng").also {
            assertEquals("https://api.zhizengzeng.com/v1", it.baseUrl)
            assertEquals("openai", it.wireApi)
            assertEquals(listOf("deepseek-v4-flash", "deepseek-v4-pro"), it.suggestedModels)
            assertEquals(it.suggestedModels.toSet(), it.toolCapableModels)
            assertFalse(it.baseUrlEditable)
        }
    }
}
