package ai.drsai.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

interface ModelCredentialStore {
    fun apiKey(providerId: String): String?
    fun hasApiKey(providerId: String): Boolean
    fun saveApiKey(providerId: String, apiKey: String)
    fun deleteApiKey(providerId: String)
}

interface ModelConfigurationResolver {
    suspend fun resolveModel(modelId: String): Pair<ModelProviderEntity, ProviderModelEntity>?
    fun apiKey(providerId: String): String?
}

class ModelProviderStore(context: Context) : ModelCredentialStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "opendrsai_model_providers",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun providers(): List<ModelProviderConfig> {
        val array = runCatching { JSONArray(prefs.getString("providers", "[]")) }.getOrDefault(JSONArray())
        return (0 until array.length()).mapNotNull { index ->
            array.optJSONObject(index)?.let { row ->
                val id = row.optString("id")
                val name = row.optString("name")
                val baseUrl = row.optString("base_url")
                if (id.isBlank() || name.isBlank() || baseUrl.isBlank()) return@let null
                val models = row.optJSONArray("models") ?: JSONArray()
                ModelProviderConfig(id, name, baseUrl, (0 until models.length()).mapNotNull { models.optString(it).takeIf(String::isNotBlank) })
            }
        }
    }

    override fun apiKey(providerId: String): String? = prefs.getString("key:$providerId", null)

    fun save(provider: ModelProviderConfig, apiKey: String) {
        val updated = providers().filterNot { it.id == provider.id } + provider
        val array = JSONArray(updated.map { item ->
            JSONObject().put("id", item.id).put("name", item.name).put("base_url", item.baseUrl)
                .put("models", JSONArray(item.modelIds))
        })
        check(prefs.edit().putString("providers", array.toString()).putString("key:${provider.id}", apiKey).commit())
    }

    fun delete(providerId: String) {
        val array = JSONArray(providers().filterNot { it.id == providerId }.map { item ->
            JSONObject().put("id", item.id).put("name", item.name).put("base_url", item.baseUrl)
                .put("models", JSONArray(item.modelIds))
        })
        check(prefs.edit().putString("providers", array.toString()).remove("key:$providerId").commit())
    }

    override fun hasApiKey(providerId: String): Boolean = !apiKey(providerId).isNullOrBlank()

    override fun saveApiKey(providerId: String, apiKey: String) {
        if (apiKey.isBlank()) return
        check(prefs.edit().putString("key:$providerId", apiKey.trim()).commit()) { "model-credential-write-failed" }
    }

    override fun deleteApiKey(providerId: String) {
        check(prefs.edit().remove("key:$providerId").commit()) { "model-credential-delete-failed" }
    }
}

