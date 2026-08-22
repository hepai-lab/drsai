package ai.drsai.remote

import ai.drsai.remote.runtime.python.RunCapabilityDiagnostics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RunCapabilityDiagnosticsTest {
    @Test fun `saf network and remote runtime facts produce explicit stable categories`() {
        val offline = RunCapabilityDiagnostics.snapshot(
            safReadAvailable = false,
            safWriteAvailable = false,
            networkAvailable = false,
            remoteRuntimeAvailable = false,
        )
        val blocked = offline.getJSONArray("blocked")
        assertEquals(6, blocked.length())
        assertEquals("model.chat", blocked.getJSONObject(0).getString("id"))
        assertTrue((0 until blocked.length()).map { blocked.getJSONObject(it).getString("id") }
            .contains("tool.web.search"))
        assertTrue((0 until blocked.length()).map { blocked.getJSONObject(it).getString("id") }
            .contains("tool.web.fetch"))
        assertEquals(0, offline.getJSONArray("remote_available").length())

        val ready = RunCapabilityDiagnostics.snapshot(
            safReadAvailable = true,
            safWriteAvailable = true,
            networkAvailable = true,
            remoteRuntimeAvailable = true,
        )
        assertEquals(0, ready.getJSONArray("blocked").length())
        assertTrue((0 until ready.getJSONArray("remote_available").length()).map {
            ready.getJSONArray("remote_available").getString(it)
        }.contains("tool.shell"))
    }
}
