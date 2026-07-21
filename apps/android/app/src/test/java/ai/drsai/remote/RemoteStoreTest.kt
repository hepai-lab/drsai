package ai.drsai.remote

import ai.drsai.remote.remote.data.EventDecision
import ai.drsai.remote.remote.data.RemoteEventEntity
import ai.drsai.remote.remote.data.RemoteEventReducer
import ai.drsai.remote.remote.data.offlineRemotePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteStoreTest {
    private fun event(runtime: String = "rt", run: String = "run", id: String = "event-1", sequence: Long = 1) =
        RemoteEventEntity("alice", "ihep", runtime, "ws", "session", run, id, sequence, "delta", "2026-07-17T00:00:00Z")

    @Test fun `event reducer handles duplicate order gap and scope deterministically`() {
        assertEquals(EventDecision.APPLY, RemoteEventReducer.decide(0, event(), "rt", "run", false))
        assertEquals(EventDecision.DUPLICATE, RemoteEventReducer.decide(1, event(), "rt", "run", true))
        assertEquals(EventDecision.OUT_OF_ORDER, RemoteEventReducer.decide(2, event(sequence = 1), "rt", "run", false))
        assertEquals(EventDecision.GAP, RemoteEventReducer.decide(1, event(sequence = 3), "rt", "run", false))
        assertEquals(EventDecision.CROSS_SCOPE, RemoteEventReducer.decide(0, event(runtime = "other"), "rt", "run", false))
        assertEquals(EventDecision.CROSS_SCOPE, RemoteEventReducer.decide(0, event(run = "other"), "rt", "run", false))
    }

    @Test fun `offline mode is history only and never creates run outbox`() {
        val policy = offlineRemotePolicy(false)
        assertTrue(policy.cachedHistoryVisible)
        assertFalse(policy.sendEnabled)
        assertFalse(policy.approvalEnabled)
        assertFalse(policy.controlEnabled)
        assertFalse(policy.createsOutbox)
    }
}
