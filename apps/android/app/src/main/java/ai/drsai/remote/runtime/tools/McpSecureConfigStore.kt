package ai.drsai.remote.runtime.tools

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

enum class McpConnectorScope(val wireName: String) {
    DISCOVER("tools:list"),
    CALL_READ("tools:call:read"),
    CALL_WRITE("tools:call:write");

    companion object {
        val DEFAULT = setOf(DISCOVER.wireName, CALL_READ.wireName)
        val ALLOWED = entries.mapTo(linkedSetOf(), McpConnectorScope::wireName)
    }
}

data class McpServerSummary(
    val id: String,
    val url: String,
    val enabled: Boolean,
    val scopes: Set<String> = McpConnectorScope.DEFAULT,
    val expiresAtEpochMs: Long? = null,
)

interface McpConnectorAuthorizer {
    fun isActive(accountSubject: String, serverId: String): Boolean
    fun requireScope(accountSubject: String, serverId: String, scope: String)
}

/** MCP bearer credentials never cross the Kotlin Host Port boundary. */
class McpSecureConfigStore(
    context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
) : McpBearerTokenProvider, McpConnectorAuthorizer {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "android-mcp-secure-config-v1",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun save(
        accountSubject: String,
        endpoint: McpServerEndpoint,
        bearerToken: String?,
        enabled: Boolean = true,
        scopes: Set<String> = McpConnectorScope.DEFAULT,
        expiresAtEpochMs: Long? = null,
    ) {
        require(accountSubject.isNotBlank()) { "mcp_account_required" }
        validateScopes(scopes)
        require(expiresAtEpochMs == null || expiresAtEpochMs > clock()) { "mcp_expiry_invalid" }
        val token = bearerToken?.trim().orEmpty()
        require(token.length <= 8_192 && '\r' !in token && '\n' !in token) { "mcp_token_invalid" }
        val summaries = list(accountSubject).associateBy(McpServerSummary::id).toMutableMap()
        summaries[endpoint.id] = McpServerSummary(endpoint.id, endpoint.url, enabled, scopes, expiresAtEpochMs)
        preferences.edit()
            .putString(summaryKey(accountSubject), encode(summaries.values))
            .putString(tokenKey(accountSubject, endpoint.id), token.takeIf(String::isNotEmpty))
            .commit()
    }

    @Synchronized
    fun list(accountSubject: String): List<McpServerSummary> {
        if (accountSubject.isBlank()) return emptyList()
        val raw = preferences.getString(summaryKey(accountSubject), null) ?: return emptyList()
        val values = JSONArray(raw)
        return (0 until values.length()).map { index ->
            val item = values.getJSONObject(index)
            val scopes = item.optJSONArray("scopes")?.let { array ->
                (0 until array.length()).mapTo(linkedSetOf(), array::getString)
            } ?: McpConnectorScope.DEFAULT
            validateScopes(scopes)
            McpServerSummary(
                item.getString("id"),
                item.getString("url"),
                item.optBoolean("enabled", true),
                scopes,
                item.optLong("expires_at_epoch_ms").takeIf { item.has("expires_at_epoch_ms") },
            ).also { McpServerEndpoint(it.id, it.url) }
        }.sortedBy { it.id }
    }

    @Synchronized
    fun revoke(accountSubject: String, serverId: String) {
        val summaries = list(accountSubject).map { value ->
            if (value.id == serverId) value.copy(enabled = false) else value
        }
        preferences.edit()
            .putString(summaryKey(accountSubject), encode(summaries))
            .remove(tokenKey(accountSubject, serverId))
            .commit()
    }

    @Synchronized
    fun remove(accountSubject: String, serverId: String) {
        val remaining = list(accountSubject).filterNot { it.id == serverId }
        preferences.edit()
            .putString(summaryKey(accountSubject), encode(remaining))
            .remove(tokenKey(accountSubject, serverId))
            .commit()
    }

    @Synchronized
    override fun isActive(accountSubject: String, serverId: String): Boolean =
        list(accountSubject).firstOrNull { it.id == serverId }?.let { summary ->
            summary.enabled && (summary.expiresAtEpochMs == null || clock() < summary.expiresAtEpochMs)
        } == true

    @Synchronized
    override fun requireScope(accountSubject: String, serverId: String, scope: String) {
        require(scope in McpConnectorScope.ALLOWED) { "mcp_scope_invalid" }
        val summary = list(accountSubject).firstOrNull { it.id == serverId }
            ?: error("mcp_connector_not_authorized")
        check(summary.enabled) { "mcp_connector_revoked" }
        check(summary.expiresAtEpochMs == null || clock() < summary.expiresAtEpochMs) { "mcp_connector_expired" }
        check(scope in summary.scopes) { "mcp_connector_scope_denied:$scope" }
    }

    @Synchronized
    override fun token(accountSubject: String, serverId: String): String? =
        if (isActive(accountSubject, serverId)) preferences.getString(tokenKey(accountSubject, serverId), null) else null

    private fun validateScopes(scopes: Set<String>) {
        require(scopes.isNotEmpty() && McpConnectorScope.DISCOVER.wireName in scopes) { "mcp_discover_scope_required" }
        require(scopes.all { it in McpConnectorScope.ALLOWED }) { "mcp_scope_invalid" }
    }

    private fun encode(values: Collection<McpServerSummary>) = JSONArray(values.sortedBy { it.id }.map { value ->
        JSONObject()
            .put("id", value.id)
            .put("url", value.url)
            .put("enabled", value.enabled)
            .put("scopes", JSONArray(value.scopes.sorted()))
            .putOpt("expires_at_epoch_ms", value.expiresAtEpochMs)
    }).toString()

    private fun summaryKey(subject: String) = "servers:${subjectDigest(subject)}"
    private fun tokenKey(subject: String, serverId: String) = "token:${subjectDigest(subject)}:$serverId"
    private fun subjectDigest(subject: String) = MessageDigest.getInstance("SHA-256")
        .digest(subject.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
