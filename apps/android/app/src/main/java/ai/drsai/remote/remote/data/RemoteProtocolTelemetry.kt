package ai.drsai.remote.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class RemoteProtocolObservation(
    val protocol: String,
    val runtimeVersion: String,
    val fallbackReason: String,
    val count: Long,
)

/** Bounded content-free metrics; intentionally has no account or resource dimensions. */
class RemoteProtocolTelemetry(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "remote_protocol_telemetry",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun record(selection: RemoteProtocolSelection) {
        val protocol = if (selection.oaep) "oaep/1" else if (selection.legacySessionEvents) "conversation/1" else "unavailable"
        val version = safe(selection.version ?: "unknown", 64)
        val reason = normalizedReason(selection.fallbackReason ?: "selected")
        val key = "observation|$protocol|$version|$reason"
        val next = (preferences.getLong(key, 0L) + 1L).coerceAtMost(1_000_000_000L)
        val keys = (preferences.getStringSet("observation_keys", emptySet()).orEmpty() + key).takeLast(128).toSet()
        preferences.edit().putLong(key, next).putStringSet("observation_keys", keys).apply()
    }

    @Synchronized
    fun snapshot(): List<RemoteProtocolObservation> =
        preferences.getStringSet("observation_keys", emptySet()).orEmpty().sorted().mapNotNull { key ->
            val parts = key.split('|', limit = 4)
            if (parts.size != 4 || parts[0] != "observation") null
            else RemoteProtocolObservation(parts[1], parts[2], parts[3], preferences.getLong(key, 0L))
        }

    private fun safe(value: String, limit: Int): String = value
        .replace(Regex("[\\r\\n\\u0000]"), " ")
        .replace(Regex("(?i)(token|secret|password|cookie)=[^\\s]+"), "$1=[REDACTED]")
        .trim().take(limit).ifBlank { "unknown" }

    private fun normalizedReason(value: String): String = safe(value, 120).let { reason ->
        if (reason in setOf(
                "capability_selection", "operator_rollback", "oaep_unavailable",
                "legacy_unavailable", "schema_mismatch", "version_incompatible", "selected",
            )) reason else "other"
    }
}

private fun <T> Set<T>.takeLast(limit: Int): List<T> = toList().takeLast(limit)
