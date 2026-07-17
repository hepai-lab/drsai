package ai.drsai.remote

import ai.drsai.remote.remote.model.EventId
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteRunProjection
import ai.drsai.remote.remote.model.RemoteRunStatus
import ai.drsai.remote.remote.model.RemoteRuntimeEvent
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteModelsTest {
    private val identity = RemoteRunIdentity(
        RuntimeId("runtime-a"),
        WorkspaceId("workspace-a"),
        SessionId("session-a"),
        RunId("run-a"),
        "opendrsai",
    )

    @Test
    fun transportLossCannotFailRemoteRun() {
        val projection = RemoteRunProjection(identity, RemoteRunStatus.RUNNING, lastSequence = 4)
        val offline = projection.markConnection(RemoteConnectionState.OFFLINE)
        assertEquals(RemoteRunStatus.RUNNING, offline.status)
        assertEquals(4, offline.lastSequence)
        assertFalse(offline.authoritative)
    }

    @Test
    fun onlyNewSameScopeRuntimeEventAdvancesProjection() {
        val projection = RemoteRunProjection(identity, RemoteRunStatus.RUNNING, lastSequence = 4)
        val completed = projection.applyRuntimeEvent(
            RemoteRuntimeEvent(
                EventId("event-5"), identity, 5, "run.completed", "2026-07-17T00:00:00Z",
                RemoteRunStatus.COMPLETED,
            ),
            syncedAt = 123,
        )
        assertEquals(RemoteRunStatus.COMPLETED, completed.status)
        assertEquals(5, completed.lastSequence)
        assertEquals(123L, completed.lastSyncedAt)
    }

    @Test(expected = IllegalArgumentException::class)
    fun crossWorkspaceEventIsRejected() {
        val projection = RemoteRunProjection(identity, RemoteRunStatus.RUNNING)
        val other = RemoteRunIdentity(
            identity.runtimeId,
            WorkspaceId("workspace-b"),
            identity.sessionId,
            identity.runId,
            identity.backendId,
        )
        projection.applyRuntimeEvent(
            RemoteRuntimeEvent(EventId("event-1"), other, 1, "run.started", "now"),
            syncedAt = 1,
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun clientProjectionCannotClaimAuthority() {
        RemoteRunProjection(identity, RemoteRunStatus.RUNNING, authoritative = true)
    }
}
