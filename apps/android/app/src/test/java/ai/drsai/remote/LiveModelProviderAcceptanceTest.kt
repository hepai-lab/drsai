package ai.drsai.remote

import ai.drsai.remote.data.AuthTokenStore
import ai.drsai.remote.data.AuthTokens
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.ModelConfigurationResolver
import ai.drsai.remote.data.ModelDelta
import ai.drsai.remote.data.ModelProviderEntity
import ai.drsai.remote.data.ProviderModelEntity
import ai.drsai.remote.data.RuntimeMessage
import ai.drsai.remote.data.TokenLifecycleClient
import ai.drsai.remote.data.User
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in release evidence. Normal test runs never contact or charge a real provider. */
class LiveModelProviderAcceptanceTest {
    @Test fun openAiCompatibleCompletesARealStream() = runLive(
        label = "openai",
        wireApi = "openai",
        baseUrlName = "DRSAI_LIVE_OPENAI_BASE_URL",
        defaultBaseUrl = "https://api.openai.com/v1",
        keyName = "DRSAI_LIVE_OPENAI_API_KEY",
        modelName = "DRSAI_LIVE_OPENAI_MODEL",
    )

    @Test fun anthropicCompletesARealStream() = runLive(
        label = "anthropic",
        wireApi = "anthropic",
        baseUrlName = "DRSAI_LIVE_ANTHROPIC_BASE_URL",
        defaultBaseUrl = "https://api.anthropic.com",
        keyName = "DRSAI_LIVE_ANTHROPIC_API_KEY",
        modelName = "DRSAI_LIVE_ANTHROPIC_MODEL",
    )

    private fun runLive(
        label: String,
        wireApi: String,
        baseUrlName: String,
        defaultBaseUrl: String,
        keyName: String,
        modelName: String,
    ) = runBlocking {
        assumeTrue("live acceptance is opt-in", System.getenv("DRSAI_RUN_LIVE_MODEL_ACCEPTANCE") == "true")
        val key = System.getenv(keyName).orEmpty()
        val upstream = System.getenv(modelName).orEmpty()
        assumeTrue("$keyName is required", key.isNotBlank())
        assumeTrue("$modelName is required", upstream.isNotBlank())
        val baseUrl = System.getenv(baseUrlName).orEmpty().ifBlank { defaultBaseUrl }
        val provider = ModelProviderEntity(
            "live-$label", "custom", "Live $label", baseUrl, wireApi,
            false, true, 1, 1, 1,
        )
        val model = ProviderModelEntity(
            "live-$label-model", provider.id, upstream, upstream,
            false, true, false, null, 128, true, "MANUAL", 0,
        )
        val deltas = mutableListOf<ModelDelta>()
        val client = HaiModelClient(
            LiveTokenStore(), LiveTokenLifecycle(),
            providerStore = LiveCredentialResolver(provider, model, key),
        )

        client.streamCompletionWithTools(
            model.id,
            listOf(RuntimeMessage("user", "Reply with exactly: live acceptance ok")),
            JSONArray(),
        ) { deltas += it }

        val text = deltas.mapNotNull(ModelDelta::content).joinToString("")
        val toolCalls = deltas.sumOf { it.toolCalls.size }
        assertTrue("real stream returned no usable delta", text.isNotBlank() || toolCalls > 0)
        println("LIVE_MODEL_ACCEPTANCE provider=$label chars=${text.length} tool_deltas=$toolCalls status=passed")
    }
}

private class LiveCredentialResolver(
    private val provider: ModelProviderEntity,
    private val model: ProviderModelEntity,
    private val key: String,
) : ModelConfigurationResolver {
    override suspend fun resolveModel(modelId: String) = if (modelId == model.id) provider to model else null
    override fun apiKey(providerId: String) = key.takeIf { providerId == provider.id }
}

private class LiveTokenStore : AuthTokenStore {
    override var accessToken: String? = null
    override var refreshToken: String? = null
    override fun save(auth: AuthTokens) = Unit
}

private class LiveTokenLifecycle : TokenLifecycleClient {
    override suspend fun refresh(refreshToken: String) = AuthTokens("", "", User("live"))
    override suspend fun revoke(refreshToken: String) = Unit
}
