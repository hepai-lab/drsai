package ai.drsai.remote

import ai.drsai.remote.data.AndroidModelProviderPresets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelProviderPresetTest {
    @Test fun builtInCatalogIncludesNamedCustomProvider() {
        val presets = AndroidModelProviderPresets.all("https://hepai.example/v1")
        assertEquals(listOf("hepai", "openai", "anthropic", "deepseek", "zhizengzeng", "ollama", "custom"), presets.map { it.id })
        assertTrue(presets.single { it.id == "custom" }.nameEditable)
        assertTrue(presets.single { it.id == "custom" }.baseUrlEditable)
    }

    @Test fun zhizengzengUsesOpenAiCompatibleEndpointAndDefaultToolModels() {
        val preset = AndroidModelProviderPresets.all("https://hepai.example/v1")
            .single { it.id == "zhizengzeng" }

        assertEquals("智增增", preset.label)
        assertEquals("https://api.zhizengzeng.com/v1", preset.baseUrl)
        assertEquals("openai", preset.wireApi)
        assertEquals(listOf("deepseek-v4-flash", "deepseek-v4-pro"), preset.suggestedModels)
        assertEquals(setOf("deepseek-v4-flash", "deepseek-v4-pro"), preset.toolCapableModels)
    }
}
