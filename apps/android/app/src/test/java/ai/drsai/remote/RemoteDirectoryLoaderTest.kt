package ai.drsai.remote

import ai.drsai.remote.remote.data.DiscoveredRuntime
import ai.drsai.remote.remote.data.Page
import ai.drsai.remote.remote.data.RelayDiscoveryService
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.RemoteDirectoryCache
import ai.drsai.remote.remote.data.RemoteDirectoryEntry
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.WorkspaceRecencyKey
import ai.drsai.remote.remote.data.WorkspaceRecencyStore
import ai.drsai.remote.remote.data.WorkspaceCatalogSync
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteRuntimeRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteDirectoryLoaderTest {
    @Test
    fun `loads every runtime and workspace page and preserves runtime scope`() = runTest {
        val service = FakeDirectoryService()
        val loader = RemoteDirectoryLoader(service, MemoryRecencyStore())

        val directory = loader.load("user-a")

        assertEquals(listOf("runtime-a", "runtime-b"), directory.map { it.runtime.reference.runtimeId.value })
        assertEquals(0, service.syncCalls)
        assertEquals(listOf("shared", "workspace-a2"), directory[0].workspaces.map { it.workspaceId.value })
        assertEquals("runtime-a", directory[0].workspaces[0].runtimeId.value)
        assertEquals("runtime-b", directory[1].workspaces.single().runtimeId.value)
        assertEquals(listOf(null, "runtime-page-2"), service.runtimeCursors)
        assertEquals(listOf(null, "workspace-page-2"), service.workspaceCursors[RuntimeId("runtime-a")])
    }

    @Test
    fun `search matches workspace across runtimes and has deterministic empty state`() = runTest {
        val service = FakeDirectoryService()
        val loader = RemoteDirectoryLoader(service, MemoryRecencyStore())

        val matching = loader.load("user-a", "Beta")
        val empty = loader.load("user-a", "does-not-exist")

        assertEquals(listOf("runtime-b"), matching.map { it.runtime.reference.runtimeId.value })
        assertEquals(listOf("Beta project"), matching.single().workspaces.map { it.displayName })
        assertTrue(empty.isEmpty())
        assertTrue(service.workspaceQueries.contains("Beta"))
    }

    @Test
    fun `recent ordering is isolated by subject runtime and workspace`() = runTest {
        val service = FakeDirectoryService()
        val recency = MemoryRecencyStore()
        val loader = RemoteDirectoryLoader(service, recency)
        val selected = RemoteWorkspaceRef(RuntimeId("runtime-a"), WorkspaceId("workspace-a2"), "Zulu")
        loader.markOpened("user-a", selected, timestampMillis = 200)
        loader.markOpened(
            "user-b",
            RemoteWorkspaceRef(RuntimeId("runtime-b"), WorkspaceId("shared"), "Beta project"),
            timestampMillis = 300,
        )

        val userA = loader.load("user-a")
        val userB = loader.load("user-b")

        assertEquals("runtime-a", userA.first().runtime.reference.runtimeId.value)
        assertEquals("workspace-a2", userA.first().workspaces.first().workspaceId.value)
        assertEquals("runtime-b", userB.first().runtime.reference.runtimeId.value)
        assertEquals("runtime-b", userB.first().workspaces.first().runtimeId.value)
    }

    @Test
    fun `authoritative empty host catalog removes every cached projection`() = runTest {
        val cache = MemoryDirectoryCache(
            mutableListOf(
                RemoteDirectoryEntry(
                    discovered("runtime-a", RemoteConnectionState.ONLINE),
                    listOf(RemoteWorkspaceRef(RuntimeId("runtime-a"), WorkspaceId("workspace-a"), "A")),
                    true,
                    100,
                )
            )
        )
        val service = object : EmptyDirectoryService() {
            override suspend fun listRuntimes(cursor: String?, query: String?) =
                Page<DiscoveredRuntime>(emptyList())
        }

        val result = RemoteDirectoryLoader(service, MemoryRecencyStore(), cache)
            .synchronize("same-account-device-b")

        assertTrue(result.entries.isEmpty())
        assertTrue(cache.entries.isEmpty())
    }

    @Test
    fun `offline authorized host keeps only explicitly cached workspace projection`() = runTest {
        val runtimeId = RuntimeId("runtime-a")
        val workspace = RemoteWorkspaceRef(runtimeId, WorkspaceId("workspace-a"), "Cached")
        val cache = MemoryDirectoryCache(
            mutableListOf(
                RemoteDirectoryEntry(
                    discovered("runtime-a", RemoteConnectionState.ONLINE),
                    listOf(workspace),
                    true,
                    123,
                )
            )
        )
        var workspaceRequests = 0
        val service = object : EmptyDirectoryService() {
            override suspend fun listRuntimes(cursor: String?, query: String?) =
                Page(listOf(discovered("runtime-a", RemoteConnectionState.OFFLINE)))
            override suspend fun listWorkspaces(
                runtimeId: RuntimeId,
                cursor: String?,
                query: String?,
            ): Page<RemoteWorkspaceRef> {
                workspaceRequests += 1
                error("offline host must not be queried")
            }
        }

        val result = RemoteDirectoryLoader(service, MemoryRecencyStore(), cache)
            .synchronize("user-a")

        assertEquals(0, workspaceRequests)
        assertTrue(result.stale)
        assertTrue(result.entries.single().workspaceProjectionCached)
        assertEquals(listOf(workspace), result.entries.single().workspaces)
        assertEquals(123L, result.entries.single().lastSyncedAt)
    }

    @Test
    fun `authoritative workspace 403 removes host instead of reviving Room cache`() = runTest {
        val cache = MemoryDirectoryCache(
            mutableListOf(
                RemoteDirectoryEntry(
                    discovered("runtime-a", RemoteConnectionState.ONLINE),
                    listOf(RemoteWorkspaceRef(RuntimeId("runtime-a"), WorkspaceId("workspace-a"), "Old")),
                    true,
                    100,
                )
            )
        )
        val service = object : EmptyDirectoryService() {
            override suspend fun listRuntimes(cursor: String?, query: String?) =
                Page(listOf(discovered("runtime-a", RemoteConnectionState.ONLINE)))
            override suspend fun listWorkspaces(
                runtimeId: RuntimeId,
                cursor: String?,
                query: String?,
            ): Page<RemoteWorkspaceRef> = throw RelayHttpException(403, null, "association_required")
        }

        val result = RemoteDirectoryLoader(service, MemoryRecencyStore(), cache)
            .synchronize("user-a")

        assertTrue(result.entries.isEmpty())
        assertEquals("remote_access_revoked", result.warning)
        assertTrue(cache.entries.isEmpty())
    }

    @Test
    fun `targeted workspace refresh posts force sync and replaces cached projection`() = runTest {
        val runtimeId = RuntimeId("runtime-a")
        val cache = MemoryDirectoryCache(
            mutableListOf(
                RemoteDirectoryEntry(
                    discovered("runtime-a", RemoteConnectionState.ONLINE),
                    listOf(RemoteWorkspaceRef(runtimeId, WorkspaceId("old"), "Old")),
                    true,
                    100,
                )
            )
        )
        val service = FakeDirectoryService()

        val refreshed = RemoteDirectoryLoader(service, MemoryRecencyStore(), cache)
            .forceSyncWorkspaces("user-a", runtimeId)

        assertEquals(listOf("shared", "workspace-a2"), refreshed.items.map { it.workspaceId.value })
        assertEquals(1, service.syncCalls)
        assertTrue(service.workspaceCursors[runtimeId].isNullOrEmpty())
        assertEquals(refreshed.items, cache.entries.single().workspaces)
        assertEquals(200L, cache.entries.single().lastSyncedAt)
    }

    @Test
    fun `offline force sync preserves cached workspaces while forbidden removes host`() = runTest {
        val runtimeId = RuntimeId("runtime-a")
        fun cached() = MemoryDirectoryCache(
            mutableListOf(
                RemoteDirectoryEntry(
                    discovered("runtime-a", RemoteConnectionState.OFFLINE),
                    listOf(RemoteWorkspaceRef(runtimeId, WorkspaceId("cached"), "Cached")),
                    true,
                    100,
                )
            )
        )
        val offlineCache = cached()
        val offlineService = FakeDirectoryService().apply {
            syncFailure = RelayHttpException(503, "safe", "host_offline")
        }
        runCatching {
            RemoteDirectoryLoader(offlineService, MemoryRecencyStore(), offlineCache)
                .forceSyncWorkspaces("user-a", runtimeId)
        }
        assertEquals(listOf("cached"), offlineCache.entries.single().workspaces.map { it.workspaceId.value })

        val forbiddenCache = cached()
        val forbiddenService = FakeDirectoryService().apply {
            syncFailure = RelayHttpException(403, "safe", "association_required")
        }
        runCatching {
            RemoteDirectoryLoader(forbiddenService, MemoryRecencyStore(), forbiddenCache)
                .forceSyncWorkspaces("user-a", runtimeId)
        }
        assertTrue(forbiddenCache.entries.isEmpty())
    }

    private class MemoryRecencyStore : WorkspaceRecencyStore {
        private val values = mutableMapOf<WorkspaceRecencyKey, Long>()
        override fun lastOpened(key: WorkspaceRecencyKey): Long? = values[key]
        override fun markOpened(key: WorkspaceRecencyKey, timestampMillis: Long) { values[key] = timestampMillis }
    }

    private open class EmptyDirectoryService : RelayDiscoveryService {
        override suspend fun listRuntimes(cursor: String?, query: String?) =
            Page<DiscoveredRuntime>(emptyList())
        override suspend fun listWorkspaces(
            runtimeId: RuntimeId,
            cursor: String?,
            query: String?,
        ) = Page<RemoteWorkspaceRef>(emptyList())
        override suspend fun associate(accessGrantPayload: String): RuntimeId = error("not used")
        override suspend fun revokeAssociation(runtimeId: RuntimeId): Unit = error("not used")
        override suspend fun recordPresence(runtimeId: RuntimeId, accessing: Boolean): Unit = error("not used")
    }

    private class MemoryDirectoryCache(
        val entries: MutableList<RemoteDirectoryEntry> = mutableListOf(),
    ) : RemoteDirectoryCache {
        override suspend fun read(subject: String, organization: String) = entries.toList()
        override suspend fun reconcileRuntimes(
            subject: String,
            organization: String,
            runtimes: List<DiscoveredRuntime>,
            syncedAt: Long,
        ) {
            val authorized = runtimes.map { it.reference.runtimeId }.toSet()
            entries.removeAll { it.runtime.reference.runtimeId !in authorized }
            runtimes.forEach { runtime ->
                val index = entries.indexOfFirst {
                    it.runtime.reference.runtimeId == runtime.reference.runtimeId
                }
                val replacement = if (index >= 0) {
                    entries[index].copy(runtime = runtime)
                } else {
                    RemoteDirectoryEntry(runtime, emptyList(), false, syncedAt)
                }
                if (index >= 0) entries[index] = replacement else entries += replacement
            }
        }
        override suspend fun replaceWorkspaces(
            subject: String,
            organization: String,
            runtimeId: RuntimeId,
            workspaces: List<RemoteWorkspaceRef>,
            syncedAt: Long,
            catalogRevision: String?,
        ) {
            val index = entries.indexOfFirst { it.runtime.reference.runtimeId == runtimeId }
            check(index >= 0)
            entries[index] = entries[index].copy(
                workspaces = workspaces,
                workspaceProjectionCached = false,
                lastSyncedAt = syncedAt,
            )
        }
        override suspend fun removeRuntime(
            subject: String,
            organization: String,
            runtimeId: RuntimeId,
        ) {
            entries.removeAll { it.runtime.reference.runtimeId == runtimeId }
        }
        override suspend fun clear(subject: String, organization: String) {
            entries.clear()
        }
    }

    private fun discovered(
        id: String,
        state: RemoteConnectionState,
    ) = DiscoveredRuntime(
        reference = RemoteRuntimeRef(RuntimeId(id), "Host $id"),
        instanceId = "instance-$id",
        version = "1.5.3",
        protocolVersion = "2.0.0",
        connectionGeneration = 1,
        state = state,
    )

    private class FakeDirectoryService : RelayDiscoveryService {
        val runtimeCursors = mutableListOf<String?>()
        val workspaceCursors = mutableMapOf<RuntimeId, MutableList<String?>>()
        val workspaceQueries = mutableListOf<String?>()
        var syncCalls = 0
        var syncFailure: Throwable? = null

        override suspend fun listRuntimes(cursor: String?, query: String?): Page<DiscoveredRuntime> {
            runtimeCursors += cursor
            return if (cursor == null) Page(listOf(runtime("runtime-a", "Alpha computer")), "runtime-page-2")
            else Page(listOf(runtime("runtime-b", "Second computer")))
        }

        override suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String?, query: String?): Page<RemoteWorkspaceRef> {
            workspaceCursors.getOrPut(runtimeId) { mutableListOf() } += cursor
            workspaceQueries += query
            val all = when (runtimeId.value) {
                "runtime-a" -> listOf(
                    RemoteWorkspaceRef(runtimeId, WorkspaceId("shared"), "Alpha project"),
                    RemoteWorkspaceRef(runtimeId, WorkspaceId("workspace-a2"), "Zulu"),
                )
                else -> listOf(RemoteWorkspaceRef(runtimeId, WorkspaceId("shared"), "Beta project"))
            }.filter { query.isNullOrBlank() || it.displayName.contains(query, ignoreCase = true) }
            return if (runtimeId.value == "runtime-a" && query.isNullOrBlank() && cursor == null) Page(all.take(1), "workspace-page-2")
            else if (runtimeId.value == "runtime-a" && query.isNullOrBlank()) Page(all.drop(1))
            else Page(all)
        }

        override suspend fun syncWorkspaces(runtimeId: RuntimeId): WorkspaceCatalogSync {
            syncCalls += 1
            syncFailure?.let { throw it }
            return WorkspaceCatalogSync(
                runtimeId = runtimeId,
                catalogRevision = "3",
                syncedAt = "1970-01-01T00:00:00.200Z",
                items = listOf(
                    RemoteWorkspaceRef(runtimeId, WorkspaceId("shared"), "Alpha project"),
                    RemoteWorkspaceRef(runtimeId, WorkspaceId("workspace-a2"), "Zulu"),
                ),
            )
        }

        override suspend fun associate(accessGrantPayload: String): RuntimeId = error("not used")
        override suspend fun revokeAssociation(runtimeId: RuntimeId): Unit = error("not used")
        override suspend fun recordPresence(runtimeId: RuntimeId, accessing: Boolean): Unit = error("not used")

        private fun runtime(id: String, name: String) = DiscoveredRuntime(
            reference = RemoteRuntimeRef(RuntimeId(id), name),
            instanceId = "instance-$id",
            version = "1.0",
            protocolVersion = "1",
            connectionGeneration = 1,
            state = RemoteConnectionState.ONLINE,
        )
    }
}
