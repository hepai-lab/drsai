package ai.drsai.remote.remote.data

/**
 * Serializes the REST catch-up path and the live SSE path around one authoritative
 * sequence. The caller owns the UI projection; this class guarantees that it only
 * receives committed, contiguous events.
 */
class RemoteSequenceSynchronizer(
    initialSequence: Long,
    private val fetchPage: suspend (afterSequence: Long) -> Page<RelayStreamEvent>,
    private val commit: suspend (RelayStreamEvent) -> EventDecision,
    private val replaceFromSnapshot: suspend () -> Long,
) {
    var lastSequence: Long = initialSequence
        private set

    suspend fun accept(incoming: RelayStreamEvent): SequenceSyncResult {
        if (incoming.event.sequence <= lastSequence) {
            return commitStale(incoming)
        }
        if (incoming.event.sequence > lastSequence + 1) {
            when (catchUp()) {
                SequenceSyncResult.REBUILT -> {
                    if (incoming.event.sequence <= lastSequence) return SequenceSyncResult.REBUILT
                    if (incoming.event.sequence != lastSequence + 1) return rebuild()
                }
                else -> Unit
            }
        }
        return commitContiguous(incoming)
    }

    suspend fun reconcile(): SequenceSyncResult = catchUp()

    private suspend fun catchUp(): SequenceSyncResult {
        var applied = false
        while (true) {
            val page = try {
                fetchPage(lastSequence)
            } catch (failure: RelayHttpException) {
                if (failure.requiresSnapshotRecovery()) return rebuild()
                throw failure
            }
            if (page.items.isEmpty()) return if (applied) SequenceSyncResult.APPLIED else SequenceSyncResult.IDLE
            for (event in page.items.sortedBy { it.event.sequence }) {
                when {
                    event.event.sequence <= lastSequence -> commitStale(event)
                    event.event.sequence == lastSequence + 1 -> {
                        commitContiguous(event)
                        applied = true
                    }
                    else -> return rebuild()
                }
            }
            if (page.nextCursor == null) return if (applied) SequenceSyncResult.APPLIED else SequenceSyncResult.IDLE
        }
    }

    private suspend fun commitContiguous(event: RelayStreamEvent): SequenceSyncResult =
        when (commit(event)) {
            EventDecision.APPLY -> {
                lastSequence = event.event.sequence
                SequenceSyncResult.APPLIED
            }
            // At this point the event sequence is exactly lastSequence + 1.
            // DUPLICATE therefore means an event-id collision, while
            // OUT_OF_ORDER means the durable cursor and this synchronizer
            // disagree. Neither condition may advance the cursor.
            EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER, EventDecision.GAP -> rebuild()
            EventDecision.CROSS_SCOPE -> error("remote_event_scope_mismatch")
        }

    private suspend fun commitStale(event: RelayStreamEvent): SequenceSyncResult =
        when (commit(event)) {
            EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> SequenceSyncResult.DUPLICATE
            EventDecision.CROSS_SCOPE -> error("remote_event_scope_mismatch")
            EventDecision.GAP -> rebuild()
            EventDecision.APPLY -> error("remote_event_cursor_inconsistent")
        }

    private suspend fun rebuild(): SequenceSyncResult {
        lastSequence = replaceFromSnapshot()
        return SequenceSyncResult.REBUILT
    }
}

enum class SequenceSyncResult { IDLE, APPLIED, DUPLICATE, REBUILT }

fun RelayHttpException.requiresSnapshotRecovery(): Boolean =
    errorCode in setOf("cursor_expired", "history_truncated")

fun Throwable.requiresAuthentication(): Boolean =
    this is RelayHttpException &&
        (status == 401 || errorCode in setOf("token_expired", "invalid_token", "oidc_auth_invalid"))
