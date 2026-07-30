package ai.drsai.remote.remote.data

import android.content.Context
import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RemoteRuntimeRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import org.json.JSONArray
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

data class RemoteDirectoryEntry(
    val runtime: DiscoveredRuntime,
    val workspaces: List<RemoteWorkspaceRef>,
    val workspaceProjectionCached: Boolean = false,
    val lastSyncedAt: Long? = null,
)

data class RemoteDirectoryResult(
    val entries: List<RemoteDirectoryEntry>,
    val stale: Boolean,
    val warning: String? = null,
)

interface RemoteDirectoryCache {
    suspend fun read(subject: String, organization: String): List<RemoteDirectoryEntry>
    suspend fun reconcileRuntimes(
        subject: String,
        organization: String,
        runtimes: List<DiscoveredRuntime>,
        syncedAt: Long,
    )
    suspend fun replaceWorkspaces(
        subject: String,
        organization: String,
        runtimeId: RuntimeId,
        workspaces: List<RemoteWorkspaceRef>,
        syncedAt: Long,
    )
    suspend fun removeRuntime(subject: String, organization: String, runtimeId: RuntimeId)
    suspend fun clear(subject: String, organization: String)
}

class RoomRemoteDirectoryCache(private val database: ChatDatabase) : RemoteDirectoryCache {
    override suspend fun read(subject: String, organization: String): List<RemoteDirectoryEntry> {
        val dao = database.remoteDao()
        return dao.runtimes(subject, organization).map { runtime ->
            val workspaceEntities = dao.workspaces(subject, organization, runtime.runtimeId)
            RemoteDirectoryEntry(
                runtime = DiscoveredRuntime(
                    reference = RemoteRuntimeRef(RuntimeId(runtime.runtimeId), runtime.displayName),
                    instanceId = runtime.instanceId,
                    version = runtime.version,
                    protocolVersion = "",
                    connectionGeneration = 0,
                    state = runCatching {
                        RemoteConnectionState.valueOf(runtime.connectionState)
                    }.getOrDefault(RemoteConnectionState.INCOMPATIBLE),
                    capabilities = runCatching {
                        val values = JSONArray(runtime.capabilitiesJson)
                        (0 until values.length()).map(values::getString).toSet()
                    }.getOrDefault(emptySet()),
                ),
                workspaces = workspaceEntities.map { workspace ->
                    RemoteWorkspaceRef(
                        runtimeId = RuntimeId(workspace.runtimeId),
                        workspaceId = WorkspaceId(workspace.workspaceId),
                        displayName = workspace.displayName,
                        lifecycle = RemoteResourceLifecycle.fromWire(workspace.lifecycle),
                        revision = workspace.revision,
                        updatedAt = workspace.updatedAt,
                    )
                },
                workspaceProjectionCached = true,
                lastSyncedAt = workspaceEntities.maxOfOrNull { it.lastSyncedAt }
                    ?: runtime.lastSyncedAt,
            )
        }
    }

    override suspend fun reconcileRuntimes(
        subject: String,
        organization: String,
        runtimes: List<DiscoveredRuntime>,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        val authorized = runtimes.map { it.reference.runtimeId.value }.toSet()
        dao.runtimes(subject, organization)
            .filterNot { it.runtimeId in authorized }
            .forEach { purgeRuntime(dao, subject, organization, it.runtimeId) }
        dao.saveRuntimes(runtimes.map { runtime ->
            RemoteRuntimeEntity(
                subject = subject,
                organization = organization,
                runtimeId = runtime.reference.runtimeId.value,
                displayName = runtime.reference.displayName,
                instanceId = runtime.instanceId,
                version = runtime.version,
                connectionState = runtime.state.name,
                capabilitiesJson = JSONArray(runtime.capabilities.toList().sorted()).toString(),
                lastSyncedAt = syncedAt,
                authoritative = false,
            )
        })
    }

