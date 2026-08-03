package ai.drsai.remote

import ai.drsai.remote.data.AndroidUpdatePolicy
import ai.drsai.remote.data.AndroidUpdateCheckEngine
import ai.drsai.remote.data.AndroidUpdateManifestSource
import ai.drsai.remote.data.AndroidUpdateInstallPolicy
import ai.drsai.remote.data.AndroidUpdateSource
import ai.drsai.remote.data.AndroidUpdateState
import ai.drsai.remote.data.AndroidUpdateStateMachine
import ai.drsai.remote.data.InstalledAndroidVersion
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
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
        apkUrl: String = "https://download-opendrsai.ihep.ac.cn/releases/v1.4.7/android/OpenDrSai-Android-v1.4.7.apk",
    ) = """
        {"schemaVersion":1,"platform":"android","channel":"stable","version":"$version",
         "versionCode":$versionCode,"publishedAt":"2026-07-18T00:00:00Z","minimumSupportedVersion":"1.4.0",
         "mandatory":false,"apk":{"url":"$apkUrl","sizeBytes":1234,"sha256":"$sha","signingCertSha256":"$cert"}}
    """.trimIndent()

    @Test fun parsesAndAcceptsImmutableOpenDrSaiCdnApk() {
        val update = AndroidUpdatePolicy.parseManifest(manifest())
        assertEquals(10407, update.versionCode)
        assertEquals("1.4.7", update.version)
    }

    @Test fun rejectsMutableLatestApkUrl() {
        runCatching { AndroidUpdatePolicy.parseManifest(manifest(apkUrl = "https://download-opendrsai.ihep.ac.cn/releases/latest/android/app.apk")) }
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

    @Test fun releaseIdentityIgnoresOnlyHostingLocation() {
        val cdn = AndroidUpdatePolicy.parseManifest(
            manifest(),
            source = AndroidUpdateSource.CDN,
            manifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/stable/latest-android.json",
        )
        val github = AndroidUpdatePolicy.parseManifest(
            manifest(
                apkUrl = "https://github.com/hepai-lab/drsai/releases/download/v1.4.7/OpenDrSai-Android-v1.4.7.apk",
            ),
            source = AndroidUpdateSource.GITHUB,
            manifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/latest-android.json",
        )
        assertTrue(AndroidUpdatePolicy.sameRelease(cdn, github))
        assertFalse(AndroidUpdatePolicy.sameRelease(cdn, github.copy(sha256 = "c".repeat(64))))
    }

    @Test fun failedPrimaryManifestFallsBackToGithub() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(200).setBody(manifest()))
        server.start()
        try {
            val result = checkEngine(
                primaryUrl = server.url("/cdn/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
                fallbackUrl = server.url("/github/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
            )
            assertTrue(result is AndroidUpdateState.Available)
            assertEquals(
                AndroidUpdateSource.GITHUB,
                (result as AndroidUpdateState.Available).update.source,
            )
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test fun currentPrimaryManifestDoesNotContactFallback() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody(manifest(versionCode = 10406)))
        server.start()
        try {
            val result = checkEngine(
                primaryUrl = server.url("/cdn/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
                fallbackUrl = server.url("/github/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
            )
            assertEquals(AndroidUpdateState.Idle, result)
            assertEquals(1, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test fun bothManifestSourcesFailAsOneRetryableError() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(MockResponse().setResponseCode(502))
        server.start()
        try {
            val result = checkEngine(
                primaryUrl = server.url("/cdn/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
                fallbackUrl = server.url("/github/latest-android.json").newBuilder().host("127.0.0.1").build().toString(),
            )
            assertTrue(result is AndroidUpdateState.Failed)
            assertEquals("manifest-sources-failed", (result as AndroidUpdateState.Failed).code)
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test fun updateStateMachineAllowsOnlyExplicitLifecycleTransitions() {
        val update = AndroidUpdatePolicy.parseManifest(manifest())
        assertTrue(
            AndroidUpdateStateMachine.canTransition(
                AndroidUpdateState.Idle,
                AndroidUpdateState.Checking,
            ),
        )
        assertTrue(
            AndroidUpdateStateMachine.canTransition(
                AndroidUpdateState.Checking,
                AndroidUpdateState.Available(update),
            ),
        )
        assertTrue(
            AndroidUpdateStateMachine.canTransition(
                AndroidUpdateState.Downloading(update, 50),
                AndroidUpdateState.Verifying(update),
            ),
        )
        assertFalse(
            AndroidUpdateStateMachine.canTransition(
                AndroidUpdateState.Idle,
                AndroidUpdateState.Installing(update),
            ),
        )
        assertFalse(
            AndroidUpdateStateMachine.canTransition(
                AndroidUpdateState.Installing(update),
                AndroidUpdateState.Downloading(update, 1),
            ),
        )
    }

    @Test fun unknownSourcesPermissionIsRequiredOnlyOnAndroidEightAndNewer() {
        assertFalse(AndroidUpdateInstallPolicy.requiresUnknownSourcesPermission(25, false))
        assertTrue(AndroidUpdateInstallPolicy.requiresUnknownSourcesPermission(26, false))
        assertFalse(AndroidUpdateInstallPolicy.requiresUnknownSourcesPermission(26, true))
        assertFalse(AndroidUpdateInstallPolicy.requiresUnknownSourcesPermission(35, true))
    }

    private suspend fun checkEngine(
        primaryUrl: String,
        fallbackUrl: String,
    ): AndroidUpdateState = AndroidUpdateCheckEngine(
        sources = listOf(
            AndroidUpdateManifestSource(AndroidUpdateSource.CDN, primaryUrl),
            AndroidUpdateManifestSource(AndroidUpdateSource.GITHUB, fallbackUrl),
        ),
        channel = "stable",
        installedVersion = { InstalledAndroidVersion("1.4.6", 10406) },
        allowInsecureLocal = true,
        http = OkHttpClient(),
    ).check()
}
