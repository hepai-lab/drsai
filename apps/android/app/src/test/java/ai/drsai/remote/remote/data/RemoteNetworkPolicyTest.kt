package ai.drsai.remote.remote.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteNetworkPolicyTest {
    private val policy = RemoteNetworkPolicy(meteredConfirmationBytes = 100, absoluteMaximumBytes = 1_000)

    @Test fun `large metered download requires explicit confirmation`() {
        assertEquals(RemoteDownloadDecision.REQUIRE_CONFIRMATION, policy.download(100, metered = true))
        assertEquals(RemoteDownloadDecision.ALLOW, policy.download(100, metered = true, userConfirmed = true))
    }

    @Test fun `wifi and small downloads proceed while absolute limit rejects`() {
        assertEquals(RemoteDownloadDecision.ALLOW, policy.download(999, metered = false))
        assertEquals(RemoteDownloadDecision.ALLOW, policy.download(99, metered = true))
        assertEquals(RemoteDownloadDecision.REJECT_TOO_LARGE, policy.download(1_001, metered = false))
    }
}