    override suspend fun replaceWorkspaces(
        subject: String,
        organization: String,
        runtimeId: RuntimeId,
        workspaces: List<RemoteWorkspaceRef>,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        val activeIds = workspaces.map { it.workspaceId.value }.toSet()
        dao.allWorkspaces(subject, organization, runtimeId.value)
            .filterNot { it.workspaceId in activeIds }
            .forEach {
                purgeWorkspace(dao, subject, organization, runtimeId.value, it.workspaceId)
            }
        dao.saveWorkspaces(workspaces.map { workspace ->
            RemoteWorkspaceEntity(
                subject = subject,
                organization = organization,
                runtimeId = runtimeId.value,
                workspaceId = workspace.workspaceId.value,
                displayName = workspace.displayName,
                lastSyncedAt = syncedAt,
                authoritative = false,
                lifecycle = workspace.lifecycle.toWire(),
                revision = workspace.revision,
                updatedAt = workspace.updatedAt,
            )
        })
    }

    override suspend fun removeRuntime(
        subject: String,
        organization: String,
        runtimeId: RuntimeId,
    ) = database.withTransaction {
        purgeRuntime(database.remoteDao(), subject, organization, runtimeId.value)
    }

    override suspend fun clear(subject: String, organization: String) = database.withTransaction {
        database.remoteDao().runtimes(subject, organization).forEach {
            purgeRuntime(database.remoteDao(), subject, organization, it.runtimeId)
        }
    }

