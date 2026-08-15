package ai.drsai.remote.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ProviderVerification(
    val providerId: String,
    val revision: Long,
    val baseUrl: String,
    val wireApi: String,
    val verifiedModels: Set<String>,
    val checkedAt: Long,
)

object ProviderVerificationPolicy {
    fun isCurrent(verification: ProviderVerification?, provider: ModelProviderConfig, models: List<ModelInfo>): Boolean {
        if (verification == null || verification.providerId != provider.id || verification.revision != provider.revision) return false
        if (verification.baseUrl.trimEnd('/') != provider.baseUrl.trimEnd('/') || verification.wireApi != provider.wireApi) return false
        val enabled = models.filter { it.providerId == provider.id && it.enabled }.map { it.upstreamId }.toSet()
        return enabled.isNotEmpty() && verification.verifiedModels.containsAll(enabled)
    }
}

class ProviderVerificationStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("p10_provider_verification_v1", Context.MODE_PRIVATE)

    fun load(providerId: String): ProviderVerification? = preferences.getString(providerId, null)?.let { raw ->
        runCatching {
            val value = JSONObject(raw)
            val models = value.getJSONArray("models")
            ProviderVerification(
                providerId, value.getLong("revision"), value.getString("base_url"), value.getString("wire_api"),
                (0 until models.length()).map { models.getString(it) }.toSet(), value.getLong("checked_at"),
            )
        }.getOrNull()
    }

    fun save(value: ProviderVerification) {
        val encoded = JSONObject()
            .put("revision", value.revision)
            .put("base_url", value.baseUrl.trimEnd('/'))
            .put("wire_api", value.wireApi)
            .put("models", JSONArray(value.verifiedModels.sorted()))
            .put("checked_at", value.checkedAt)
            .toString()
        check(preferences.edit().putString(value.providerId, encoded).commit()) { "provider_verification_write_failed" }
    }

    fun clear(providerId: String) {
        check(preferences.edit().remove(providerId).commit()) { "provider_verification_clear_failed" }
    }
}
