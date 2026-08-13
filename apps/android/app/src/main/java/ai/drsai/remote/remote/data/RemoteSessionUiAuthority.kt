package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteRunStatus

data class RemoteSessionUiAuthorityState(
    val generation: Long = 0,
    val connectionState: RemoteConnectionState = RemoteConnectionState.ONLINE,
    val lifecycleState: RemoteLifecycleState = RemoteLifecycleState.ONLINE,
    val runStatus: RemoteRunStatus? = null,
) {
    val online: Boolean get() = connectionState == RemoteConnectionState.ONLINE
    val running: Boolean get() = runStatus in setOf(
        RemoteRunStatus.QUEUED, RemoteRunStatus.RUNNING, RemoteRunStatus.WAITING_APPROVAL,
    )
    val canRetry: Boolean get() = runStatus in setOf(RemoteRunStatus.FAILED, RemoteRunStatus.CANCELLED)

    init {
        require(!(running && canRetry)) { "remote_session_ui_run_state_conflict" }
        require(lifecycleState == remoteLifecycleState(connectionState, lifecycleState == RemoteLifecycleState.STALE)) {
            "remote_session_ui_lifecycle_conflict"
        }
    }
}

sealed interface RemoteSessionUiAuthorityEvent {
    val generation: Long

    data class Connection(
        override val generation: Long,
        val state: RemoteConnectionState,
        val hasCachedContent: Boolean,
    ) : RemoteSessionUiAuthorityEvent

    data class Run(
        override val generation: Long,
        val status: RemoteRunStatus?,
    ) : RemoteSessionUiAuthorityEvent

    data class Snapshot(
        override val generation: Long,
        val connection: RemoteConnectionState,
        val hasCachedContent: Boolean,
        val runStatus: RemoteRunStatus?,
    ) : RemoteSessionUiAuthorityEvent
}

class RemoteSessionUiAuthorityReducer(initial: RemoteSessionUiAuthorityState = RemoteSessionUiAuthorityState()) {
    var state: RemoteSessionUiAuthorityState = initial
        private set

    @Synchronized
    fun accept(event: RemoteSessionUiAuthorityEvent): RemoteSessionUiAuthorityState {
        if (event.generation < state.generation) return state
        state = when (event) {
            is RemoteSessionUiAuthorityEvent.Connection -> state.copy(
                generation = event.generation,
                connectionState = event.state,
                lifecycleState = remoteLifecycleState(event.state, event.hasCachedContent),
            )
            is RemoteSessionUiAuthorityEvent.Run -> state.copy(
                generation = event.generation,
                runStatus = event.status,
            )
            is RemoteSessionUiAuthorityEvent.Snapshot -> RemoteSessionUiAuthorityState(
                generation = event.generation,
                connectionState = event.connection,
                lifecycleState = remoteLifecycleState(event.connection, event.hasCachedContent),
                runStatus = event.runStatus,
            )
        }
        return state
    }
}
