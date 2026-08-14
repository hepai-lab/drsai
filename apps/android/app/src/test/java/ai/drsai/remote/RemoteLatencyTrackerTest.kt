package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteLatencyTracker
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventData
import ai.drsai.remote.remote.generated.OaepSource
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteLatencyTrackerTest {
    @Test
    fun `ten thousand received events remain bounded and render drains entry`() {
        var now = 1_000L
        val tracker = RemoteLatencyTracker(capacity = 64) { now++ }
        repeat(10_000) { tracker.received(event("event-$it")) }
        assertEquals(64, tracker.pendingCount())

        val (received, rendered) = tracker.rendered(event("event-9999"))
        assertEquals(10_999L, received)
        assertEquals(11_000L, rendered)
        assertEquals(63, tracker.pendingCount())
        tracker.clear()
        assertEquals(0, tracker.pendingCount())
    }

    private fun event(id: String) = OaepEvent(
        version = "1.0",
        eventId = id,
        sessionId = "session",
        runId = "run",
        itemId = null,
        sequence = 1,
        type = "event.run.started",
        timestamp = "2026-01-01T00:00:00Z",
        dedupeKey = id,
        source = OaepSource(backend = "opendrsai"),
        data = OaepEventData(),
    )
}