class ModelProviderRepository(
    private val dao: ModelProviderDao,
    private val credentials: ModelCredentialStore,
    private val legacyProviders: (() -> List<ModelProviderConfig>)? = null,
) : ModelConfigurationResolver {
    suspend fun ensureBuiltIns(hepaiBaseUrl: String) {
        val current = dao.snapshot()
        if (current.none { it.provider.id == "hepai" }) {
            val now = System.currentTimeMillis()
            dao.upsertProvider(ModelProviderEntity("hepai", "hepai", "HepAI", hepaiBaseUrl, "openai", true, true, 1, now, now))
        }
        migrateLegacy()
    }

    suspend fun snapshot(): Pair<List<ModelProviderConfig>, List<ModelInfo>> {
        val rows = dao.snapshot()
        val providers = rows.map { row ->
            ModelProviderConfig(
                id = row.provider.id,
                name = row.provider.displayName,
                baseUrl = row.provider.baseUrl,
                modelIds = row.models.sortedBy(ProviderModelEntity::sortOrder).map(ProviderModelEntity::id),
                builtIn = row.provider.builtIn,
                presetId = row.provider.presetId,
                wireApi = row.provider.wireApi,
                hasApiKey = credentials.hasApiKey(row.provider.id),
                revision = row.provider.revision,
            )
        }
        val models = rows.flatMap { row -> row.models.sortedBy(ProviderModelEntity::sortOrder).map { model ->
            ModelInfo(model.id, model.displayName, model.vision, model.tools, row.provider.id, model.upstreamId, model.reasoning, model.contextTokens, model.maxOutputTokens, model.enabled, model.source)
        } }
        return providers to models
    }

    suspend fun save(
        providerId: String?,
        presetId: String?,
        displayName: String,
        baseUrl: String,
        wireApi: String,
        apiKey: String,
        models: List<ModelInfo>,
        expectedRevision: Long? = null,
    ): String {
        val cleanName = displayName.trim().take(80)
        val cleanUrl = normalizeBaseUrl(baseUrl)
        require(cleanName.isNotBlank()) { "提供方名称不能为空" }
        require(wireApi in setOf("openai", "anthropic")) { "不支持的 API 协议" }
        require(models.isNotEmpty()) { "至少配置一个模型" }
        require(models.any { it.enabled && it.upstreamId.isNotBlank() }) { "至少启用一个有效模型" }
        require(models.all { it.upstreamId.isNotBlank() }) { "模型 ID 不能为空" }
        require(models.map { it.upstreamId.trim().lowercase() }.distinct().size == models.size) { "模型 ID 不能重复" }
        val id = providerId ?: UUID.randomUUID().toString()
        val existing = dao.provider(id)
        if (expectedRevision != null && existing?.revision != expectedRevision) error("config_conflict")
        val oldKey = credentials.apiKey(id)
        val keyChanged = apiKey.isNotBlank()
        if (keyChanged) credentials.saveApiKey(id, apiKey)
        try {
            require(credentials.hasApiKey(id) || presetId in setOf("hepai", "ollama")) { "API Key 不能为空" }
            val now = System.currentTimeMillis()
            val provider = ModelProviderEntity(
                id, presetId, cleanName, cleanUrl, wireApi,
                builtIn = existing?.builtIn == true,
                enabled = true,
                revision = (existing?.revision ?: 0) + 1,
                createdAt = existing?.createdAt ?: now,
                updatedAt = now,
            )
            val entities = models.mapIndexed { index, model ->
                val upstream = model.upstreamId.trim()
                val stableId = model.id.takeIf { it.isNotBlank() && dao.model(it)?.providerId == id }
                    ?: UUID.nameUUIDFromBytes("$id\u0000$upstream".toByteArray(StandardCharsets.UTF_8)).toString()
                ProviderModelEntity(stableId, id, upstream, model.name.trim().ifBlank { upstream }, model.vision, model.tools, model.reasoning, model.contextTokens, model.maxOutputTokens, model.enabled, model.source, index)
            }
            dao.replace(provider, entities)
            return id
        } catch (error: Throwable) {
            if (keyChanged) runCatching {
                if (oldKey == null) credentials.deleteApiKey(id) else credentials.saveApiKey(id, oldKey)
            }.exceptionOrNull()?.let(error::addSuppressed)
            throw error
        }
    }

    suspend fun delete(providerId: String) {
        require(providerId != "hepai") { "内置 HepAI 不能删除" }
        val oldKey = credentials.apiKey(providerId)
        credentials.deleteApiKey(providerId)
        try {
            dao.deleteProvider(providerId)
        } catch (error: Throwable) {
            if (oldKey != null) runCatching { credentials.saveApiKey(providerId, oldKey) }
                .exceptionOrNull()?.let(error::addSuppressed)
            throw error
        }
    }

    override suspend fun resolveModel(modelId: String): Pair<ModelProviderEntity, ProviderModelEntity>? {
        val model = dao.model(modelId) ?: return null
        if (model.providerId == "hepai") return null
        return (dao.provider(model.providerId) ?: return null) to model
    }

    override fun apiKey(providerId: String): String? = credentials.apiKey(providerId)

    private suspend fun migrateLegacy() {
        legacyProviders.orEmpty().forEach { legacy ->
            if (dao.provider(legacy.id) != null) return@forEach
            val cleanName = legacy.name.trim().take(80).takeIf(String::isNotBlank) ?: return@forEach
            val cleanUrl = runCatching { normalizeBaseUrl(legacy.baseUrl) }.getOrNull() ?: return@forEach
            val now = System.currentTimeMillis()
            val provider = ModelProviderEntity(
                legacy.id, "custom", cleanName, cleanUrl, "openai", false, true, 1, now, now,
            )
            val seen = mutableSetOf<String>()
            val models = legacy.modelIds.map(String::trim).filter { it.isNotBlank() && seen.add(it.lowercase()) }
                .mapIndexed { index, upstream ->
                    ProviderModelEntity(
                        UUID.nameUUIDFromBytes("${legacy.id}\u0000$upstream".toByteArray(StandardCharsets.UTF_8)).toString(),
                        legacy.id, upstream, upstream, false, false, false, null, null, true, "MANUAL", index,
                    )
                }
            dao.replace(provider, models)
        }
    }

    private fun (() -> List<ModelProviderConfig>)?.orEmpty(): List<ModelProviderConfig> = this?.invoke().orEmpty()

    private fun normalizeBaseUrl(value: String): String {
        val clean = value.trim().trimEnd('/')
        val uri = runCatching { java.net.URI(clean) }.getOrNull() ?: error("API 地址无效")
        require(uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "API 地址无效" }
        require(!clean.contains('\n') && !clean.contains('\r')) { "API 地址无效" }
        return clean
    }
}
