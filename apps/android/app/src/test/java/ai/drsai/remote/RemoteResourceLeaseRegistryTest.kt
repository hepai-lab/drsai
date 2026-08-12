package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteResourceLeaseRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class RemoteResourceLeaseRegistryTest {
    @Test
    fun `one hundred page switches return resource count to baseline`() {
        val registry = RemoteResourceLeaseRegistry()
        registry.registerOwner("session_sync", this, capacity = 2)
        val baseline = registry.activeCount()
        repeat(100) {
            registry.acquire("session_sync").use {
                assertEquals(baseline + 1, registry.activeCount())
            }
        }
        assertEquals(baseline, registry.activeCount())
        assertEquals(emptyMap<String, Int>(), registry.snapshot())
    }

    @Test
    fun `diagnostic class rejects identifiers that could contain user data`() {
        try {
            RemoteResourceLeaseRegistry().acquire("session/user@example.com")
            fail("unsafe diagnostic identifier must be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun `one hundred account and network transitions retain one owner and return leases to baseline`() {
        val registry = RemoteResourceLeaseRegistry()
        val owners = mapOf(
            "database" to Any(),
            "http" to Any(),
            "sse_stream" to Any(),
            "token_refresh" to Any(),
            "device_proof" to Any(),
            "latency_tracker" to Any(),
            "connectivity" to Any(),
        )
        owners.forEach { (name, owner) ->
            registry.registerOwner(name, owner, capacity = if (name == "sse_stream") 8 else 1)
        }
        val baseline = registry.ownershipSnapshot()

        repeat(100) {
            registry.acquire("sse_stream").use {
                assertEquals(1, registry.snapshot()["sse_stream"])
            }
            // Account replacement and network loss reuse the process owners;
            // neither transition allocates a second DB/client/coordinator/proof.
            owners.forEach { (name, owner) ->
                registry.registerOwner(name, owner, capacity = if (name == "sse_stream") 8 else 1)
            }
        }

        assertEquals(baseline, registry.ownershipSnapshot())
        assertEquals(0, registry.activeCount())
    }

    @Test
    fun `second owner and lease above capacity fail closed`() {
        val registry = RemoteResourceLeaseRegistry()
        val owner = Any()
        registry.registerOwner("sse_stream", owner, capacity = 2)
        try {
            registry.registerOwner("sse_stream", Any(), capacity = 2)
            fail("second process owner must be rejected")
        } catch (_: IllegalStateException) {
            // Expected.
        }
        val first = registry.acquire("sse_stream")
        val second = registry.acquire("sse_stream")
        try {
            registry.acquire("sse_stream")
            fail("capacity overflow must be rejected")
        } catch (_: IllegalStateException) {
            // Expected.
        } finally {
            first.close()
            second.close()
        }
        assertEquals(0, registry.activeCount())
    }
}
