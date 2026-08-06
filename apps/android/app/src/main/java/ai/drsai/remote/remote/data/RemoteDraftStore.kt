package ai.drsai.remote.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/** Encrypted composer drafts isolated by account, runtime, and session. */
class RemoteDraftStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "remote_session_drafts",
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun read(subject: String, runtimeId: String, sessionId: String): String =
        preferences.getString(scopeKey(subject, runtimeId, sessionId), "").orEmpty()

    @Synchronized
    fun write(subject: String, runtimeId: String, sessionId: String, value: String) {
        val key = scopeKey(subject, runtimeId, sessionId)
        val indexKey = subjectIndexKey(subject)
        val runtimeIndexKey = runtimeIndexKey(subject, runtimeId)
        val indexed = preferences.getStringSet(indexKey, emptySet()).orEmpty().toMutableSet()
        val runtimeIndexed = preferences.getStringSet(runtimeIndexKey, emptySet()).orEmpty().toMutableSet()
        preferences.edit().apply {
            if (value.isEmpty()) { remove(key); indexed.remove(key); runtimeIndexed.remove(key) }
            else { putString(key, value); indexed.add(key); runtimeIndexed.add(key) }
            putStringSet(indexKey, indexed)
            putStringSet(runtimeIndexKey, runtimeIndexed)
        }.apply()
    }

    fun clear(subject: String, runtimeId: String, sessionId: String) =
        write(subject, runtimeId, sessionId, "")

    @Synchronized
    fun clearSubject(subject: String) {
        val indexKey = subjectIndexKey(subject)
        preferences.edit().apply {
            preferences.getStringSet(indexKey, emptySet()).orEmpty().forEach(::remove)
            remove(indexKey)
        }.apply()
    }

    @Synchronized
    fun clearRuntime(subject: String, runtimeId: String) {
        val runtimeIndex = runtimeIndexKey(subject, runtimeId)
        val subjectIndex = subjectIndexKey(subject)
        val removing = preferences.getStringSet(runtimeIndex, emptySet()).orEmpty()
        val remaining = preferences.getStringSet(subjectIndex, emptySet()).orEmpty() - removing
        preferences.edit().apply {
            removing.forEach(::remove)
            putStringSet(subjectIndex, remaining)
            remove(runtimeIndex)
        }.apply()
    }

    internal fun scopeKey(subject: String, runtimeId: String, sessionId: String): String {
        require(subject.isNotBlank() && runtimeId.isNotBlank() && sessionId.isNotBlank()) {
            "remote_draft_scope_required"
        }
        val scoped = listOf(subject, runtimeId, sessionId).joinToString("\u0000")
            .toByteArray(StandardCharsets.UTF_8)
        return "draft_" + MessageDigest.getInstance("SHA-256").digest(scoped)
            .joinToString("") { "%02x".format(it) }
    }

    private fun subjectIndexKey(subject: String): String = "draft_index_" +
        MessageDigest.getInstance("SHA-256").digest(subject.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun runtimeIndexKey(subject: String, runtimeId: String): String = "draft_runtime_index_" +
        MessageDigest.getInstance("SHA-256").digest("$subject\u0000$runtimeId".toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
