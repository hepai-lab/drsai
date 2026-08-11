package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteResourceLeaseRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class RemoteResourceLeaseRegistryTest {
    @Test
    fun `one hundred page switches return resource count to baseline`() {
        val registry = RemoteResourceLeaseRegistry()
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
}
