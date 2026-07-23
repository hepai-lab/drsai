package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import java.util.ArrayDeque
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

enum class RemoteFailureSource { RELAY, RUNTIME, BUSINESS }
data class RemoteFailure(val source: RemoteFailureSource, val code: String, val retryable: Boolean)

class RemoteConnectionStateMachine(initial: RemoteConnectionState = RemoteConnectionState.CONNECTING) {
    var state: RemoteConnectionState = initial
        private set
    var lastFailure: RemoteFailure? = null
        private set

    fun connected(compatible: Boolean = true) { state = if (compatible) RemoteConnectionState.ONLINE else RemoteConnectionState.INCOMPATIBLE; lastFailure = null }
    fun degraded(failure: RemoteFailure) { state = RemoteConnectionState.DEGRADED; lastFailure = failure }
    fun disconnected() { state = RemoteConnectionState.OFFLINE }
    fun authenticationRequired(failure: RemoteFailure) { require(failure.source == RemoteFailureSource.RELAY); state = RemoteConnectionState.AUTH_REQUIRED; lastFailure = failure }
    fun connecting() { state = RemoteConnectionState.CONNECTING }
}

enum class ResumeAction { NONE, REBUILD_TRANSPORT, QUERY_STATUS_THEN_RESUME_EVENTS, FULL_STATE_RECOVERY }

class RemoteLifecycleCoordinator {
    var foreground: Boolean = true
        private set
    var transportGeneration: Long = 0
        private set
    var lastSequence: Long = 0
        private set
    fun eventCommitted(sequence: Long) { require(sequence == lastSequence + 1); lastSequence = sequence }
    fun background(): ResumeAction { foreground = false; return ResumeAction.NONE }
    fun foreground(): ResumeAction { foreground = true; return ResumeAction.QUERY_STATUS_THEN_RESUME_EVENTS }
    fun networkChanged(): ResumeAction { transportGeneration += 1; return ResumeAction.REBUILD_TRANSPORT }
}

data class InstanceChange(val changed: Boolean, val action: ResumeAction)
class RuntimeInstanceTracker {
    private val instances = mutableMapOf<String, Pair<String, Long>>()
    fun observe(runtimeId: String, instanceId: String, generation: Long): InstanceChange {
        val previous = instances.put(runtimeId, instanceId to generation)
        val changed = previous != null && previous != instanceId to generation
        return InstanceChange(changed, if (changed) ResumeAction.QUERY_STATUS_THEN_RESUME_EVENTS else ResumeAction.NONE)
    }
}

sealed interface EventRecovery {
    data class Apply(val sequence: Long) : EventRecovery
    data object Duplicate : EventRecovery
    data class FetchGap(val afterSequence: Long) : EventRecovery
    data object FullState : EventRecovery
}
fun planEventRecovery(lastSequence: Long, incoming: Long?, cursorExpired: Boolean, historyTruncated: Boolean): EventRecovery = when {
    cursorExpired || historyTruncated -> EventRecovery.FullState
    incoming == null -> EventRecovery.FetchGap(lastSequence)
    incoming <= lastSequence -> EventRecovery.Duplicate
    incoming == lastSequence + 1 -> EventRecovery.Apply(incoming)
    else -> EventRecovery.FetchGap(lastSequence)
}

class RemoteRetryPolicy(private val baseMs: Long = 500, private val maxDelayMs: Long = 30_000,
                        private val maxWindowMs: Long = 120_000, private val random: Random = Random.Default) {
    fun delay(attempt: Int, elapsedMs: Long, failure: RemoteFailure): Long? {
        if (!failure.retryable || failure.code in setOf("auth_required", "permission_denied", "protocol_incompatible") || elapsedMs >= maxWindowMs) return null
        val exponential = min(maxDelayMs.toDouble(), baseMs * 2.0.pow(attempt.coerceAtMost(20))).toLong()
        return (exponential * (0.75 + random.nextDouble() * 0.5)).toLong().coerceAtMost(maxDelayMs)
    }
}

class BoundedRemoteEventBuffer<T>(private val capacity: Int = 512) {
    private val values = ArrayDeque<T>(capacity)
    fun add(value: T) { if (values.size == capacity) values.removeFirst(); values.addLast(value) }
    fun snapshot(): List<T> = values.toList()
    val size: Int get() = values.size
}

class RemoteCommandGuard {
    private val submitted = mutableSetOf<String>()
    fun firstSubmission(idempotencyKey: String): Boolean = submitted.add(idempotencyKey)
}
