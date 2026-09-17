package ai.drsai.remote.runtime.coordinator

data class HandoffContinuityEvent(
    val eventId: String,
    val handoffId: String,
    val sessionId: String,
    val sourceRunId: String,
    val targetRunId: String? = null,
    val messageId: String? = null,
    val artifactId: String? = null,
    val approvalId: String? = null,
    val approvalDecision: String? = null,
    val sideEffectReceiptId: String? = null,
)

data class HandoffContinuityState(
    val handoffId: String? = null,
    val sessionId: String? = null,
    val sourceRunId: String? = null,
    val targetRunId: String? = null,
    val messageIds: Set<String> = emptySet(),
    val artifactIds: Set<String> = emptySet(),
    val approvalDecisions: Map<String, String> = emptyMap(),
    val sideEffectReceiptIds: Set<String> = emptySet(),
    val seenEventIds: Set<String> = emptySet(),
)

object DesktopHandoffContinuityReducer {
    fun reduce(state: HandoffContinuityState, event: HandoffContinuityEvent): HandoffContinuityState {
        if (event.eventId in state.seenEventIds) return state
        require(event.handoffId.isNotBlank() && event.sessionId.isNotBlank() && event.sourceRunId.isNotBlank()) {
            "handoff_continuity_identity_required"
        }
        state.handoffId?.let { require(it == event.handoffId) { "handoff_continuity_handoff_mismatch" } }
        state.sessionId?.let { require(it == event.sessionId) { "handoff_continuity_session_mismatch" } }
        state.sourceRunId?.let { require(it == event.sourceRunId) { "handoff_continuity_source_run_mismatch" } }
        state.targetRunId?.let { existing -> event.targetRunId?.let { require(it == existing) { "handoff_continuity_target_run_mismatch" } } }
        val decisions = if (event.approvalId != null && event.approvalDecision != null) {
            if (event.approvalId in state.approvalDecisions) state.approvalDecisions
            else state.approvalDecisions + (event.approvalId to event.approvalDecision)
        } else state.approvalDecisions
        return state.copy(
            handoffId = event.handoffId,
            sessionId = event.sessionId,
            sourceRunId = event.sourceRunId,
            targetRunId = state.targetRunId ?: event.targetRunId,
            messageIds = state.messageIds + listOfNotNull(event.messageId),
            artifactIds = state.artifactIds + listOfNotNull(event.artifactId),
            approvalDecisions = decisions,
            sideEffectReceiptIds = state.sideEffectReceiptIds + listOfNotNull(event.sideEffectReceiptId),
            seenEventIds = state.seenEventIds + event.eventId,
        )
    }
}
