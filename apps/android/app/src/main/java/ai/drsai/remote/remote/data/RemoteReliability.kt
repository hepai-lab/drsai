package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import java.util.ArrayDeque
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

enum class RemoteFailureSource { RELAY, RUNTIME, BUSINESS }
data class RemoteFailure(val source: RemoteFailureSource, val code: String, val retryable: Boolean)

data class RemoteNetworkState(
    val online: Boolean,
    val metered: Boolean,
    /** Increments whenever the default transport or its usability changes. */
    val generation: Long,
)

class RemoteNetworkGenerationTracker(
    initialIdentity: String?,
    initialOnline: Boolean,
    initialMetered: Boolean,
) {
    private var identity = initialIdentity
    var state = RemoteNetworkState(initialOnline, initialMetered, 0L)
        private set

    @Synchronized
    fun observe(identity: String?, online: Boolean, metered: Boolean): RemoteNetworkState {
        val changed = identity != this.identity || online != state.online || metered != state.metered
        this.identity = identity
        state = RemoteNetworkState(online, metered, state.generation + if (changed) 1L else 0L)
        return state
    }
}

enum class RemoteLifecycleState {
    IDLE, LOADING, ONLINE, STALE, OFFLINE, AUTH_REQUIRED, REVOKED, INCOMPATIBLE,
}

private val REMOTE_LIFECYCLE_TRANSITIONS = mapOf(
    RemoteLifecycleState.IDLE to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.OFFLINE,
        RemoteLifecycleState.AUTH_REQUIRED, RemoteLifecycleState.REVOKED, RemoteLifecycleState.INCOMPATIBLE),
    RemoteLifecycleState.LOADING to setOf(RemoteLifecycleState.ONLINE, RemoteLifecycleState.STALE,
        RemoteLifecycleState.OFFLINE, RemoteLifecycleState.AUTH_REQUIRED, RemoteLifecycleState.REVOKED,
        RemoteLifecycleState.INCOMPATIBLE),
    RemoteLifecycleState.ONLINE to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.STALE,
        RemoteLifecycleState.OFFLINE, RemoteLifecycleState.AUTH_REQUIRED, RemoteLifecycleState.REVOKED,
        RemoteLifecycleState.INCOMPATIBLE),
    RemoteLifecycleState.STALE to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.ONLINE,
        RemoteLifecycleState.OFFLINE, RemoteLifecycleState.AUTH_REQUIRED, RemoteLifecycleState.REVOKED,
        RemoteLifecycleState.INCOMPATIBLE),
    RemoteLifecycleState.OFFLINE to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.AUTH_REQUIRED,
        RemoteLifecycleState.REVOKED),
    RemoteLifecycleState.AUTH_REQUIRED to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.REVOKED),
    RemoteLifecycleState.REVOKED to setOf(RemoteLifecycleState.IDLE),
    RemoteLifecycleState.INCOMPATIBLE to setOf(RemoteLifecycleState.LOADING, RemoteLifecycleState.REVOKED),
)

fun canTransitionRemoteLifecycle(from: RemoteLifecycleState, to: RemoteLifecycleState): Boolean =
    from == to || to in REMOTE_LIFECYCLE_TRANSITIONS.getValue(from)

fun remoteLifecycleState(connection: RemoteConnectionState, hasCachedContent: Boolean = false): RemoteLifecycleState = when (connection) {
    RemoteConnectionState.CONNECTING -> RemoteLifecycleState.LOADING
    RemoteConnectionState.ONLINE -> RemoteLifecycleState.ONLINE
    RemoteConnectionState.DEGRADED -> if (hasCachedContent) RemoteLifecycleState.STALE else RemoteLifecycleState.OFFLINE
    RemoteConnectionState.OFFLINE -> if (hasCachedContent) RemoteLifecycleState.STALE else RemoteLifecycleState.OFFLINE
    RemoteConnectionState.PAUSED -> RemoteLifecycleState.OFFLINE
    RemoteConnectionState.AUTH_REQUIRED -> RemoteLifecycleState.AUTH_REQUIRED
    RemoteConnectionState.INCOMPATIBLE -> RemoteLifecycleState.INCOMPATIBLE
}

class RemoteConnectionStateMachine(initial: RemoteLifecycleState = RemoteLifecycleState.IDLE) {
    var state: RemoteLifecycleState = initial
        private set
    var lastFailure: RemoteFailure? = null
        private set

    fun transition(next: RemoteLifecycleState, failure: RemoteFailure? = null) {
        if (next == state) return
        require(canTransitionRemoteLifecycle(state, next)) {
            "remote_lifecycle_transition_invalid:${state.name.lowercase()}:${next.name.lowercase()}"
        }
        if (next == RemoteLifecycleState.AUTH_REQUIRED) require(failure?.source == RemoteFailureSource.RELAY)
        state = next
        lastFailure = failure
    }

