package ai.drsai.remote.remote.data

enum class RemotePairingStage { IDLE, SCANNING, CONNECTING, COMPLETE, FAILED }

data class RemotePairingJourneyState(
    val stage: RemotePairingStage = RemotePairingStage.IDLE,
    val recoveryAction: RemoteRecoveryAction = RemoteRecoveryAction.NONE,
)

sealed interface RemotePairingJourneyEvent {
    data object ScanStarted : RemotePairingJourneyEvent
    data object PayloadAccepted : RemotePairingJourneyEvent
    data object Connected : RemotePairingJourneyEvent
    data class Failed(val recoveryAction: RemoteRecoveryAction) : RemotePairingJourneyEvent
    data object Cancelled : RemotePairingJourneyEvent
}

class RemotePairingJourneyReducer {
    fun reduce(state: RemotePairingJourneyState, event: RemotePairingJourneyEvent): RemotePairingJourneyState = when (event) {
        RemotePairingJourneyEvent.ScanStarted -> RemotePairingJourneyState(RemotePairingStage.SCANNING)
        RemotePairingJourneyEvent.PayloadAccepted -> {
            require(state.stage == RemotePairingStage.SCANNING || state.stage == RemotePairingStage.FAILED) {
                "remote_pairing_payload_without_scan"
            }
            RemotePairingJourneyState(RemotePairingStage.CONNECTING)
        }
        RemotePairingJourneyEvent.Connected -> {
            require(state.stage == RemotePairingStage.CONNECTING) { "remote_pairing_connected_without_request" }
            RemotePairingJourneyState(RemotePairingStage.COMPLETE)
        }
        is RemotePairingJourneyEvent.Failed -> {
            require(state.stage == RemotePairingStage.SCANNING || state.stage == RemotePairingStage.CONNECTING) {
                "remote_pairing_failure_without_attempt"
            }
            RemotePairingJourneyState(RemotePairingStage.FAILED, event.recoveryAction)
        }
        RemotePairingJourneyEvent.Cancelled -> RemotePairingJourneyState()
    }
}
