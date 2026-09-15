package ai.drsai.remote

import ai.drsai.remote.data.*
import org.junit.Assert.*
import org.junit.Test

class ModelRecommendationPolicyTest {
    @Test fun `keeps current verified tool model before applying preference order`() {
        val providers = listOf(ModelProviderConfig("p", "P", "https://p.example", emptyList(), connectionStatus = "AVAILABLE"))
        val models = listOf(
            model("pro", "deepseek-v4-pro"), model("flash", "deepseek-v4-flash"),
        )
        assertEquals("flash", ModelRecommendationPolicy.select(models, providers, "flash")?.id)
        assertEquals("pro", ModelRecommendationPolicy.select(models, providers, null)?.id)
    }

    @Test fun `never recommends unverified disabled unknown or chat-only models`() {
        val providers = listOf(
            ModelProviderConfig("ok", "OK", "https://ok.example", emptyList(), connectionStatus = "AVAILABLE"),
            ModelProviderConfig("unchecked", "Unchecked", "https://no.example", emptyList()),
        )
        val models = listOf(
            model("unknown", "unknown", tools = false),
            model("disabled", "disabled", enabled = false),
            model("unverified", "deepseek-v4-pro", providerId = "unchecked"),
        )
        assertNull(ModelRecommendationPolicy.select(models, providers, "unknown"))
    }

    @Test fun `one thousand discovered models merge deterministically without deleting local choices`() {
        val current = listOf(model("manual", "manual-only"))
        val discovered = (0 until 1_000).map { "vendor/model-$it" } + listOf("VENDOR/MODEL-1", "vendor/model-1")
        val result = mergeDiscoveredModels(current, discovered)
        assertEquals(1_001, result.models.size)
        assertEquals(1_000, result.added)
        assertEquals(0, result.retained)
        assertEquals(1, result.missing)
        assertTrue(result.models.any { it.upstreamId == "manual-only" })
    }

    private fun model(
        id: String, upstream: String, tools: Boolean = true, enabled: Boolean = true, providerId: String = "p",
    ) = ModelInfo(id, upstream, tools = tools, providerId = providerId, upstreamId = upstream, enabled = enabled)
}
