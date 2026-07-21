package ai.drsai.remote

import ai.drsai.remote.data.AndroidUpdatePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidUpdatePolicyTest {
    private fun manifest(
        version: String = "1.4.7",
        versionCode: Long = 10407,
        sha: String = "a".repeat(64),
        cert: String = "b".repeat(64),
        apkUrl: String = "https://github.com/hepai-lab/drsai/releases/download/android-v1.4.7/OpenDrSai-Android-v1.4.7.apk",
    ) = """
        {"schemaVersion":1,"platform":"android","channel":"stable","version":"$version",
         "versionCode":$versionCode,"publishedAt":"2026-07-18T00:00:00Z","minimumSupportedVersion":"1.4.0",
         "mandatory":false,"apk":{"url":"$apkUrl","sizeBytes":1234,"sha256":"$sha","signingCertSha256":"$cert"}}
    """.trimIndent()

    @Test fun parsesAndAcceptsImmutableGithubApk() {
        val update = AndroidUpdatePolicy.parseManifest(manifest())
        assertEquals(10407, update.versionCode)
        assertEquals("1.4.7", update.version)
    }

    @Test fun rejectsMutableLatestApkUrl() {
        runCatching { AndroidUpdatePolicy.parseManifest(manifest(apkUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/app.apk")) }
            .onSuccess { error("mutable APK URL should be rejected") }
    }

    @Test fun comparesVersionCodesAndMinimumVersion() {
        assertTrue(AndroidUpdatePolicy.isNewer(10406, 10407))
        assertFalse(AndroidUpdatePolicy.isNewer(10407, 10407))
        assertTrue(AndroidUpdatePolicy.isBelowMinimum("1.3.9", "1.4.0"))
        assertFalse(AndroidUpdatePolicy.isBelowMinimum("1.4.7", "1.4.0"))
    }

    @Test fun rejectsUntrustedHostAndBadHash() {
        runCatching { AndroidUpdatePolicy.parseManifest(manifest(apkUrl = "https://example.com/app.apk")) }
            .onSuccess { error("untrusted host should be rejected") }
        runCatching { AndroidUpdatePolicy.parseManifest(manifest(sha = "x".repeat(64))) }
            .onSuccess { error("bad hash should be rejected") }
    }

    @Test fun insecureLocalFeedRequiresExplicitAcceptanceFlag() {
        val local = manifest(apkUrl = "http://10.0.2.2:8766/OpenDrSai-Android-v1.4.7.apk")
        runCatching { AndroidUpdatePolicy.parseManifest(local) }
            .onSuccess { error("production policy must reject cleartext local URLs") }
        assertEquals(10407, AndroidUpdatePolicy.parseManifest(local, allowInsecureLocal = true).versionCode)
        runCatching {
            AndroidUpdatePolicy.parseManifest(
                manifest(apkUrl = "http://example.com/OpenDrSai-Android-v1.4.7.apk"),
                allowInsecureLocal = true,
            )
        }.onSuccess { error("acceptance flag must not allow remote cleartext hosts") }
    }
}