    private suspend fun purgeRuntime(
        dao: RemoteCacheDao,
        subject: String,
        organization: String,
        runtimeId: String,
    ) {
        dao.clearRuntimeConversationItems(subject, organization, runtimeId)
        dao.clearRuntimeSessionEvents(subject, organization, runtimeId)
        dao.clearRuntimeEvents(subject, organization, runtimeId)
        dao.clearRuntimeCursors(subject, organization, runtimeId)
        dao.clearRuntimeApprovals(subject, organization, runtimeId)
        dao.clearRuntimeRuns(subject, organization, runtimeId)
        dao.clearRuntimeSessions(subject, organization, runtimeId)
        dao.clearRuntimeWorkspaces(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchApprovalGrants(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchApprovals(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchEvents(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchRuns(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchSessions(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchWorkspaces(subject, organization, runtimeId)
        dao.clearRuntimeWorkbenchAudit(subject, organization, runtimeId)
        dao.clearRuntime(subject, organization, runtimeId)
    }

    private suspend fun purgeWorkspace(
        dao: RemoteCacheDao,
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
    ) {
        dao.clearWorkspaceConversationItems(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceSessionEvents(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceEvents(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceApprovals(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceRuns(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceSessions(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceWorkbenchRuns(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceWorkbenchSessions(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspaceWorkbenchWorkspace(subject, organization, runtimeId, workspaceId)
        dao.clearWorkspace(subject, organization, runtimeId, workspaceId)
        // Cursors do not contain workspaceId. Clearing this Runtime's cursors is
        // conservative and prevents a removed Workspace cursor from being reused.
        dao.clearRuntimeCursors(subject, organization, runtimeId)
    }
}

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
    private val cache: RemoteDirectoryCache? = null,
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

    suspend fun cached(subject: String, organization: String = ""): List<RemoteDirectoryEntry> =
        try {
            cache?.read(subject, organization).orEmpty()
        } catch (_: RuntimeException) {
            // The projection is disposable. Corruption must never block an
            // authoritative Platform refresh or revive partially decoded rows.
            cache?.clear(subject, organization)
            emptyList()
        }

    suspend fun removeCachedRuntime(
        subject: String,
        runtimeId: RuntimeId,
        organization: String = "",
    ) {
        cache?.removeRuntime(subject, organization, runtimeId)
    }

    /** Refreshes one authorized Runtime's complete Workspace Catalog. */
    suspend fun refreshWorkspaces(
        subject: String,
        runtimeId: RuntimeId,
        organization: String = "",
        now: Long = System.currentTimeMillis(),
    ): List<RemoteWorkspaceRef> {
        val workspaces = try {
            collectAllPages { cursor ->
                relay.listWorkspaces(runtimeId = runtimeId, cursor = cursor)
            }
        } catch (failure: RelayHttpException) {
            if (failure.status == 403) cache?.removeRuntime(subject, organization, runtimeId)
            throw failure
        }
        cache?.replaceWorkspaces(subject, organization, runtimeId, workspaces, now)
        return workspaces.sortedWith(
            compareByDescending<RemoteWorkspaceRef> {
                recency.lastOpened(WorkspaceRecencyKey(subject, it.runtimeId, it.workspaceId))
                    ?: Long.MIN_VALUE
            }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName },
        )
    }

    /**
     * Synchronizes the device-authorized Host Catalog. A 200 response is
     * authoritative for membership; Room remains a disposable projection.
     */
    suspend fun synchronize(
        subject: String,
        organization: String = "",
        query: String? = null,
        now: Long = System.currentTimeMillis(),
    ): RemoteDirectoryResult {
        val cachedByRuntime = cached(subject, organization)
            .associateBy { it.runtime.reference.runtimeId }
        val runtimes = try {
            collectAllPages { cursor -> relay.listRuntimes(cursor = cursor) }
        } catch (failure: RelayHttpException) {
            if (failure.status == 403) cache?.clear(subject, organization)
            throw failure
        }
        cache?.reconcileRuntimes(subject, organization, runtimes, now)
        var stale = false
        var warning: String? = null
        val entries = mutableListOf<RemoteDirectoryEntry>()
        for (runtime in runtimes) {
            val runtimeId = runtime.reference.runtimeId
            val previous = cachedByRuntime[runtimeId]
            if (runtime.state == RemoteConnectionState.OFFLINE) {
                stale = stale || previous != null
                entries += RemoteDirectoryEntry(
                    runtime,
                    previous?.workspaces.orEmpty(),
                    workspaceProjectionCached = true,
                    lastSyncedAt = previous?.lastSyncedAt,
                )
                continue
            }
            try {
                val workspaces = collectAllPages { cursor ->
                    relay.listWorkspaces(runtimeId = runtimeId, cursor = cursor)
                }
                cache?.replaceWorkspaces(subject, organization, runtimeId, workspaces, now)
                entries += RemoteDirectoryEntry(
                    runtime,
                    workspaces,
                    workspaceProjectionCached = false,
                    lastSyncedAt = now,
                )
            } catch (failure: RelayHttpException) {
                if (failure.status == 403) {
                    cache?.removeRuntime(subject, organization, runtimeId)
                    warning = "remote_access_revoked"
                } else {
                    stale = true
                    warning = warning ?: "workspace_catalog_unavailable"
                    entries += RemoteDirectoryEntry(
                        runtime.copy(state = RemoteConnectionState.DEGRADED),
                        previous?.workspaces.orEmpty(),
                        workspaceProjectionCached = true,
                        lastSyncedAt = previous?.lastSyncedAt,
                    )
                }
            } catch (_: java.io.IOException) {
                stale = true
                warning = warning ?: "workspace_catalog_unavailable"
                entries += RemoteDirectoryEntry(
                    runtime.copy(state = RemoteConnectionState.DEGRADED),
                    previous?.workspaces.orEmpty(),
                    workspaceProjectionCached = true,
                    lastSyncedAt = previous?.lastSyncedAt,
                )
            }
        }
        val normalized = query?.trim().orEmpty()
        val filtered = entries.mapNotNull { entry ->
            val runtimeMatches = entry.runtime.reference.displayName.contains(normalized, ignoreCase = true)
            val workspaces = if (normalized.isEmpty() || runtimeMatches) {
                entry.workspaces
            } else {
                entry.workspaces.filter { it.displayName.contains(normalized, ignoreCase = true) }
            }
            entry.copy(
                workspaces = workspaces.sortedWith(
                    compareByDescending<RemoteWorkspaceRef> {
                        recency.lastOpened(WorkspaceRecencyKey(subject, it.runtimeId, it.workspaceId))
                            ?: Long.MIN_VALUE
                    }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName },
                )
            ).takeIf { normalized.isEmpty() || runtimeMatches || workspaces.isNotEmpty() }
        }.sortedWith(
            compareByDescending<RemoteDirectoryEntry> { entry ->
                entry.workspaces.maxOfOrNull {
                    recency.lastOpened(WorkspaceRecencyKey(subject, it.runtimeId, it.workspaceId))
                        ?: Long.MIN_VALUE
                } ?: Long.MIN_VALUE
            }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.runtime.reference.displayName },
        )
        return RemoteDirectoryResult(filtered, stale, warning)
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
