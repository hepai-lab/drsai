package ai.drsai.remote.remote.ui

import ai.drsai.remote.remote.data.RemoteActivitySummary
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteActivityAggregationTest {
    private fun session(
        id: String,
        workspace: String,
        updated: String,
        unread: Int = 0,
        approvals: Int = 0,
        running: Int = 0,
    ) = RemoteSessionUi(
        RemoteSessionRef(RuntimeId("rt"), WorkspaceId(workspace), SessionId(id), id, "opendrsai"),
        if (running > 0) "running" else "completed",
        updated,
        unreadTurns = unread,
        pendingApprovals = approvals,
        runningRuns = running,
    )

    @Test fun twoWorkspacesAndFourSessionsProduceExactBadgesAndPriorityOrder() {
        val w1 = listOf(
            session("normal", "w1", "2026-08-04T10:04:00Z", unread = 3),
            session("approval", "w1", "2026-08-04T10:01:00Z", approvals = 1),
        )
        val w2 = listOf(
            session("running", "w2", "2026-08-04T10:03:00Z", running = 1),
            session("recent", "w2", "2026-08-04T10:05:00Z", unread = 1),
        )
        assertEquals(listOf("approval", "normal"), activeRemoteSessions(w1).map { it.reference.sessionId.value })
        assertEquals(listOf("running", "recent"), activeRemoteSessions(w2).map { it.reference.sessionId.value })

        fun aggregate(items: List<RemoteSessionUi>) = items.fold(RemoteActivitySummary()) { total, item ->
            total + RemoteActivitySummary(item.unreadTurns, item.pendingApprovals, item.runningRuns, item.updatedAtLabel)
        }
        val host = aggregate(w1) + aggregate(w2)
        assertEquals(RemoteActivitySummary(4, 1, 1, "2026-08-04T10:05:00Z"), host)
    }
}
