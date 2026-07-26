package ai.drsai.remote

import ai.drsai.remote.remote.data.DiscoveredRuntime
import ai.drsai.remote.remote.data.Page
import ai.drsai.remote.remote.data.RelayDiscoveryService
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.WorkspaceRecencyKey
import ai.drsai.remote.remote.data.WorkspaceRecencyStore
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

    private class MemoryRecencyStore : WorkspaceRecencyStore {
        private val values = mutableMapOf<WorkspaceRecencyKey, Long>()
        override fun lastOpened(key: WorkspaceRecencyKey): Long? = values[key]
        override fun markOpened(key: WorkspaceRecencyKey, timestampMillis: Long) { values[key] = timestampMillis }
    }

    private class FakeDirectoryService : RelayDiscoveryService {
        val runtimeCursors = mutableListOf<String?>()
        val workspaceCursors = mutableMapOf<RuntimeId, MutableList<String?>>()
        val workspaceQueries = mutableListOf<String?>()

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

        override suspend fun associate(accessGrantPayload: String): RuntimeId = error("not used")
        override suspend fun revokeAssociation(runtimeId: RuntimeId): Unit = error("not used")

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
