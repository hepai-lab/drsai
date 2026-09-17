package ai.drsai.remote

import ai.drsai.remote.runtime.oaep.AndroidOaepReleaseGate
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class P10BuildIdentityContractTest {
    @Test fun `debug build uses the v157 full runtime identity`() {
        assertEquals("1.5.7", BuildConfig.VERSION_NAME)
        assertEquals(10507, BuildConfig.VERSION_CODE)
        assertEquals("ai.drsai.remote.debug", BuildConfig.APPLICATION_ID)
        assertTrue(BuildConfig.FULL_AGENT_RUNTIME_ENABLED)
        assertTrue(BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED)
        assertFalse(BuildConfig.KOTLIN_LITE_RUNTIME_ENABLED)
        assertEquals("1.5.7", AndroidOaepReleaseGate.ANDROID_AGENT_RUNTIME_VERSION)
        assertEquals("1.5.6", AndroidOaepReleaseGate.MINIMUM_ANDROID_AGENT_RUNTIME_VERSION)
    }

    @Test fun `p10 release claim is fail closed while either ledger is incomplete`() {
        assertFalse(BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE)
        assertFalse(BuildConfig.P10_PRODUCTIZATION_COMPLETE)
        assertFalse(BuildConfig.P10_RELEASE_CANDIDATE_READY)
    }

    @Test fun `development version defaults to the repository system version`() {
        val build = File("build.gradle.kts").readText()
        assertTrue(build.contains(".getOrElse(systemVersion)"))
        assertFalse(build.contains(".getOrElse(\"1.5.6\")"))
    }
}
