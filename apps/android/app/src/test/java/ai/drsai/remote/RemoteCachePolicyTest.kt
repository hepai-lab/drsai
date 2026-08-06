package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteCachePolicy
import ai.drsai.remote.remote.data.RemoteCacheSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteCachePolicyTest {
    @Test
    fun `cache metadata exposes source expiry and a stable stale reason`() {
        val fresh = RemoteCachePolicy.metadata(RemoteCacheSource.CACHE, 1_000, 500, 1_499)
        assertEquals(RemoteCacheSource.CACHE, fresh.source)
        assertEquals(1_500L, fresh.expiresAt)
        assertFalse(fresh.stale)

        val expired = RemoteCachePolicy.metadata(RemoteCacheSource.CACHE, 1_000, 500, 1_501)
        assertTrue(expired.stale)
        assertEquals("ttl_expired", expired.staleReason)

        val offline = RemoteCachePolicy.metadata(
            RemoteCacheSource.CACHE, 1_000, 500, 1_100, "network_unavailable",
        )
        assertEquals("network_unavailable", offline.staleReason)
    }

    @Test
    fun `all catalog classes have explicit ttl and bounded capacity`() {
        assertTrue(RemoteCachePolicy.HOST_TTL_MS > 0)
        assertTrue(RemoteCachePolicy.WORKSPACE_TTL_MS > 0)
        assertTrue(RemoteCachePolicy.SESSION_TTL_MS > 0)
        assertTrue(RemoteCachePolicy.SNAPSHOT_TTL_MS > 0)
        assertEquals(100, RemoteCachePolicy.MAX_HOSTS)
        assertEquals(1_000, RemoteCachePolicy.MAX_WORKSPACES_PER_HOST)
        assertEquals(10_000, RemoteCachePolicy.MAX_SESSIONS_PER_WORKSPACE)
        assertEquals(100_000, RemoteCachePolicy.MAX_EVENTS_PER_ACCOUNT)
        assertEquals(100_000, RemoteCachePolicy.MAX_TERMINAL_ITEMS_PER_ACCOUNT)
    }
}
