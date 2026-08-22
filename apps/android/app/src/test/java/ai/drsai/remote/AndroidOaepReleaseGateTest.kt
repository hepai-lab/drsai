package ai.drsai.remote

import ai.drsai.remote.runtime.oaep.AndroidFactAuthority
import ai.drsai.remote.runtime.oaep.AndroidOaepCompatibility
import ai.drsai.remote.runtime.oaep.AndroidOaepReleaseGate
import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidOaepReleaseGateTest {
    private val capabilities = AndroidOaepReleaseGate.requiredCapabilities
    private val profiles = setOf(AndroidOaepReleaseGate.OAEP_STREAM_PROFILE)

    @Test fun `v1_5_6 complete OAEP contract enables full agent runtime`() {
        assertEquals(AndroidOaepCompatibility.FULL_OAEP, AndroidOaepReleaseGate.negotiate(
            "1.5.6", "1.0", profiles, capabilities, legacyRemoteAvailable = true,
        ))
    }

    @Test fun `minimum version and partial OAEP fail closed`() {
        assertEquals(AndroidOaepCompatibility.REJECT, AndroidOaepReleaseGate.negotiate(
            "1.5.5", "1.0", profiles, capabilities, legacyRemoteAvailable = true,
        ))
        assertEquals(AndroidOaepCompatibility.REJECT, AndroidOaepReleaseGate.negotiate(
            "1.5.6", "1.0", emptySet(), setOf("oaep.v1"), legacyRemoteAvailable = true,
        ))
    }

    @Test fun `non OAEP legacy relay can only degrade to remote read path`() {
        assertEquals(AndroidOaepCompatibility.SAFE_REMOTE_ONLY, AndroidOaepReleaseGate.negotiate(
            "1.5.6", null, emptySet(), emptySet(), legacyRemoteAvailable = true,
        ))
        assertEquals(AndroidFactAuthority.OAEP_SNAPSHOT, AndroidOaepReleaseGate.factAuthority)
    }
}
