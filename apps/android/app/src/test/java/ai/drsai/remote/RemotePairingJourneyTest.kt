package ai.drsai.remote

import ai.drsai.remote.remote.data.RemotePairingJourneyEvent
import ai.drsai.remote.remote.data.RemotePairingJourneyReducer
import ai.drsai.remote.remote.data.RemotePairingJourneyState
import ai.drsai.remote.remote.data.RemotePairingStage
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import org.junit.Assert.assertEquals
import org.junit.Test

class RemotePairingJourneyTest {
    @Test
    fun `scan connect and complete is one ordered journey`() {
        val reducer = RemotePairingJourneyReducer()
        var state = reducer.reduce(RemotePairingJourneyState(), RemotePairingJourneyEvent.ScanStarted)
        assertEquals(RemotePairingStage.SCANNING, state.stage)
        state = reducer.reduce(state, RemotePairingJourneyEvent.PayloadAccepted)
        assertEquals(RemotePairingStage.CONNECTING, state.stage)
        state = reducer.reduce(state, RemotePairingJourneyEvent.Connected)
        assertEquals(RemotePairingStage.COMPLETE, state.stage)
    }

    @Test
    fun `expired and wrong account failures expose one recovery action`() {
        listOf(RemoteRecoveryAction.REASSOCIATE, RemoteRecoveryAction.SIGN_IN).forEach { action ->
            val reducer = RemotePairingJourneyReducer()
            var state = reducer.reduce(RemotePairingJourneyState(), RemotePairingJourneyEvent.ScanStarted)
            state = reducer.reduce(state, RemotePairingJourneyEvent.PayloadAccepted)
            state = reducer.reduce(state, RemotePairingJourneyEvent.Failed(action))
            assertEquals(RemotePairingStage.FAILED, state.stage)
            assertEquals(action, state.recoveryAction)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `payload without explicit scan fails closed`() {
        RemotePairingJourneyReducer().reduce(
            RemotePairingJourneyState(),
            RemotePairingJourneyEvent.PayloadAccepted,
        )
    }
}
