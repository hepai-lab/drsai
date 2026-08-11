package ai.drsai.remote

import ai.drsai.remote.data.ModelCredentialStore
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelProviderDao
import ai.drsai.remote.data.ModelProviderEntity
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelProviderWithModels
import ai.drsai.remote.data.ProviderModelEntity
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelProviderRepositoryTest {
    @Test fun roomFailureRestoresPreviousCredential() = runTest {
        val credentials = FakeCredentialStore(mutableMapOf("provider" to "old-secret"))
        val dao = FakeModelProviderDao(failReplace = true).apply {
            providers["provider"] = provider("provider", revision = 1)
        }
        val repository = ModelProviderRepository(dao, credentials)

        val error = runCatching {
            repository.save("provider", "custom", "Provider", "https://example.com/v1", "openai", "new-secret", listOf(model()), 1)
        }.exceptionOrNull()

        assertEquals("room-write-failed", error?.message)
        assertEquals("old-secret", credentials.apiKey("provider"))
        assertEquals(1L, dao.providers.getValue("provider").revision)
    }

    @Test fun failedNewProviderWriteRemovesNewCredential() = runTest {
        val credentials = FakeCredentialStore()
        val repository = ModelProviderRepository(FakeModelProviderDao(failReplace = true), credentials)

        runCatching {
            repository.save("new-provider", "custom", "Provider", "https://example.com/v1", "openai", "new-secret", listOf(model()))
        }

        assertNull(credentials.apiKey("new-provider"))
    }

    @Test fun deleteFailureRestoresCredentialAndProvider() = runTest {
        val credentials = FakeCredentialStore(mutableMapOf("provider" to "secret"))
        val existing = provider("provider")
        val dao = FakeModelProviderDao(failDelete = true).apply { providers["provider"] = existing }
        val repository = ModelProviderRepository(dao, credentials)

        val error = runCatching { repository.delete("provider") }.exceptionOrNull()

        assertEquals("room-delete-failed", error?.message)
        assertEquals("secret", credentials.apiKey("provider"))
        assertTrue("provider" in dao.providers)
    }

    @Test fun duplicateAndEmptyModelsAreRejectedBeforeCredentialMutation() = runTest {
        val credentials = FakeCredentialStore()
        val repository = ModelProviderRepository(FakeModelProviderDao(), credentials)
        val duplicate = listOf(model("same"), model("SAME"))

        val error = runCatching {
            repository.save("provider", "custom", "Provider", "https://example.com/v1", "openai", "secret", duplicate)
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
        assertNull(credentials.apiKey("provider"))
    }

    @Test fun fiveHundredModelsKeepOrderCapabilitiesAndEnabledState() = runTest {
        val credentials = FakeCredentialStore()
        val dao = FakeModelProviderDao()
        val repository = ModelProviderRepository(dao, credentials)
        val models = (0 until 500).map { index ->
            ModelInfo(
                id = "", name = "Model $index", vision = index % 2 == 0, tools = index % 3 == 0,
                upstreamId = "vendor/model-$index", reasoning = index % 5 == 0,
                contextTokens = 128_000 + index, maxOutputTokens = 4_000 + index,
                enabled = index % 7 != 0,
            )
        }

        repository.save(
            "large", "custom", "Large", "https://example.com/v1", "openai", "secret", models,
        )
        val (_, restored) = repository.snapshot()

        assertEquals(500, restored.size)
        assertEquals(models.map(ModelInfo::upstreamId), restored.map(ModelInfo::upstreamId))
        assertEquals(models.map(ModelInfo::enabled), restored.map(ModelInfo::enabled))
        assertEquals(models.map(ModelInfo::vision), restored.map(ModelInfo::vision))
        assertEquals(models.map(ModelInfo::tools), restored.map(ModelInfo::tools))
        assertEquals(models.map(ModelInfo::reasoning), restored.map(ModelInfo::reasoning))
        assertEquals(models.map(ModelInfo::contextTokens), restored.map(ModelInfo::contextTokens))
        assertEquals(models.map(ModelInfo::maxOutputTokens), restored.map(ModelInfo::maxOutputTokens))
    }

    @Test fun sameNameCustomProvidersAlwaysReceiveDifferentStableIds() = runTest {
        val repository = ModelProviderRepository(FakeModelProviderDao(), FakeCredentialStore())

        val first = repository.save(null, "custom", "Same name", "https://example.com/v1", "openai", "secret-1", listOf(model()))
        val second = repository.save(null, "custom", "Same name", "https://example.com/v1", "openai", "secret-2", listOf(model()))

        assertTrue(first != second)
    }

    @Test fun invalidProviderNamesAndUrlsAreRejectedBeforeCredentialMutation() = runTest {
        val invalid = listOf(
            "" to "https://example.com/v1",
            "Provider" to "not-a-url",
            "Provider" to "https://user:password@example.com/v1",
            "Provider" to "https://example.com/v1\nhttps://evil.example",
        )
        invalid.forEachIndexed { index, (name, url) ->
            val credentials = FakeCredentialStore()
            val repository = ModelProviderRepository(FakeModelProviderDao(), credentials)
            val providerId = "invalid-$index"

            val error = runCatching {
                repository.save(providerId, "custom", name, url, "openai", "must-not-persist", listOf(model()))
            }.exceptionOrNull()

            assertTrue("case $index should fail", error is IllegalArgumentException || error is IllegalStateException)
            assertNull(credentials.apiKey(providerId))
        }
    }

    @Test fun legacyMigrationAllowsEmptyModelsAndMissingKeysAndIsIdempotent() = runTest {
        val dao = FakeModelProviderDao()
        val legacy = listOf(
            ai.drsai.remote.data.ModelProviderConfig("legacy-empty", "Empty", "https://empty.example/v1", emptyList()),
            ai.drsai.remote.data.ModelProviderConfig("legacy-models", "Models", "https://models.example/v1", listOf("a", "A", "b", "")),
            ai.drsai.remote.data.ModelProviderConfig("legacy-broken", "Broken", "not-a-url", listOf("ignored")),
        )
        val repository = ModelProviderRepository(dao, FakeCredentialStore(), legacyProviders = { legacy })

        repository.ensureBuiltIns("https://hepai.example/v1")
        val first = repository.snapshot()
        repository.ensureBuiltIns("https://hepai.example/v1")
        val second = repository.snapshot()

        assertTrue(first.first.any { it.id == "legacy-empty" && !it.hasApiKey && it.modelIds.isEmpty() })
        assertEquals(listOf("a", "b"), first.second.filter { it.providerId == "legacy-models" }.map(ModelInfo::upstreamId))
        assertTrue(first.first.none { it.id == "legacy-broken" })
        assertEquals(first.first.map { it.id }, second.first.map { it.id })
        assertEquals(first.second.map { it.id }, second.second.map { it.id })
    }

    private fun provider(id: String, revision: Long = 1) = ModelProviderEntity(id, "custom", "Provider", "https://example.com/v1", "openai", false, true, revision, 1, 1)
    private fun model(upstream: String = "model-a") = ModelInfo("", upstream, upstreamId = upstream)
}

private class FakeCredentialStore(
    private val values: MutableMap<String, String> = mutableMapOf(),
) : ModelCredentialStore {
    override fun apiKey(providerId: String): String? = values[providerId]
    override fun hasApiKey(providerId: String): Boolean = !values[providerId].isNullOrBlank()
    override fun saveApiKey(providerId: String, apiKey: String) { values[providerId] = apiKey }
    override fun deleteApiKey(providerId: String) { values.remove(providerId) }
}

private class FakeModelProviderDao(
    private val failReplace: Boolean = false,
    private val failDelete: Boolean = false,
) : ModelProviderDao {
    val providers = linkedMapOf<String, ModelProviderEntity>()
    private val models = linkedMapOf<String, ProviderModelEntity>()

    override suspend fun snapshot(): List<ModelProviderWithModels> = providers.values.map { provider ->
        ModelProviderWithModels(provider, models.values.filter { it.providerId == provider.id })
    }
    override suspend fun model(id: String): ProviderModelEntity? = models[id]
    override suspend fun provider(id: String): ModelProviderEntity? = providers[id]
    override suspend fun upsertProvider(provider: ModelProviderEntity) { providers[provider.id] = provider }
    override suspend fun upsertModels(models: List<ProviderModelEntity>) { models.forEach { this.models[it.id] = it } }
    override suspend fun deleteModels(providerId: String) { models.entries.removeIf { it.value.providerId == providerId } }
    override suspend fun deleteProvider(providerId: String): Int {
        if (failDelete) error("room-delete-failed")
        return if (providers.remove(providerId) != null) 1 else 0
    }
    override suspend fun replace(provider: ModelProviderEntity, models: List<ProviderModelEntity>) {
        if (failReplace) error("room-write-failed")
        super.replace(provider, models)
    }
}
