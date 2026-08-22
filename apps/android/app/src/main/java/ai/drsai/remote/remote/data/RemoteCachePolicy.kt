package ai.drsai.remote.remote.data

enum class RemoteCacheSource { NETWORK, CACHE }

data class RemoteCacheMetadata(
    val source: RemoteCacheSource,
    val lastSyncedAt: Long?,
    val expiresAt: Long?,
    val staleReason: String?,
) {
    val stale: Boolean get() = staleReason != null
}

object RemoteCachePolicy {
    const val HOST_TTL_MS = 5 * 60 * 1_000L
    const val WORKSPACE_TTL_MS = 10 * 60 * 1_000L
    const val SESSION_TTL_MS = 5 * 60 * 1_000L
    const val SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000L
    const val MAX_HOSTS = 100
    const val MAX_WORKSPACES_PER_HOST = 1_000
    const val MAX_SESSIONS_PER_WORKSPACE = 10_000
    const val MAX_EVENTS_PER_ACCOUNT = 100_000
    const val MAX_TERMINAL_ITEMS_PER_ACCOUNT = 100_000
    const val MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1_000L
    const val JOURNAL_RETENTION_MS = 30L * 24 * 60 * 60 * 1_000L

    fun metadata(
        source: RemoteCacheSource,
        lastSyncedAt: Long?,
        ttlMs: Long,
        now: Long,
        reason: String? = null,
    ): RemoteCacheMetadata {
        val expiresAt = lastSyncedAt?.plus(ttlMs)
        val staleReason = reason ?: if (expiresAt != null && now > expiresAt) "ttl_expired" else null
        return RemoteCacheMetadata(source, lastSyncedAt, expiresAt, staleReason)
    }
}
