package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteSubscriptionRegistry
import ai.drsai.remote.remote.data.redactRemoteSecrets
import kotlinx.coroutines.Job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

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
}
