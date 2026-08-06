package ai.drsai.remote

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.ConversationEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelProviderPersistenceTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java).allowMainThreadQueries().build()
    private val repository = ModelProviderRepository(database.modelProviderDao(), ModelProviderStore(context))

    @After fun close() = database.close()

    @Test fun customProviderRenameKeepsStableProviderAndModelIds() = runBlocking {
        val providerId = repository.save(null, "custom", "My Gateway", "https://example.com/v1", "openai", "secret-test-key", listOf(
            ModelInfo("", "Model A", upstreamId = "model-a"),
            ModelInfo("", "Model B", upstreamId = "model-b", enabled = false),
        ))
        val first = repository.snapshot()
        val modelId = first.second.first { it.upstreamId == "model-a" }.id
        val revision = first.first.single().revision

        repository.save(providerId, "custom", "Renamed Gateway", "https://example.com/v1", "openai", "", first.second, revision)
        val restored = repository.snapshot()

        assertEquals(providerId, restored.first.single().id)
        assertEquals("Renamed Gateway", restored.first.single().name)
        assertEquals(modelId, restored.second.first { it.upstreamId == "model-a" }.id)
        assertEquals(false, restored.second.first { it.upstreamId == "model-b" }.enabled)
        assertNotNull(repository.resolveModel(modelId))
    }

    @Test fun apiKeyIsEncryptedAtRestAndRoomSchemaContainsNoCredentialColumn() {
        val providerId = "security-${System.nanoTime()}"
        val secret = "sk-model-provider-leak-canary-20260804"
        val store = ModelProviderStore(context)
        try {
            store.saveApiKey(providerId, secret)
            assertEquals(secret, ModelProviderStore(context).apiKey(providerId))

            val prefsDirectory = java.io.File(context.applicationInfo.dataDir, "shared_prefs")
            val serializedPreferences = prefsDirectory.listFiles().orEmpty()
                .filter { it.name.contains("opendrsai_model_providers") }
                .joinToString("\n") { it.readText() }
            assertFalse(serializedPreferences.contains(secret))

            listOf("model_providers", "provider_models").forEach { table ->
                database.openHelper.readableDatabase.query("PRAGMA table_info($table)").use { cursor ->
                    val nameIndex = cursor.getColumnIndexOrThrow("name")
                    while (cursor.moveToNext()) {
                        val column = cursor.getString(nameIndex).lowercase()
                        assertFalse(column.contains("key") || column.contains("secret") || column.contains("credential"))
                    }
                }
            }
        } finally {
            store.deleteApiKey(providerId)
        }
    }

    @Test fun providerAndModelRenameDoNotRewriteOrOrphanHistoricalConversationBinding() = runBlocking {
        val providerId = repository.save(
            null, "custom", "Original provider", "https://example.com/v1", "openai", "history-secret",
            listOf(ModelInfo("", "Original model", upstreamId = "vendor/model")),
        )
        val first = repository.snapshot()
        val stableModelId = first.second.single().id
        database.dao().saveConversation(
            ConversationEntity(
                id = "history-conversation", userId = "history-user", title = "History",
                agentId = "local:opendrsai", modelId = stableModelId, createdAt = 1, updatedAt = 1,
            ),
        )

        repository.save(
            providerId, "custom", "Renamed provider", "https://example.com/v1", "openai", "",
            first.second.map { it.copy(name = "Renamed model") }, first.first.single().revision,
        )

        val conversation = database.dao().conversationSnapshot("history-user").single()
        assertEquals(stableModelId, conversation.modelId)
        assertNotNull(repository.resolveModel(conversation.modelId))
    }
}
