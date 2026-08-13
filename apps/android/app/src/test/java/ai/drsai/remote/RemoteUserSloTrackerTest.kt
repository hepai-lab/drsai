package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteUserSloTracker
import ai.drsai.remote.remote.data.RemoteUserSloDiagnostics
import ai.drsai.remote.remote.data.RemoteUserSloJourney
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteUserSloTrackerTest {
    @Test fun `first screen is emitted once only after authority and render`() {
        var clock = 10L
        var samples = 0
        val tracker = RemoteUserSloTracker(clockMs = { clock }, sampleId = { "sample-${++samples}-00000000" })
        tracker.cacheLoaded()
        assertNull(tracker.firstRendered())
        clock = 20
        tracker.authorityRefreshed()
        clock = 30
        val result = requireNotNull(tracker.firstRendered())
        assertEquals(listOf(10L, 20L, 30L), listOf(
            result.cacheLoadAtMs, result.authorityRefreshAtMs, result.firstRenderAtMs,
        ))
        assertNull(tracker.firstRendered())
    }

    @Test fun `operation confirmation is bounded correlated and waits for rendered state`() {
        var clock = 1L
        var samples = 0
        val tracker = RemoteUserSloTracker(
            capacity = 2, clockMs = { clock }, sampleId = { "sample-${++samples}-00000000" },
        )
        tracker.operationDispatched("private-handle-one")
        clock = 2
        tracker.operationDispatched("private-handle-two")
        clock = 3
        tracker.operationDispatched("private-handle-three")
        assertEquals(2, tracker.pendingOperationCount())
        tracker.operationCommitted("private-handle-two")
        clock = 4
        val rendered = tracker.operationsRendered()
        assertEquals(1, rendered.size)
        assertEquals(listOf(2L, 3L, 4L), listOf(
            rendered.single().requestDispatchAtMs,
            rendered.single().runtimeCommitAtMs,
            rendered.single().confirmationRenderAtMs,
        ))
        assertTrue(rendered.single().sampleId.startsWith("sample-"))
        assertEquals(1, tracker.pendingOperationCount())
    }

    @Test fun `reconnect clamps backward clock and requires transport restoration`() {
        var clock = 100L
        val tracker = RemoteUserSloTracker(clockMs = { clock }, sampleId = { "sample-reconnect-0001" })
        tracker.disconnected()
        assertNull(tracker.replayCaughtUp())
        clock = 90
        tracker.transportRestored()
        clock = 80
        val result = requireNotNull(tracker.replayCaughtUp())
        assertEquals(listOf(100L, 100L, 100L), listOf(
            result.disconnectDetectAtMs, result.transportRestoreAtMs, result.replayCatchupAtMs,
        ))
    }

    @Test fun `invalid capacity and blank operation fail closed`() {
        assertTrue(runCatching { RemoteUserSloTracker(capacity = 0) }.exceptionOrNull() is IllegalArgumentException)
        val tracker = RemoteUserSloTracker()
        assertTrue(runCatching { tracker.operationDispatched(" ") }.exceptionOrNull() is IllegalArgumentException)
    }

    @Test fun `diagnostics expose content free monotonic outcome counts`() {
        val before = RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN)
        RemoteUserSloDiagnostics.attempted(RemoteUserSloJourney.FIRST_SCREEN)
        RemoteUserSloDiagnostics.succeeded(RemoteUserSloJourney.FIRST_SCREEN)
        RemoteUserSloDiagnostics.attempted(RemoteUserSloJourney.FIRST_SCREEN)
        RemoteUserSloDiagnostics.failed(RemoteUserSloJourney.FIRST_SCREEN)
        val after = RemoteUserSloDiagnostics.snapshot(RemoteUserSloJourney.FIRST_SCREEN)
        assertEquals(2, after.attempted - before.attempted)
        assertEquals(1, after.succeeded - before.succeeded)
        assertEquals(1, after.failed - before.failed)
    }
}
