package ai.drsai.remote.remote.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteProtocolTelemetryTest {
    @Test fun metricsAreBoundedContentFreeAndRedactSecretLikeLabels() {
        val store = RemoteProtocolTelemetry(ApplicationProvider.getApplicationContext())
        repeat(200) { index ->
            store.record(RemoteProtocolSelection(
                oaep = index % 2 == 0, legacySessionEvents = index % 2 != 0, owop = true,
                selected = if (index % 2 == 0) "oaep" else "legacy", version = "1.$index",
                schemaHash = null, fallbackReason = "fallback token=secret-canary-$index",
                upgradeAction = null,
            ))
        }
        val snapshot = store.snapshot()
        assertTrue(snapshot.size <= 128)
        val serialized = snapshot.joinToString("|")
        assertFalse(serialized.contains("secret-canary"))
        assertFalse(serialized.contains("subject"))
        assertFalse(serialized.contains("message"))
    }
}
