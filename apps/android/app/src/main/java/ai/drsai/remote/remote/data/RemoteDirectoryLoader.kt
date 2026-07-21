package ai.drsai.remote.remote.data

import android.content.Context
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

data class RemoteDirectoryEntry(
    val runtime: DiscoveredRuntime,
    val workspaces: List<RemoteWorkspaceRef>,
)

data class WorkspaceRecencyKey(
    val subject: String,
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId,
)

interface WorkspaceRecencyStore {
    fun lastOpened(key: WorkspaceRecencyKey): Long?
    fun markOpened(key: WorkspaceRecencyKey, timestampMillis: Long)
}

class SharedPreferencesWorkspaceRecencyStore(context: Context) : WorkspaceRecencyStore {
    private val preferences = context.getSharedPreferences("remote_workspace_recency", Context.MODE_PRIVATE)

    override fun lastOpened(key: WorkspaceRecencyKey): Long? =
        preferences.getLong(key.storageKey(), Long.MIN_VALUE).takeUnless { it == Long.MIN_VALUE }

    override fun markOpened(key: WorkspaceRecencyKey, timestampMillis: Long) {
        preferences.edit().putLong(key.storageKey(), timestampMillis).apply()
    }

    private fun WorkspaceRecencyKey.storageKey(): String =
        listOf(subject, runtimeId.value, workspaceId.value).joinToString("\u001f")
}

/** Loads the complete authorized directory while retaining Relay cursor semantics. */
class RemoteDirectoryLoader(
    private val relay: RelayDiscoveryService,
    private val recency: WorkspaceRecencyStore,
) {
    suspend fun load(subject: String, query: String? = null): List<RemoteDirectoryEntry> = coroutineScope {
        val normalizedQuery = query?.trim().orEmpty()
        val runtimes = collectAllPages { cursor -> relay.listRuntimes(cursor = cursor) }
        runtimes.map { runtime ->
            async {
                val runtimeMatches = normalizedQuery.isNotEmpty() &&
                    runtime.reference.displayName.contains(normalizedQuery, ignoreCase = true)
                val workspaces = collectAllPages { cursor ->
                    relay.listWorkspaces(
                        runtimeId = runtime.reference.runtimeId,
                        cursor = cursor,
                        query = normalizedQuery.takeUnless { it.isEmpty() || runtimeMatches },
                    )
                }.sortedWith(
                    compareByDescending<RemoteWorkspaceRef> {
                        recency.lastOpened(WorkspaceRecencyKey(subject, it.runtimeId, it.workspaceId)) ?: Long.MIN_VALUE
                    }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName },
                )
                RemoteDirectoryEntry(runtime, workspaces)
            }
        }.awaitAll()
            .filter { normalizedQuery.isEmpty() || it.runtime.reference.displayName.contains(normalizedQuery, true) || it.workspaces.isNotEmpty() }
            .sortedWith(
                compareByDescending<RemoteDirectoryEntry> { entry ->
                    entry.workspaces.maxOfOrNull {
                        recency.lastOpened(WorkspaceRecencyKey(subject, it.runtimeId, it.workspaceId)) ?: Long.MIN_VALUE
                    } ?: Long.MIN_VALUE
                }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.runtime.reference.displayName },
            )
    }

    fun markOpened(subject: String, workspace: RemoteWorkspaceRef, timestampMillis: Long = System.currentTimeMillis()) {
        recency.markOpened(WorkspaceRecencyKey(subject, workspace.runtimeId, workspace.workspaceId), timestampMillis)
    }
}

internal suspend fun <T> collectAllPages(fetch: suspend (String?) -> Page<T>): List<T> {
    val result = mutableListOf<T>()
    val seenCursors = mutableSetOf<String>()
    var cursor: String? = null
    var pageCount = 0
    do {
        val page = fetch(cursor)
        result += page.items
        cursor = page.nextCursor
        if (cursor != null) require(seenCursors.add(cursor)) { "relay_cursor_cycle" }
        pageCount += 1
        require(pageCount <= 10_000) { "relay_page_limit_exceeded" }
    } while (cursor != null)
    return result
}
