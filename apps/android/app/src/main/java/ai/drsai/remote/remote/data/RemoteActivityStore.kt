package ai.drsai.remote.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.time.Instant

data class RemoteActivitySummary(
    val unreadTurns: Int = 0,
    val pendingApprovals: Int = 0,
    val runningRuns: Int = 0,
    val lastActivityAt: String = "",
) {
    operator fun plus(other: RemoteActivitySummary) = RemoteActivitySummary(
        unreadTurns + other.unreadTurns,
        pendingApprovals + other.pendingApprovals,
        runningRuns + other.runningRuns,
        maxOf(lastActivityAt, other.lastActivityAt),
    )
}

class RemoteActivityStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "remote_activity_state",
        MasterKey.Builder(context.applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    @Synchronized
    fun observeSession(subject: String, runtimeId: String, sessionId: String, updatedAt: String): Int {
        val key = key("session", subject, runtimeId, sessionId)
        track(subject, key)
        trackRuntime(subject, runtimeId, key)
        val previous = preferences.getString(key, null)?.split('|').orEmpty()
        val seenAt = previous.getOrNull(0).orEmpty()
        val oldUnread = previous.getOrNull(1)?.toIntOrNull() ?: 0
        val readAt = previous.getOrNull(2)?.toLongOrNull() ?: 0L
        val updatedMillis = runCatching { Instant.parse(updatedAt).toEpochMilli() }.getOrDefault(0L)
        val unread = if (updatedAt.isNotBlank() && updatedAt != seenAt && updatedMillis > readAt) oldUnread + 1 else oldUnread
        preferences.edit().putString(key, "$updatedAt|$unread|$readAt").apply()
        return unread
    }

    @Synchronized
    fun markSessionRead(subject: String, runtimeId: String, sessionId: String, now: Long = System.currentTimeMillis()) {
        val key = key("session", subject, runtimeId, sessionId)
        track(subject, key)
        trackRuntime(subject, runtimeId, key)
        val seenAt = preferences.getString(key, null)?.substringBefore('|').orEmpty()
        preferences.edit().putString(key, "$seenAt|0|$now").apply()
    }

    @Synchronized
    fun saveWorkspace(
        subject: String,
        runtimeId: String,
        workspaceId: String,
        summary: RemoteActivitySummary,
    ) {
        val indexKey = key("workspace-index", subject, runtimeId)
        track(subject, indexKey)
        track(subject, key("workspace", subject, runtimeId, workspaceId))
        trackRuntime(subject, runtimeId, indexKey)
        trackRuntime(subject, runtimeId, key("workspace", subject, runtimeId, workspaceId))
        val ids = preferences.getStringSet(indexKey, emptySet()).orEmpty() + workspaceId
        preferences.edit()
            .putStringSet(indexKey, ids)
            .putString(key("workspace", subject, runtimeId, workspaceId), encode(summary))
            .apply()
    }

    @Synchronized
    fun runtime(subject: String, runtimeId: String): RemoteActivitySummary =
        preferences.getStringSet(key("workspace-index", subject, runtimeId), emptySet()).orEmpty()
            .mapNotNull { workspaceId ->
                preferences.getString(key("workspace", subject, runtimeId, workspaceId), null)?.let(::decode)
            }
            .fold(RemoteActivitySummary(), RemoteActivitySummary::plus)

    @Synchronized
    fun clearSubject(subject: String) {
        val index = subjectIndex(subject)
        preferences.edit().apply {
            preferences.getStringSet(index, emptySet()).orEmpty().forEach(::remove)
            remove(index)
        }.apply()
    }

    @Synchronized
    fun clearRuntime(subject: String, runtimeId: String) {
        val runtimeIndex = runtimeIndex(subject, runtimeId)
        val subjectIndex = subjectIndex(subject)
        val removing = preferences.getStringSet(runtimeIndex, emptySet()).orEmpty()
        preferences.edit().apply {
            removing.forEach(::remove)
            putStringSet(subjectIndex, preferences.getStringSet(subjectIndex, emptySet()).orEmpty() - removing)
            remove(runtimeIndex)
        }.apply()
    }

    private fun track(subject: String, valueKey: String) {
        val index = subjectIndex(subject)
        preferences.edit().putStringSet(index,
            preferences.getStringSet(index, emptySet()).orEmpty() + valueKey).apply()
    }

    private fun trackRuntime(subject: String, runtimeId: String, valueKey: String) {
        val index = runtimeIndex(subject, runtimeId)
        preferences.edit().putStringSet(index,
            preferences.getStringSet(index, emptySet()).orEmpty() + valueKey).apply()
    }

    private fun subjectIndex(subject: String) = key("subject-index", subject)
    private fun runtimeIndex(subject: String, runtimeId: String) = key("runtime-index", subject, runtimeId)

    private fun encode(value: RemoteActivitySummary) =
        "${value.unreadTurns}|${value.pendingApprovals}|${value.runningRuns}|${value.lastActivityAt}"

    private fun decode(value: String): RemoteActivitySummary? {
        val parts = value.split('|', limit = 4)
        if (parts.size != 4) return null
        return RemoteActivitySummary(parts[0].toIntOrNull() ?: return null,
            parts[1].toIntOrNull() ?: return null, parts[2].toIntOrNull() ?: return null, parts[3])
    }

    private fun key(vararg scope: String): String = "activity_" +
        MessageDigest.getInstance("SHA-256").digest(scope.joinToString("\u0000").toByteArray())
            .joinToString("") { "%02x".format(it) }
}
