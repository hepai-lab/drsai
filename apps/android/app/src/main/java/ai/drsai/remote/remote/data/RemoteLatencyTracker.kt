package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.OaepEvent

/** Process-owned, content-free and bounded receive-to-render latency tracker. */
class RemoteLatencyTracker(
    private val capacity: Int = 4096,
    private val wallClockMs: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()
    private val receivedAtMs = LinkedHashMap<String, Long>()

    init {
        require(capacity in 1..4096) { "latency_tracker_capacity_invalid" }
    }

    fun received(event: OaepEvent) {
        val receivedAt = wallClockMs().coerceAtLeast(0)
        synchronized(lock) {
            receivedAtMs.putIfAbsent(event.eventId, receivedAt)
            while (receivedAtMs.size > capacity) {
                receivedAtMs.remove(receivedAtMs.keys.first())
            }
        }
    }

    fun rendered(event: OaepEvent): Pair<Long, Long> {
        val renderedAt = wallClockMs().coerceAtLeast(0)
        val receivedAt = synchronized(lock) { receivedAtMs.remove(event.eventId) } ?: renderedAt
        return receivedAt.coerceAtMost(renderedAt) to renderedAt
    }

    fun pendingCount(): Int = synchronized(lock) { receivedAtMs.size }

    fun clear() = synchronized(lock) { receivedAtMs.clear() }
}
