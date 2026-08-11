package ai.drsai.remote

import ai.drsai.remote.runtime.oaep.AndroidOaepReleaseGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class V156BuildIdentityContractTest {
    @Test fun `debug build has one full local runtime authority`() {
        assertEquals("1.5.6", BuildConfig.VERSION_NAME)
        assertEquals(10506, BuildConfig.VERSION_CODE)
        assertEquals("ai.drsai.remote.debug", BuildConfig.APPLICATION_ID)
        assertTrue(BuildConfig.FULL_AGENT_RUNTIME_ENABLED)
        assertTrue(BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED)
        assertFalse(BuildConfig.KOTLIN_LITE_RUNTIME_ENABLED)
        assertEquals("1.5.6", AndroidOaepReleaseGate.ANDROID_AGENT_RUNTIME_VERSION)
        assertEquals("1.5.6", AndroidOaepReleaseGate.MINIMUM_ANDROID_AGENT_RUNTIME_VERSION)
    }
}
