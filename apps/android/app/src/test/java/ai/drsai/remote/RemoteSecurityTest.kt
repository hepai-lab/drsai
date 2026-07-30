package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteSubscriptionRegistry
import ai.drsai.remote.remote.data.redactRemoteSecrets
import kotlinx.coroutines.Job
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class RemoteSecurityTest {
    @Test fun `remote diagnostics redact all credential and content forms`() {
        val redacted = redactRemoteSecrets("Authorization:Bearer-x Cookie=s token=t secret=k code=c file_content=body")
        listOf("Bearer-x", "Cookie=s", "token=t", "secret=k", "code=c", "file_content=body").forEach {
            assertFalse(redacted.contains(it))
        }
        assertEquals(6, Regex(Regex.escape("[REDACTED]")).findAll(redacted).count())
    }

    @Test fun `logout registry cancels every subject subscription`() {
        val first = Job(); val second = Job()
        RemoteSubscriptionRegistry.register("alice", first)
        RemoteSubscriptionRegistry.register("alice", second)
        assertEquals(2, RemoteSubscriptionRegistry.activeCount("alice"))
        RemoteSubscriptionRegistry.cancelSubject("alice")
        assertFalse(first.isActive)
        assertFalse(second.isActive)
        assertEquals(0, RemoteSubscriptionRegistry.activeCount("alice"))
    }

    @Test fun `shared redaction canaries never survive diagnostics`() {
        val fixture = sequenceOf(
            File("../../../cores/protocol/relay/secret-redaction-fixtures.json"),
            File("../../cores/protocol/relay/secret-redaction-fixtures.json"),
            File("cores/protocol/relay/secret-redaction-fixtures.json"),
        ).first(File::isFile)
        val samples = JSONObject(fixture.readText()).getJSONArray("samples")
        repeat(samples.length()) { index ->
            val sample = samples.getJSONObject(index)
            val redacted = redactRemoteSecrets(sample.getString("input"))
            assert(redacted.contains("[REDACTED]"))
            val canaries = sample.getJSONArray("must_not_contain")
            repeat(canaries.length()) { canaryIndex ->
                assertFalse(redacted.contains(canaries.getString(canaryIndex)))
            }
        }
    }
}
