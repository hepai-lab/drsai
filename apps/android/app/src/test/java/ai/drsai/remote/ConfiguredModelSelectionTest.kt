package ai.drsai.remote

import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.selectAvailableConfiguredModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConfiguredModelSelectionTest {
    @Test fun keepsEnabledCurrentModel() {
        val models = listOf(model("first"), model("current"))
        assertEquals("current", selectAvailableConfiguredModel(models, "current")?.id)
    }

    @Test fun disabledOrDeletedCurrentFallsBackToFirstEnabledModel() {
        val models = listOf(model("disabled", false), model("fallback"), model("later"))
        assertEquals("fallback", selectAvailableConfiguredModel(models, "disabled")?.id)
        assertEquals("fallback", selectAvailableConfiguredModel(models, "deleted")?.id)
    }

    @Test fun noEnabledModelReturnsNull() {
        assertNull(selectAvailableConfiguredModel(listOf(model("disabled", false)), "disabled"))
    }

    @Test fun legacyConcatenatedIdMigratesToStableConfiguredModelId() {
        val configured = ModelInfo(
            id = "stable-uuid", name = "Model", providerId = "provider", upstreamId = "vendor/model",
        )
        assertEquals("stable-uuid", selectAvailableConfiguredModel(listOf(configured), "provider/vendor/model")?.id)
        assertEquals("stable-uuid", selectAvailableConfiguredModel(listOf(configured), "provider:vendor/model")?.id)
    }

    private fun model(id: String, enabled: Boolean = true) = ModelInfo(id, id, enabled = enabled)
}
