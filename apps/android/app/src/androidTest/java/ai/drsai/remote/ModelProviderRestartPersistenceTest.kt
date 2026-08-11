package ai.drsai.remote

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.SecureTokenStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelProviderRestartPersistenceTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test fun phase1SeedPersistentConfiguration() = runBlocking {
        context.deleteDatabase(DATABASE_NAME)
        val credentials = ModelProviderStore(context)
        runCatching { credentials.deleteApiKey(PROVIDER_ID) }
        val db = database()
        try {
            val repository = ModelProviderRepository(db.modelProviderDao(), credentials)
            repository.save(
                PROVIDER_ID, "custom", "Restart acceptance", "https://restart.example/v1", "openai",
                SECRET_CANARY,
                listOf(
                    ModelInfo("", "Enabled model", upstreamId = "enabled-model", tools = true),
                    ModelInfo("", "Disabled model", upstreamId = "disabled-model", enabled = false),
                ),
            )
            val modelId = repository.snapshot().second.single { it.upstreamId == "enabled-model" }.id
            SecureTokenStore(context).selectedModelId = modelId
        } finally {
            db.close()
        }
    }

    @Test fun phase2VerifyAfterForcedProcessRestartAndCleanup() = runBlocking {
        val credentials = ModelProviderStore(context)
        try {
            val db = database()
            try {
                val repository = ModelProviderRepository(db.modelProviderDao(), credentials)
                val (providers, models) = repository.snapshot()
                val provider = providers.single { it.id == PROVIDER_ID }
                val enabled = models.single { it.upstreamId == "enabled-model" }
                val disabled = models.single { it.upstreamId == "disabled-model" }

                assertEquals("Restart acceptance", provider.name)
                assertTrue(provider.hasApiKey)
                assertEquals(SECRET_CANARY, credentials.apiKey(PROVIDER_ID))
                assertTrue(enabled.enabled)
                assertTrue(enabled.tools)
                assertEquals(false, disabled.enabled)
                assertEquals(enabled.id, SecureTokenStore(context).selectedModelId)
                assertNotNull(repository.resolveModel(enabled.id))
                repository.delete(PROVIDER_ID)
            } finally {
                db.close()
            }
        } finally {
            SecureTokenStore(context).selectedModelId = null
            runCatching { credentials.deleteApiKey(PROVIDER_ID) }
            context.deleteDatabase(DATABASE_NAME)
        }
    }

    private fun database() = Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE_NAME).build()

    private companion object {
        const val DATABASE_NAME = "model-provider-restart-acceptance.db"
        const val PROVIDER_ID = "restart-acceptance-provider"
        const val SECRET_CANARY = "sk-restart-acceptance-canary"
    }
}
