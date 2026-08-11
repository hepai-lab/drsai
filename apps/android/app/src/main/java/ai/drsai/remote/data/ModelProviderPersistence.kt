package ai.drsai.remote.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction

@Entity(tableName = "model_providers")
data class ModelProviderEntity(
    @PrimaryKey val id: String,
    val presetId: String?,
    val displayName: String,
    val baseUrl: String,
    val wireApi: String,
    val builtIn: Boolean,
    val enabled: Boolean,
    val revision: Long,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "provider_models",
    foreignKeys = [ForeignKey(
        entity = ModelProviderEntity::class,
        parentColumns = ["id"],
        childColumns = ["providerId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("providerId"), Index(value = ["providerId", "upstreamId"], unique = true)],
)
data class ProviderModelEntity(
    @PrimaryKey val id: String,
    val providerId: String,
    val upstreamId: String,
    val displayName: String,
    val vision: Boolean,
    val tools: Boolean,
    val reasoning: Boolean,
    val contextTokens: Int?,
    val maxOutputTokens: Int?,
    val enabled: Boolean,
    val source: String,
    val sortOrder: Int,
)

data class ModelProviderWithModels(
    @androidx.room.Embedded val provider: ModelProviderEntity,
    @androidx.room.Relation(parentColumn = "id", entityColumn = "providerId")
    val models: List<ProviderModelEntity>,
)

@Dao
interface ModelProviderDao {
    @Transaction
    @Query("SELECT * FROM model_providers WHERE enabled=1 ORDER BY builtIn DESC, createdAt, displayName COLLATE NOCASE")
    suspend fun snapshot(): List<ModelProviderWithModels>

    @Query("SELECT * FROM provider_models WHERE id=:id LIMIT 1")
    suspend fun model(id: String): ProviderModelEntity?

    @Query("SELECT * FROM model_providers WHERE id=:id LIMIT 1")
    suspend fun provider(id: String): ModelProviderEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProvider(provider: ModelProviderEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertModels(models: List<ProviderModelEntity>)

    @Query("DELETE FROM provider_models WHERE providerId=:providerId")
    suspend fun deleteModels(providerId: String)

    @Query("DELETE FROM model_providers WHERE id=:providerId AND builtIn=0")
    suspend fun deleteProvider(providerId: String): Int

    @Transaction
    suspend fun replace(provider: ModelProviderEntity, models: List<ProviderModelEntity>) {
        upsertProvider(provider)
        deleteModels(provider.id)
        if (models.isNotEmpty()) upsertModels(models)
    }
}

data class ModelProviderPreset(
    val id: String,
    val label: String,
    val baseUrl: String,
    val wireApi: String,
    val nameEditable: Boolean = false,
    val baseUrlEditable: Boolean = false,
    val suggestedModels: List<String> = emptyList(),
    val toolCapableModels: Set<String> = emptySet(),
)

object AndroidModelProviderPresets {
    fun all(hepaiBaseUrl: String) = listOf(
        ModelProviderPreset("hepai", "HepAI", hepaiBaseUrl, "openai", suggestedModels = listOf("deepseek-ai/deepseek-v4-pro")),
        ModelProviderPreset("openai", "OpenAI", "https://api.openai.com/v1", "openai", suggestedModels = listOf("gpt-5.1", "gpt-5", "gpt-5-mini")),
        ModelProviderPreset("anthropic", "Anthropic", "https://api.anthropic.com", "anthropic", suggestedModels = listOf("claude-sonnet-4-5", "claude-opus-4-1")),
        ModelProviderPreset("deepseek", "DeepSeek", "https://api.deepseek.com", "openai", suggestedModels = listOf("deepseek-chat", "deepseek-reasoner")),
        ModelProviderPreset(
            "zhizengzeng",
            "智增增",
            "https://api.zhizengzeng.com/v1",
            "openai",
            suggestedModels = listOf("deepseek-v4-flash", "deepseek-v4-pro"),
            toolCapableModels = setOf("deepseek-v4-flash", "deepseek-v4-pro"),
        ),
        ModelProviderPreset("ollama", "Ollama", "http://127.0.0.1:11434/v1", "openai", baseUrlEditable = true),
        ModelProviderPreset("custom", "自定义", "", "openai", nameEditable = true, baseUrlEditable = true),
    )
}
