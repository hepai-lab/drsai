package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteTimeScheduler
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTimeSchedulerTest {
    @Test
    fun `clock rollback saturates wall and monotonic age`() {
        val time = RemoteTimeScheduler(
            wallClock = { 900L },
            monotonicClock = { 4_000_000L },
            sleeper = {},
        )
        assertEquals(0L, time.wallAgeMillis(1_000L))
        assertFalse(time.isWallExpired(1_000L, 1L))
        assertEquals(0L, time.monotonicElapsedMillis(5_000_000L))
    }

    @Test
    fun `process reconstruction and cross day use durable wall timestamp`() {
        val persistedAt = 1_700_000_000_000L
        val firstProcess = RemoteTimeScheduler(wallClock = { persistedAt }, sleeper = {})
        assertFalse(firstProcess.isWallExpired(persistedAt, DAY_MILLIS))

        val recreatedProcess = RemoteTimeScheduler(
            wallClock = { persistedAt + 2 * DAY_MILLIS },
            monotonicClock = { 1L },
            sleeper = {},
        )
        assertTrue(recreatedProcess.isWallExpired(persistedAt, DAY_MILLIS))
    }

    @Test
    fun `retry and frame scheduling are deterministic without real sleep`() = runTest {
        val requested = mutableListOf<Long>()
        val time = RemoteTimeScheduler(sleeper = { requested += it })
        repeat(100) {
            time.waitFor(500L)
            time.awaitFrame()
        }
        assertEquals(200, requested.size)
        assertEquals(List(100) { listOf(500L, 16L) }.flatten(), requested)
    }

    private companion object {
        const val DAY_MILLIS = 24L * 60L * 60L * 1000L
    }
}
