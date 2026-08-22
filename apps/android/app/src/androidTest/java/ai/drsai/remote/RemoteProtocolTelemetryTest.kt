package ai.drsai.remote

import androidx.test.core.app.ApplicationProvider
import ai.drsai.remote.remote.data.RemoteProtocolSelection
import ai.drsai.remote.remote.data.RemoteProtocolTelemetry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteProtocolTelemetryTest {
    @Test
    fun observations_have_only_protocol_version_reason_and_count_dimensions() {
        val telemetry = RemoteProtocolTelemetry(ApplicationProvider.getApplicationContext())
        telemetry.record(RemoteProtocolSelection(
            oaep = false,
            legacySessionEvents = true,
            owop = true,
            selected = "conversation/1",
            version = "1.5.3",
            schemaHash = null,
            fallbackReason = "unexpected token=secret-canary",
            upgradeAction = "upgrade_runtime",
        ))

        val row = telemetry.snapshot().single {
            it.protocol == "conversation/1" && it.runtimeVersion == "1.5.3" && it.fallbackReason == "other"
        }
        assertEquals("conversation/1", row.protocol)
        assertEquals("1.5.3", row.runtimeVersion)
        assertEquals("other", row.fallbackReason)
        assertFalse(row.toString().contains("secret-canary"))
    }
}
