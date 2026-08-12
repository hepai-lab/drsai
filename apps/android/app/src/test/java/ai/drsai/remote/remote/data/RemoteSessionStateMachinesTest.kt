package ai.drsai.remote.remote.data

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteSessionStateMachinesTest {
    @Test fun sync_interleavings_never_subscribe_when_background_offline_or_denied() {
        val machine = SessionSyncStateMachine()
        val random = Random(260812)
        repeat(10_000) {
            when (random.nextInt(6)) {
                0 -> machine.accept(SessionSyncEvent.Foreground)
                1 -> machine.accept(SessionSyncEvent.Background)
                2 -> machine.accept(SessionSyncEvent.Network(true))
                3 -> machine.accept(SessionSyncEvent.Network(false))
                4 -> machine.accept(SessionSyncEvent.AuthenticationRequired)
                else -> machine.accept(SessionSyncEvent.Revoked)
            }
            val state = machine.state
            if (!state.foreground || !state.online || state.phase in setOf(
                    SessionSyncPhase.AUTH_REQUIRED, SessionSyncPhase.REVOKED,
                )) assertFalse(state.shouldSubscribe)
        }
    }

    @Test fun projection_is_monotonic_and_gap_does_not_advance() {
        val machine = SessionProjectionStateMachine()
        repeat(10_000) { index ->
            val expected = index.toLong() + 1
            assertEquals(SessionProjectionDecision.APPLY, machine.observe(expected))
            assertEquals(SessionProjectionDecision.DUPLICATE, machine.observe(expected))
            assertEquals(expected, machine.sequence)
            assertEquals(SessionProjectionDecision.GAP, machine.observe(expected + 2))
            assertEquals(expected, machine.sequence)
        }
    }

    @Test fun run_and_approval_controls_are_single_flight() {
        val run = SessionRunControlStateMachine()
        assertEquals(RemoteRunControlState.CANCELLING, run.begin(RemoteRunControlOperation.CANCEL))
        assertFails("session_run_control_busy") { run.begin(RemoteRunControlOperation.RETRY) }
        assertEquals(RemoteRunControlState.IDLE, run.settled())
        assertEquals(RemoteRunControlState.RETRYING, run.begin(RemoteRunControlOperation.RETRY))
        val approval = SessionApprovalStateMachine()
        assertEquals(RemoteApprovalDecisionState.DECIDING, approval.begin())
        assertFails("session_approval_not_pending") { approval.begin() }
        assertEquals(RemoteApprovalDecisionState.APPROVED, approval.settle("approved"))
        assertEquals(RemoteApprovalDecisionState.APPROVED, approval.settle("pending"))
        assertEquals(RemoteApprovalDecisionState.APPROVED, approval.restore(RemoteApprovalDecisionState.DENIED))
    }

    @Test fun stale_draft_persistence_cannot_mark_newer_text_clean() {
        val draft = SessionDraftStateMachine()
        draft.restore("before")
        val first = draft.edit("first")
        val second = draft.edit("second")
        draft.persisted(first.revision)
        assertTrue(draft.state.dirty)
        assertEquals("second", draft.state.text)
        draft.persisted(second.revision)
        assertFalse(draft.state.dirty)
        assertEquals("", draft.clear().text)
    }

    private fun assertFails(code: String, action: () -> Unit) {
        try { action() } catch (failure: IllegalArgumentException) {
            assertTrue(failure.message.orEmpty().contains(code)); return
        }
        throw AssertionError("expected $code")
    }
}
