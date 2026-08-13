package ai.drsai.remote.remote.data

enum class SessionSyncPhase { STOPPED, CONNECTING, STREAMING, OFFLINE, AUTH_REQUIRED, REVOKED }

data class SessionSyncState(
    val foreground: Boolean = true,
    val online: Boolean = true,
    val phase: SessionSyncPhase = SessionSyncPhase.STOPPED,
    val generation: Long = 0,
) {
    val shouldSubscribe: Boolean
        get() = foreground && online && phase !in setOf(
            SessionSyncPhase.AUTH_REQUIRED, SessionSyncPhase.REVOKED,
        )
}

sealed interface SessionSyncEvent {
    data object Foreground : SessionSyncEvent
    data object Background : SessionSyncEvent
    data class Network(val online: Boolean) : SessionSyncEvent
    data object Connecting : SessionSyncEvent
    data object Streaming : SessionSyncEvent
    data object AuthenticationRequired : SessionSyncEvent
    data object Revoked : SessionSyncEvent
}

class SessionSyncStateMachine(initial: SessionSyncState = SessionSyncState()) {
    var state: SessionSyncState = initial
        private set

    fun accept(event: SessionSyncEvent): SessionSyncState {
        val current = state
        state = when (event) {
            SessionSyncEvent.Foreground -> current.copy(foreground = true, generation = current.generation + 1)
            SessionSyncEvent.Background -> current.copy(
                foreground = false,
                phase = if (current.phase in setOf(
                        SessionSyncPhase.AUTH_REQUIRED, SessionSyncPhase.REVOKED,
                    )) current.phase else SessionSyncPhase.STOPPED,
            )
            is SessionSyncEvent.Network -> current.copy(
                online = event.online,
                phase = when (current.phase) {
                    SessionSyncPhase.AUTH_REQUIRED, SessionSyncPhase.REVOKED -> current.phase
                    else -> if (event.online) SessionSyncPhase.CONNECTING else SessionSyncPhase.OFFLINE
                },
                generation = current.generation + 1,
            )
            SessionSyncEvent.Connecting -> {
                require(current.foreground && current.online) { "session_sync_connect_while_inactive" }
                current.copy(phase = SessionSyncPhase.CONNECTING)
            }
            SessionSyncEvent.Streaming -> {
                require(current.foreground && current.online) { "session_sync_stream_while_inactive" }
                current.copy(phase = SessionSyncPhase.STREAMING)
            }
            SessionSyncEvent.AuthenticationRequired -> current.copy(phase = SessionSyncPhase.AUTH_REQUIRED)
            SessionSyncEvent.Revoked -> current.copy(phase = SessionSyncPhase.REVOKED)
        }
        return state
    }
}

enum class SessionProjectionDecision { APPLY, DUPLICATE, GAP }

class SessionProjectionStateMachine(initialSequence: Long = 0) {
    var sequence: Long = initialSequence
        private set

    fun reset(authoritativeSequence: Long) {
        require(authoritativeSequence >= sequence) { "session_projection_cursor_regression" }
        sequence = authoritativeSequence
    }

    fun observe(incoming: Long): SessionProjectionDecision {
        require(incoming >= 1) { "session_projection_sequence_invalid" }
        return when {
            incoming <= sequence -> SessionProjectionDecision.DUPLICATE
            incoming == sequence + 1 -> SessionProjectionDecision.APPLY.also { sequence = incoming }
            else -> SessionProjectionDecision.GAP
        }
    }
}

class SessionRunControlStateMachine {
    var state: RemoteRunControlState = RemoteRunControlState.IDLE
        private set

    fun begin(operation: RemoteRunControlOperation): RemoteRunControlState {
        require(state == RemoteRunControlState.IDLE) { "session_run_control_busy" }
        state = if (operation == RemoteRunControlOperation.CANCEL) {
            RemoteRunControlState.CANCELLING
        } else RemoteRunControlState.RETRYING
        return state
    }

    fun reconcile(): RemoteRunControlState {
        require(state == RemoteRunControlState.IDLE) { "session_run_control_busy" }
        state = RemoteRunControlState.RECONCILING
        return state
    }

    fun settled(): RemoteRunControlState {
        state = RemoteRunControlState.IDLE
        return state
    }
}

class SessionApprovalStateMachine(initial: RemoteApprovalDecisionState = RemoteApprovalDecisionState.PENDING) {
    var state: RemoteApprovalDecisionState = initial
        private set

    fun begin(): RemoteApprovalDecisionState {
        require(state == RemoteApprovalDecisionState.PENDING) { "session_approval_not_pending" }
        state = RemoteApprovalDecisionState.DECIDING
        return state
    }

    fun settle(status: String?): RemoteApprovalDecisionState {
        state = convergeApprovalDecision(state, approvalDecisionState(status))
        return state
    }

    fun restore(value: RemoteApprovalDecisionState): RemoteApprovalDecisionState {
        state = convergeApprovalDecision(state, value)
        return state
    }

    private fun convergeApprovalDecision(
        current: RemoteApprovalDecisionState,
        incoming: RemoteApprovalDecisionState?,
    ): RemoteApprovalDecisionState {
        val terminal = setOf(
            RemoteApprovalDecisionState.APPROVED,
            RemoteApprovalDecisionState.DENIED,
            RemoteApprovalDecisionState.CANCELLED,
            RemoteApprovalDecisionState.EXPIRED,
        )
        if (current in terminal) return current
        return incoming ?: if (current == RemoteApprovalDecisionState.DECIDING) {
            RemoteApprovalDecisionState.PENDING
        } else current
    }
}

data class SessionDraftState(val text: String = "", val revision: Long = 0, val persistedRevision: Long = 0) {
    val dirty: Boolean get() = revision != persistedRevision
}

class SessionDraftStateMachine(initial: SessionDraftState = SessionDraftState()) {
    var state: SessionDraftState = initial
        private set

    fun restore(text: String): SessionDraftState {
        state = SessionDraftState(text = text)
        return state
    }

    fun edit(text: String): SessionDraftState {
        state = state.copy(text = text, revision = state.revision + 1)
        return state
    }

    fun persisted(revision: Long): SessionDraftState {
        if (revision == state.revision) state = state.copy(persistedRevision = revision)
        return state
    }

    fun clear(): SessionDraftState {
        state = SessionDraftState(revision = state.revision + 1, persistedRevision = state.revision + 1)
        return state
    }
}
