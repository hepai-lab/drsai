package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceSessionCatalogTest {
    @Test fun fourLifecycleEventsAreTypedDeduplicatedAndOrderedPerSession() {
        val gate = WorkspaceSessionCatalogGate()
        val events = listOf(
            event("rename", "event.session.updated", 2),
            event("archive", "event.session.archived", 3),
            event("unarchive", "event.session.unarchived", 4),
            event("rollback", "event.session.updated", 5),
        )
        assertEquals(List(4) { WorkspaceSessionCatalogDecision.APPLY }, events.map(gate::accept))
        assertEquals(WorkspaceSessionCatalogDecision.DUPLICATE, gate.accept(events.last()))
        assertEquals(
            WorkspaceSessionCatalogDecision.STALE,
            gate.accept(event("stale", "event.session.updated", 1)),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun eventIdCollisionFailsClosed() {
        val gate = WorkspaceSessionCatalogGate()
        gate.accept(event("same", "event.session.updated", 1))
        gate.accept(event("same", "event.session.archived", 2))
    }

    @Test fun decoderRejectsPayloadAndTenThousandRowsHaveStableAuthorityOrder() {
        val decoded = decodeWorkspaceSessionCatalogEvent(JSONObject(
            """{"event_id":"event-one","session_id":"session-one","type":"event.session.updated","sequence":1}""",
        ))
        assertEquals("session-one", decoded.sessionId)
        val runtimeId = RuntimeId("runtime-one")
        val workspaceId = WorkspaceId("workspace-one")
        val rows = (0 until 10_000).map { index ->
            val id = "session-${index.toString().padStart(5, '0')}"
            RemoteSessionSummary(
                RemoteSessionRef(runtimeId, workspaceId, SessionId(id), id, "opendrsai"),
                "agent", "1", null,
                "2026-08-12T00:${(index / 60 % 60).toString().padStart(2, '0')}:${(index % 60).toString().padStart(2, '0')}Z",
                "active",
            )
        }.shuffled(java.util.Random(7))
        val projected = WorkspaceSessionCatalogProjection.project(
            rows, runtimeId, workspaceId, RemoteResourceLifecycle.ACTIVE,
        )
        assertEquals(10_000, projected.size)
        assertEquals(10_000, projected.map { it.reference.sessionId }.distinct().size)
        assertTrue(projected.zipWithNext().all { (left, right) ->
            left.updatedAt > right.updatedAt ||
                left.updatedAt == right.updatedAt && left.reference.sessionId.value < right.reference.sessionId.value
        })
    }

    private fun event(id: String, type: String, sequence: Long) = WorkspaceSessionCatalogEvent(
        eventId = id,
        sessionId = "session-one",
        type = type,
        sequence = sequence,
    )
}
