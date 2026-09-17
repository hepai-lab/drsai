package ai.drsai.remote.runtime.reliability

enum class RunNetworkKind { WIFI, CELLULAR, OFFLINE, RESTRICTED }
enum class NetworkRunPhase { ONLINE, WAITING_NETWORK, RUNTIME_FAILED }

data class NetworkRunSnapshot(
    val runId: String,
    val completedSequence: Long,
    val network: RunNetworkKind,
    val phase: NetworkRunPhase,
    val reconnectAttempt: Int,
    val nextReconnectAtMillis: Long?,
    val userMessage: String,
)

/** Preserves the durable cursor and bounds reconnect work across network changes. */
class NetworkRunContinuity(
    private val runId: String,
    completedSequence: Long,
    private val maxReconnectAttempts: Int = 5,
    private val maxReconnectWindowMillis: Long = 120_000,
    private val baseDelayMillis: Long = 1_000,
    private val strings: NetworkRunStrings = EnglishNetworkRunStrings,
) {
    init {
        require(runId.isNotBlank() && completedSequence >= 0) { "network_run_scope_invalid" }
        require(maxReconnectAttempts > 0 && maxReconnectWindowMillis > 0 && baseDelayMillis > 0)
    }

    private var cursor = completedSequence
    private var attempts = 0
    private var disconnectedAt: Long? = null

    fun observe(network: RunNetworkKind, nowMillis: Long, completedSequence: Long = cursor): NetworkRunSnapshot {
        require(completedSequence >= cursor) { "network_completed_sequence_regressed" }
        cursor = completedSequence
        if (network in setOf(RunNetworkKind.OFFLINE, RunNetworkKind.RESTRICTED)) {
            if (disconnectedAt == null) disconnectedAt = nowMillis
            return snapshot(network, NetworkRunPhase.WAITING_NETWORK, null,
                strings.text(if (network == RunNetworkKind.RESTRICTED) NetworkRunText.RESTRICTED else NetworkRunText.OFFLINE))
        }
        val disconnected = disconnectedAt
        if (disconnected == null) return snapshot(network, NetworkRunPhase.ONLINE, null, strings.text(NetworkRunText.ONLINE))
        val elapsed = (nowMillis - disconnected).coerceAtLeast(0)
        if (attempts >= maxReconnectAttempts || elapsed >= maxReconnectWindowMillis) {
            return snapshot(network, NetworkRunPhase.RUNTIME_FAILED, null, strings.text(NetworkRunText.RUNTIME_FAILED))
        }
        val delay = (baseDelayMillis * (1L shl attempts.coerceAtMost(10))).coerceAtMost(30_000)
        attempts += 1
        return snapshot(network, NetworkRunPhase.WAITING_NETWORK, nowMillis + delay, strings.text(NetworkRunText.RECONNECTING))
    }

    fun reconnected(network: RunNetworkKind, completedSequence: Long): NetworkRunSnapshot {
        require(network in setOf(RunNetworkKind.WIFI, RunNetworkKind.CELLULAR)) { "network_reconnect_transport_invalid" }
        require(completedSequence >= cursor) { "network_completed_sequence_regressed" }
        cursor = completedSequence
        attempts = 0
        disconnectedAt = null
        return snapshot(network, NetworkRunPhase.ONLINE, null, strings.text(NetworkRunText.RESTORED))
    }

    private fun snapshot(network: RunNetworkKind, phase: NetworkRunPhase, next: Long?, message: String) =
        NetworkRunSnapshot(runId, cursor, network, phase, attempts, next, message)
}