    fun connected(compatible: Boolean = true) = transition(
        if (compatible) RemoteLifecycleState.ONLINE else RemoteLifecycleState.INCOMPATIBLE,
    )
    fun degraded(failure: RemoteFailure) = transition(RemoteLifecycleState.STALE, failure)
    fun disconnected() = transition(RemoteLifecycleState.OFFLINE)
    fun authenticationRequired(failure: RemoteFailure) = transition(RemoteLifecycleState.AUTH_REQUIRED, failure)
    fun revoked(failure: RemoteFailure) = transition(RemoteLifecycleState.REVOKED, failure)
    fun connecting() = transition(RemoteLifecycleState.LOADING)
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

/** Shared bounded retry state for every foreground remote SSE consumer. */
class RemoteStreamRetryState(
    private val policy: RemoteRetryPolicy = RemoteRetryPolicy(),
) {
    private var attempt = 0
    private var windowStartedNanos = 0L

    fun reset() {
        attempt = 0
        windowStartedNanos = 0L
    }

    fun nextDelay(failure: Throwable, nowNanos: Long): Long? {
        val normalized = remoteStreamFailure(failure) ?: return null
        if (windowStartedNanos == 0L) windowStartedNanos = nowNanos
        val elapsedMillis = ((nowNanos - windowStartedNanos).coerceAtLeast(0L) / 1_000_000L)
        return policy.delay(attempt++, elapsedMillis, normalized)
    }
}

fun remoteStreamFailure(failure: Throwable): RemoteFailure? = when (failure) {
    is RelayHttpException -> RemoteFailure(
        RemoteFailureSource.RELAY,
        failure.errorCode ?: "http_${failure.status}",
        failure.retryable || failure.status == 408 || failure.status == 429 || failure.status >= 500,
    )
    is java.io.IOException -> RemoteFailure(RemoteFailureSource.RELAY, "network_unavailable", true)
    else -> null
}

class BoundedRemoteEventBuffer<T>(private val capacity: Int = 512) {
    private val values = ArrayDeque<T>(capacity)
    fun add(value: T) { if (values.size == capacity) values.removeFirst(); values.addLast(value) }
    fun snapshot(): List<T> = values.toList()
    val size: Int get() = values.size
}

data class RemoteDeltaChunk(val streamId: String, val text: String)

/**
 * Single-consumer, latest-value mailbox for frame-coalesced projections.
 *
 * [offer] returns true exactly when the caller must start a worker. Values
 * offered while that worker is rendering replace the pending value, and
 * [finishCycle] keeps the same worker alive when another value arrived during
 * the render. This closes the race where a late delta could be persisted after
 * the current Room query but then lose its only scheduled UI refresh.
 */
class LatestFrameMailbox<T : Any> {
    private var pending: T? = null
    private var workerActive = false

    @Synchronized
    fun offer(value: T): Boolean {
        pending = value
        if (workerActive) return false
        workerActive = true
        return true
    }

    @Synchronized
    fun take(): T? = pending.also { pending = null }

    /** Returns true when this worker owns a clean transition to idle. */
    @Synchronized
    fun finishCycle(): Boolean {
        if (pending != null) return false
        workerActive = false
        return true
    }

    @Synchronized
    fun cancel() {
        pending = null
        workerActive = false
    }

    @Synchronized
    fun hasPending(): Boolean = pending != null
}

enum class RemoteDownloadDecision { ALLOW, REQUIRE_CONFIRMATION, REJECT_TOO_LARGE }

class RemoteNetworkPolicy(
    private val meteredConfirmationBytes: Long = 10L * 1024 * 1024,
    private val absoluteMaximumBytes: Long = 256L * 1024 * 1024,
) {
    init {
        require(meteredConfirmationBytes >= 0 && absoluteMaximumBytes >= meteredConfirmationBytes) {
            "remote_network_policy_invalid"
        }
    }

    fun download(sizeBytes: Long, metered: Boolean, userConfirmed: Boolean = false): RemoteDownloadDecision = when {
        sizeBytes < 0 || sizeBytes > absoluteMaximumBytes -> RemoteDownloadDecision.REJECT_TOO_LARGE
        metered && sizeBytes >= meteredConfirmationBytes && !userConfirmed -> RemoteDownloadDecision.REQUIRE_CONFIRMATION
        else -> RemoteDownloadDecision.ALLOW
    }
}

/**
 * Coalesces high-frequency text deltas before they reach Compose. The byte-like
 * character threshold is deliberately small: crossing it forces a drain instead
 * of dropping content, while control/terminal events can call [drain] as a barrier.
 */
class RemoteDeltaFrameBuffer(private val maxPendingChars: Int = 32 * 1024) {
    private val pending = linkedMapOf<String, StringBuilder>()
    private var pendingChars = 0

    init { require(maxPendingChars > 0) { "remote_delta_capacity_invalid" } }

    @Synchronized
    fun offer(streamId: String, delta: String): List<RemoteDeltaChunk> {
        require(streamId.isNotBlank()) { "remote_delta_stream_required" }
        if (delta.isEmpty()) return emptyList()
        pending.getOrPut(streamId, ::StringBuilder).append(delta)
        pendingChars += delta.length
        return if (pendingChars >= maxPendingChars) drainLocked() else emptyList()
    }

    @Synchronized
    fun drain(): List<RemoteDeltaChunk> = drainLocked()

    @Synchronized
    fun sizeChars(): Int = pendingChars

    private fun drainLocked(): List<RemoteDeltaChunk> {
        if (pendingChars == 0) return emptyList()
        val result = pending.map { (streamId, text) -> RemoteDeltaChunk(streamId, text.toString()) }
        pending.clear()
        pendingChars = 0
        return result
    }
}

class RemoteCommandGuard {
    private val submitted = mutableSetOf<String>()
    fun firstSubmission(idempotencyKey: String): Boolean = submitted.add(idempotencyKey)
}
