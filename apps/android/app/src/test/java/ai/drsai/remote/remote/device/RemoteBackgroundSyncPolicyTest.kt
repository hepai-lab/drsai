package ai.drsai.remote.remote.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteBackgroundSyncPolicyTest {
    @Test fun `foreground online owns SSE and never schedules background work`() {
        listOf(false, true).forEach { pushReady ->
            val policy = remoteBackgroundPolicy(foreground = true, online = true, pushReady = pushReady)
            assertTrue(policy.keepForegroundSse)
            assertFalse(policy.relyOnPush)
            assertFalse(policy.scheduleFallbackPull)
        }
        assertFalse(remoteBackgroundPolicy(true, false, false).keepForegroundSse)
    }

    @Test fun `background uses exactly push or fallback and never SSE`() {
        val push = remoteBackgroundPolicy(foreground = false, online = true, pushReady = true)
        assertFalse(push.keepForegroundSse)
        assertTrue(push.relyOnPush)
        assertFalse(push.scheduleFallbackPull)

        val fallback = remoteBackgroundPolicy(foreground = false, online = false, pushReady = false)
        assertFalse(fallback.keepForegroundSse)
        assertFalse(fallback.relyOnPush)
        assertTrue(fallback.scheduleFallbackPull)
    }

    @Test fun `one thousand identical lifecycle updates do not reset periodic work`() {
        class Fake : RemoteBackgroundWorkController {
            var scheduled = 0
            var cancelled = 0
            override fun scheduleUniqueFallback() { scheduled += 1 }
            override fun cancelFallback() { cancelled += 1 }
        }
        val fake = Fake()
        val coordinator = RemoteBackgroundSyncCoordinator(fake)
        repeat(1_000) { coordinator.reconcile(false, online = it % 2 == 0, pushReady = false) }
        assertEquals(1, fake.scheduled)
        assertEquals(0, fake.cancelled)
        repeat(1_000) { coordinator.reconcile(true, online = true, pushReady = false) }
        assertEquals(1, fake.scheduled)
        assertEquals(1, fake.cancelled)
    }
}
