package ai.drsai.remote

import ai.drsai.remote.data.*
import org.junit.Assert.*
import org.junit.Test

class ProviderVerificationPolicyTest {
    private val provider = ModelProviderConfig(
        "provider", "Provider", "https://api.example/v1", listOf("m1"),
        wireApi = "openai", hasApiKey = true, revision = 4,
    )
    private val models = listOf(ModelInfo("m1", "Model", tools = true, providerId = "provider", upstreamId = "model-a"))
    private val verified = ProviderVerification(
        "provider", 4, "https://api.example/v1", "openai", setOf("model-a"), 100,
    )

    @Test fun `matching revision endpoint protocol and enabled models stays verified`() {
        assertTrue(ProviderVerificationPolicy.isCurrent(verified, provider, models))
    }

    @Test fun `any configuration mutation invalidates verification`() {
        assertFalse(ProviderVerificationPolicy.isCurrent(verified.copy(revision = 3), provider, models))
        assertFalse(ProviderVerificationPolicy.isCurrent(verified.copy(baseUrl = "https://other.example/v1"), provider, models))
        assertFalse(ProviderVerificationPolicy.isCurrent(verified.copy(wireApi = "anthropic"), provider, models))
        assertFalse(ProviderVerificationPolicy.isCurrent(verified.copy(verifiedModels = emptySet()), provider, models))
        assertFalse(ProviderVerificationPolicy.isCurrent(verified, provider, models + ModelInfo("m2", providerId = "provider", upstreamId = "model-b")))
    }

    @Test fun `disabled models do not invalidate a successful enabled set`() {
        val disabled = ModelInfo("m2", providerId = "provider", upstreamId = "model-b", enabled = false)
        assertTrue(ProviderVerificationPolicy.isCurrent(verified, provider, models + disabled))
    }
}
