package ai.drsai.remote.remote.data

import kotlinx.coroutines.delay

/** Injectable time and scheduling boundary for the remote-workspace domain. */
class RemoteTimeScheduler(
    private val wallClock: () -> Long = System::currentTimeMillis,
    private val monotonicClock: () -> Long = System::nanoTime,
    private val sleeper: suspend (Long) -> Unit = { delay(it) },
    private val frameIntervalMillis: Long = 16L,
) {
    init {
        require(frameIntervalMillis in 1..1000) { "frame_interval_invalid" }
    }

    fun wallClockMillis(): Long = wallClock()

    fun monotonicNanos(): Long = monotonicClock()

    /** Wall-clock age is saturating because users and NTP may move time backwards. */
    fun wallAgeMillis(timestampMillis: Long): Long =
        (wallClockMillis() - timestampMillis).coerceAtLeast(0L)

    fun isWallExpired(timestampMillis: Long, maxAgeMillis: Long): Boolean {
        require(maxAgeMillis >= 0) { "max_age_invalid" }
        return wallAgeMillis(timestampMillis) > maxAgeMillis
    }

    /** A recreated process starts a new monotonic window; rollback cannot create negative elapsed time. */
    fun monotonicElapsedMillis(startNanos: Long): Long =
        ((monotonicNanos() - startNanos) / 1_000_000L).coerceAtLeast(0L)

    suspend fun waitFor(delayMillis: Long) {
        require(delayMillis >= 0) { "delay_invalid" }
        sleeper(delayMillis)
    }

    suspend fun awaitFrame() = waitFor(frameIntervalMillis)
}
