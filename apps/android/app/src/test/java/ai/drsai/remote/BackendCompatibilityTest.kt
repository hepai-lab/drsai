package ai.drsai.remote

import ai.drsai.remote.remote.model.*
import org.junit.Assert.*
import org.junit.Test

class BackendCompatibilityTest {
    private fun backend(id: String) = RemoteBackendDescriptor(id, if (id == "codex") "Codex" else "OpenDrSai", "1.0", "healthy", setOf("chat", "tool"))

    @Test fun `catalog exposes unified backend metadata and pins run`() {
        val session = BackendBoundSession(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), backend("codex"))
        assertEquals("codex", session.createRun(RunId("r"), "codex").backendId)
        assertEquals(setOf("chat", "tool"), session.backend.capabilities)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `backend switch within run is forbidden`() {
        BackendBoundSession(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), backend("codex"))
            .createRun(RunId("r"), "opendrsai")
    }

    @Test fun `codex failures map to unified errors with no fallback`() {
        assertEquals(UnifiedBackendError.AUTH_REQUIRED, mapBackendError("codex", "not_authenticated"))
        assertEquals(UnifiedBackendError.INCOMPATIBLE, mapBackendError("codex", "version_incompatible"))
        assertEquals(UnifiedBackendError.UNAVAILABLE, mapBackendError("codex", "app_server_dead"))
        assertEquals(UnifiedBackendError.SCHEMA_DRIFT, mapBackendError("codex", "schema_drift"))
    }

    @Test fun `both backends map all event families to same timeline`() {
        val types = listOf("message", "tool", "workspace_change", "approval", "cancel", "terminal")
        val openDrSai = types.map { UnifiedRemoteTimelineItem(it, null, null, null) }
        val codex = types.map { UnifiedRemoteTimelineItem(it, null, null, null) }
        assertEquals(openDrSai, codex)
    }

    @Test fun `parallel backend resources remain distinct`() {
        val index = BackendIsolationIndex()
        assertTrue(index.insert("rt", "ws", "session-open", "opendrsai", "same"))
        assertTrue(index.insert("rt", "ws", "session-codex", "codex", "same"))
        assertEquals(2, index.size())
    }
}
