package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.RemoteConnectionState
import org.junit.Assert.*
import org.junit.Test
import kotlin.random.Random

class RemoteReliabilityTest {
    @Test fun `state machine distinguishes transport runtime and business errors`() {
        val machine = RemoteConnectionStateMachine()
        machine.connecting(); machine.connected(); assertEquals(RemoteLifecycleState.ONLINE, machine.state)
        machine.degraded(RemoteFailure(RemoteFailureSource.RUNTIME, "backend_unhealthy", true)); assertEquals(RemoteLifecycleState.STALE, machine.state)
        machine.authenticationRequired(RemoteFailure(RemoteFailureSource.RELAY, "auth_required", false)); assertEquals(RemoteLifecycleState.AUTH_REQUIRED, machine.state)
        machine.connecting(); machine.connected(false); assertEquals(RemoteLifecycleState.INCOMPATIBLE, machine.state)
    }

    @Test fun `lifecycle transition graph rejects every undefined edge`() {
        for (from in RemoteLifecycleState.entries) {
            for (to in RemoteLifecycleState.entries) {
                val machine = RemoteConnectionStateMachine(from)
                if (canTransitionRemoteLifecycle(from, to)) {
                    if (to == RemoteLifecycleState.AUTH_REQUIRED) {
                        machine.transition(to, RemoteFailure(RemoteFailureSource.RELAY, "auth_required", false))
                    } else {
                        machine.transition(to)
                    }
                    assertEquals(to, machine.state)
                } else {
                    assertThrows(IllegalArgumentException::class.java) { machine.transition(to) }
                    assertEquals(from, machine.state)
                }
            }
        }
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

    @Test fun `wifi to cellular rebuilds transport even while still online`() {
        val tracker = RemoteNetworkGenerationTracker("wifi", initialOnline = true, initialMetered = false)
        assertEquals(0L, tracker.state.generation)
        assertEquals(0L, tracker.observe("wifi", online = true, metered = false).generation)
        val cellular = tracker.observe("cellular", online = true, metered = true)
        assertTrue(cellular.online)
        assertTrue(cellular.metered)
        assertEquals(1L, cellular.generation)
        assertEquals(2L, tracker.observe(null, online = false, metered = true).generation)
    }

    @Test fun `stream retry covers eof 429 and 5xx but remains bounded`() {
        val policy = RemoteRetryPolicy(baseMs = 1, maxDelayMs = 8, maxWindowMs = 10, random = Random(2))
        listOf<Throwable>(
            java.io.EOFException("eof"),
            RelayHttpException(429, null, "rate_limited"),
            RelayHttpException(503, null, "runtime_unavailable"),
        ).forEach { failure ->
            val retry = RemoteStreamRetryState(policy)
            assertNotNull(retry.nextDelay(failure, 1_000_000L))
            assertNull(retry.nextDelay(failure, 12_000_000L))
        }
        assertNull(RemoteStreamRetryState(policy).nextDelay(
            RelayHttpException(403, null, "association_revoked"), 1_000_000L,
        ))
    }

    @Test fun `ten thousand events remain bounded`() {
        val buffer = BoundedRemoteEventBuffer<Int>(512)
        repeat(10_000, buffer::add)
        assertEquals(512, buffer.size); assertEquals(9_488, buffer.snapshot().first()); assertEquals(9_999, buffer.snapshot().last())
    }
}
