package ai.drsai.remote.remote.data

import java.util.UUID

data class FirstScreenSloObservation(
    val sampleId: String,
    val cacheLoadAtMs: Long,
    val authorityRefreshAtMs: Long,
    val firstRenderAtMs: Long,
)

data class OperationConfirmationSloObservation(
    val sampleId: String,
    val requestDispatchAtMs: Long,
    val runtimeCommitAtMs: Long,
    val confirmationRenderAtMs: Long,
)

data class ReconnectSloObservation(
    val sampleId: String,
    val disconnectDetectAtMs: Long,
    val transportRestoreAtMs: Long,
    val replayCatchupAtMs: Long,
)

/**
 * Process-local, bounded and content-free user-journey clock.
 *
 * Resource IDs, user text and device identity are deliberately excluded. The
 * caller supplies an opaque operation handle only to match its own dispatch
 * and commit callbacks; that handle never leaves this object.
 */
class RemoteUserSloTracker(
    private val capacity: Int = 64,
    private val clockMs: () -> Long = System::currentTimeMillis,
    private val sampleId: () -> String = { "sample-${UUID.randomUUID()}" },
) {
    private data class First(var cache: Long, var authority: Long? = null)
    private data class Operation(val sample: String, val dispatch: Long, var commit: Long? = null)
    private data class Reconnect(val sample: String, val disconnect: Long, var transport: Long? = null)

    private val lock = Any()
    private var first: Pair<String, First>? = null
    private val operations = LinkedHashMap<String, Operation>()
    private var reconnect: Reconnect? = null

    init {
        require(capacity in 1..256) { "user_slo_tracker_capacity_invalid" }
    }

    private fun nowAtLeast(previous: Long = 0): Long = clockMs().coerceAtLeast(0).coerceAtLeast(previous)

    fun cacheLoaded() = synchronized(lock) {
        if (first == null) first = sampleId() to First(nowAtLeast())
    }

    fun authorityRefreshed() = synchronized(lock) {
        first?.second?.let { state -> state.authority = nowAtLeast(state.cache) }
    }

    fun firstRendered(): FirstScreenSloObservation? = synchronized(lock) {
        val (sample, state) = first ?: return@synchronized null
        val authority = state.authority ?: return@synchronized null
        first = null
        FirstScreenSloObservation(sample, state.cache, authority, nowAtLeast(authority))
    }

    fun operationDispatched(handle: String) = synchronized(lock) {
        require(handle.isNotBlank()) { "user_slo_operation_handle_invalid" }
        operations.putIfAbsent(handle, Operation(sampleId(), nowAtLeast()))
        while (operations.size > capacity) operations.remove(operations.keys.first())
    }

    fun operationCommitted(handle: String) = synchronized(lock) {
        operations[handle]?.let { operation ->
            operation.commit = nowAtLeast(operation.dispatch)
        }
    }

    fun operationsRendered(): List<OperationConfirmationSloObservation> = synchronized(lock) {
        val completed = operations.entries.mapNotNull { (handle, operation) ->
            val commit = operation.commit ?: return@mapNotNull null
            handle to OperationConfirmationSloObservation(
                operation.sample, operation.dispatch, commit, nowAtLeast(commit),
            )
        }
        completed.forEach { operations.remove(it.first) }
        completed.map { it.second }
    }

    fun disconnected() = synchronized(lock) {
        if (reconnect == null) reconnect = Reconnect(sampleId(), nowAtLeast())
    }

    fun transportRestored() = synchronized(lock) {
        reconnect?.let { state -> state.transport = nowAtLeast(state.disconnect) }
    }

    fun replayCaughtUp(): ReconnectSloObservation? = synchronized(lock) {
        val state = reconnect ?: return@synchronized null
        val transport = state.transport ?: return@synchronized null
        reconnect = null
        ReconnectSloObservation(
            state.sample, state.disconnect, transport, nowAtLeast(transport),
        )
    }

    fun pendingOperationCount(): Int = synchronized(lock) { operations.size }
}
