package ai.drsai.remote

import ai.drsai.remote.runtime.reliability.*
import org.junit.Assert.*
import org.junit.Test

class NetworkRunContinuityTest {
    @Test fun `wifi cellular offline recovery and restricted fixtures preserve completed work`() {
        val continuity = NetworkRunContinuity("run-1", completedSequence = 7)
        assertEquals(NetworkRunPhase.ONLINE, continuity.observe(RunNetworkKind.WIFI, 0).phase)
        val offline = continuity.observe(RunNetworkKind.OFFLINE, 1_000)
        assertEquals(NetworkRunPhase.WAITING_NETWORK, offline.phase)
        assertTrue(offline.userMessage.contains("Waiting for network"))
        val restricted = continuity.observe(RunNetworkKind.RESTRICTED, 2_000)
        assertEquals(7, restricted.completedSequence)
        assertTrue(restricted.userMessage.contains("Network is restricted"))
        val recovering = continuity.observe(RunNetworkKind.CELLULAR, 3_000)
        assertNotNull(recovering.nextReconnectAtMillis)
        val restored = continuity.reconnected(RunNetworkKind.CELLULAR, 8)
        assertEquals(NetworkRunPhase.ONLINE, restored.phase)
        assertEquals(8, restored.completedSequence)
        assertEquals("run-1", restored.runId)
    }

    @Test fun `reconnect is bounded and runtime failure is distinct from waiting for network`() {
        val continuity = NetworkRunContinuity("run", 3, maxReconnectAttempts = 2, maxReconnectWindowMillis = 10_000)
        assertEquals(NetworkRunPhase.WAITING_NETWORK, continuity.observe(RunNetworkKind.OFFLINE, 0).phase)
        assertEquals(NetworkRunPhase.WAITING_NETWORK, continuity.observe(RunNetworkKind.WIFI, 1_000).phase)
        assertEquals(NetworkRunPhase.WAITING_NETWORK, continuity.observe(RunNetworkKind.WIFI, 2_000).phase)
        val exhausted = continuity.observe(RunNetworkKind.WIFI, 3_000)
        assertEquals(NetworkRunPhase.RUNTIME_FAILED, exhausted.phase)
        assertTrue(exhausted.userMessage.contains("Runtime"))
        assertNull(exhausted.nextReconnectAtMillis)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `completed cursor cannot move backwards across a network switch`() {
        val continuity = NetworkRunContinuity("run", 4)
        continuity.observe(RunNetworkKind.OFFLINE, 0, completedSequence = 3)
    }
}
