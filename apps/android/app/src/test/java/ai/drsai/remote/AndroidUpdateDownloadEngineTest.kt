package ai.drsai.remote

import ai.drsai.remote.data.AndroidApkUpdate
import ai.drsai.remote.data.AndroidUpdateDownloadEngine
import ai.drsai.remote.data.AndroidUpdateSource
import ai.drsai.remote.data.AndroidUpdateState
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class AndroidUpdateDownloadEngineTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun cdnApkFailureFallsBackToMatchingGithubRelease() = runTest {
        val server = MockWebServer()
        val apk = "verified-apk-content".toByteArray()
        server.start()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                manifest(
                    apkUrl = localUrl(server, "/github.apk"),
                    bytes = apk,
                ),
            ),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(apk)))
        try {
            val requested = update(
                apkUrl = localUrl(server, "/cdn.apk"),
                bytes = apk,
                source = AndroidUpdateSource.CDN,
            )
            val result = engine(server).download(requested)
            assertTrue(result is AndroidUpdateState.Ready)
            val ready = result as AndroidUpdateState.Ready
            assertEquals(AndroidUpdateSource.GITHUB, ready.update.source)
            assertTrue(ready.apk.readBytes().contentEquals(apk))
            assertEquals(3, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun fallbackReleaseIdentityMismatchIsRejected() = runTest {
        val server = MockWebServer()
        val apk = "expected-apk".toByteArray()
        server.start()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                manifest(
                    apkUrl = localUrl(server, "/github.apk"),
                    bytes = "different-apk".toByteArray(),
                ),
            ),
        )
        try {
            val result = engine(server).download(
                update(localUrl(server, "/cdn.apk"), apk, AndroidUpdateSource.CDN),
            )
            assertTrue(result is AndroidUpdateState.Failed)
            assertTrue((result as AndroidUpdateState.Failed).message.contains("fallback-release-mismatch"))
            assertEquals(2, server.requestCount)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun corruptDownloadIsDeletedBeforeInstallerReadiness() = runTest {
        val server = MockWebServer()
        val expected = "expected-apk".toByteArray()
        val corrupt = "corrupted-ap".toByteArray()
        server.start()
        server.enqueue(MockResponse().setResponseCode(200).setBody(okio.Buffer().write(corrupt)))
        try {
            val result = engine(server, fallback = null).download(
                update(localUrl(server, "/cdn.apk"), expected, AndroidUpdateSource.GITHUB),
            )
            assertTrue(result is AndroidUpdateState.Failed)
            assertFalse(
                temporaryFolder.root.walkTopDown().any {
                    it.isFile && (it.extension == "apk" || it.extension == "partial")
                },
            )
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun partialDownloadResumesWithRange() = runTest {
        val server = MockWebServer()
        val apk = "0123456789abcdef".toByteArray()
        server.start()
        val update = update(localUrl(server, "/github.apk"), apk, AndroidUpdateSource.GITHUB)
        val root = File(temporaryFolder.root, "${update.channel}/${update.versionCode}")
        root.mkdirs()
        File(root, "OpenDrSai-Android-v${update.version}.apk.partial")
            .writeBytes(apk.copyOfRange(0, 6))
        server.enqueue(
            MockResponse()
                .setResponseCode(206)
                .setHeader("Content-Range", "bytes 6-${apk.lastIndex}/${apk.size}")
                .setBody(okio.Buffer().write(apk.copyOfRange(6, apk.size))),
        )
        try {
            val result = engine(server, fallback = null).download(update)
            assertTrue(result is AndroidUpdateState.Ready)
            assertEquals("bytes=6-", server.takeRequest().getHeader("Range"))
        } finally {
            server.shutdown()
        }
    }

    private fun engine(
        server: MockWebServer,
        fallback: String? = localUrl(server, "/fallback.json"),
    ) = AndroidUpdateDownloadEngine(
        cacheRoot = temporaryFolder.root,
        channel = "beta",
        fallbackManifestUrl = fallback,
        allowInsecureLocal = true,
        http = OkHttpClient(),
        verifier = { _, _ -> true },
    )

    private fun update(
        apkUrl: String,
        bytes: ByteArray,
        source: AndroidUpdateSource,
    ) = AndroidApkUpdate(
        schemaVersion = 1,
        platform = "android",
        channel = "beta",
        version = "1.5.3",
        versionCode = 10503,
        publishedAt = "2026-07-26T00:00:00Z",
        minimumSupportedVersion = "1.5.0",
        mandatory = false,
        apkUrl = apkUrl,
        sizeBytes = bytes.size.toLong(),
        sha256 = sha256(bytes),
        signingCertSha256 = "b".repeat(64),
        releaseNotesUrl = null,
        source = source,
    )

    private fun manifest(apkUrl: String, bytes: ByteArray): String = """
        {
          "schemaVersion": 1,
          "platform": "android",
          "channel": "beta",
          "version": "1.5.3",
          "versionCode": 10503,
          "publishedAt": "2026-07-26T00:00:00Z",
          "minimumSupportedVersion": "1.5.0",
          "mandatory": false,
          "apk": {
            "url": "$apkUrl",
            "sizeBytes": ${bytes.size},
            "sha256": "${sha256(bytes)}",
            "signingCertSha256": "${"b".repeat(64)}"
          }
        }
    """.trimIndent()

    private fun localUrl(server: MockWebServer, path: String): String =
        server.url(path).newBuilder().host("127.0.0.1").build().toString()

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
