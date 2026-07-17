package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.RemoteConnectionState
import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class RemoteReliabilityTest {
    @Test fun `state machine distinguishes transport runtime and business errors`() {
        val machine = RemoteConnectionStateMachine(); machine.connected(); assertEquals(RemoteConnectionState.ONLINE, machine.state)
        machine.degraded(RemoteFailure(RemoteFailureSource.RUNTIME, "backend_unhealthy", true)); assertEquals(RemoteConnectionState.DEGRADED, machine.state)
        machine.authenticationRequired(RemoteFailure(RemoteFailureSource.RELAY, "auth_required", false)); assertEquals(RemoteConnectionState.AUTH_REQUIRED, machine.state)
        machine.connected(false); assertEquals(RemoteConnectionState.INCOMPATIBLE, machine.state)
    }

    @Test fun `network and lifecycle rebuild only transport and resume from committed sequence`() {
        val coordinator = RemoteLifecycleCoordinator(); coordinator.eventCommitted(1); coordinator.eventCommitted(2)
        assertEquals(ResumeAction.NONE, coordinator.background())
        assertEquals(ResumeAction.REBUILD_TRANSPORT, coordinator.networkChanged())
        assertEquals(ResumeAction.QUERY_STATUS_THEN_RESUME_EVENTS, coordinator.foreground())
        assertEquals(2, coordinator.lastSequence); assertEquals(1, coordinator.transportGeneration)
        val guard = RemoteCommandGuard(); assertTrue(guard.firstSubmission("run-idem")); assertFalse(guard.firstSubmission("run-idem"))
    }

    @Test fun `instance generation forces capability and active run reconciliation`() {
        val tracker = RuntimeInstanceTracker()
        assertFalse(tracker.observe("rt", "boot-a", 1).changed)
        val changed = tracker.observe("rt", "boot-b", 2)
        assertTrue(changed.changed); assertEquals(ResumeAction.QUERY_STATUS_THEN_RESUME_EVENTS, changed.action)
    }

    @Test fun `event gaps expiry and truncation never silently skip`() {
        assertEquals(EventRecovery.Apply(3), planEventRecovery(2, 3, false, false))
        assertEquals(EventRecovery.FetchGap(2), planEventRecovery(2, 5, false, false))
        assertEquals(EventRecovery.FullState, planEventRecovery(2, null, true, false))
        assertEquals(EventRecovery.FullState, planEventRecovery(2, null, false, true))
    }

    @Test fun `retry uses bounded exponential jitter and stops permanent failures`() {
        val policy = RemoteRetryPolicy(random = Random(1))
        val values = (0..20).mapNotNull { policy.delay(it, 0, RemoteFailure(RemoteFailureSource.RELAY, "timeout", true)) }
        assertTrue(values.all { it in 0..30_000 }); assertTrue(values.zipWithNext().take(4).all { it.second >= it.first / 2 })
        assertNull(policy.delay(1, 0, RemoteFailure(RemoteFailureSource.BUSINESS, "permission_denied", false)))
        assertNull(policy.delay(1, 120_000, RemoteFailure(RemoteFailureSource.RELAY, "timeout", true)))
    }

    @Test fun `ten thousand events remain bounded`() {
        val buffer = BoundedRemoteEventBuffer<Int>(512)
        repeat(10_000, buffer::add)
        assertEquals(512, buffer.size); assertEquals(9_488, buffer.snapshot().first()); assertEquals(9_999, buffer.snapshot().last())
    }
}
