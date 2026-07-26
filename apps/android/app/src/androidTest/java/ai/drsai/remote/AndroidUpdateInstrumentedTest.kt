package ai.drsai.remote

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.AndroidApkUpdate
import ai.drsai.remote.data.AndroidUpdateSource
import ai.drsai.remote.data.AndroidUpdateInstallPolicy
import ai.drsai.remote.data.AndroidUpdateState
import ai.drsai.remote.data.AndroidUpdateStore
import ai.drsai.remote.data.ApkVerifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class AndroidUpdateInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun installedApkPassesPackageVersionAndSigningChainVerification() {
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES,
        )
        val sourceApk = File(context.applicationInfo.sourceDir)
        val candidate = File(context.cacheDir, "updates/test/${sourceApk.name}")
        candidate.parentFile?.mkdirs()
        sourceApk.copyTo(candidate, overwrite = true)
        val versionCode = if (Build.VERSION.SDK_INT >= 28) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
        val cert = if (Build.VERSION.SDK_INT >= 28) {
            packageInfo.signingInfo!!.apkContentsSigners.orEmpty().first()
        } else {
            @Suppress("DEPRECATION")
            packageInfo.signatures.orEmpty().first()
        }
        val update = AndroidApkUpdate(
            schemaVersion = 1,
            platform = "android",
            channel = "dev",
            version = packageInfo.versionName!!,
            versionCode = versionCode,
            publishedAt = "2026-07-26T00:00:00Z",
            minimumSupportedVersion = "0.0.0",
            mandatory = false,
            apkUrl = "https://download-opendrsai.ihep.ac.cn/releases/test/android/${candidate.name}",
            sizeBytes = candidate.length(),
            sha256 = sha256(candidate),
            signingCertSha256 = sha256(cert.toByteArray()),
            releaseNotesUrl = null,
            source = AndroidUpdateSource.TEST,
        )

        val verifier = ApkVerifier(context)
        assertTrue(verifier.verify(candidate, update))
        assertFalse(verifier.verify(candidate, update.copy(versionCode = versionCode + 1)))
        assertFalse(verifier.verify(candidate, update.copy(version = "99.99.99")))
        assertFalse(verifier.verify(candidate, update.copy(signingCertSha256 = "0".repeat(64))))
    }

    @Test
    fun installerIntentUsesReadOnlyFileProviderUri() {
        val apk = File(context.cacheDir, "updates/test/installer-test.apk").apply {
            parentFile?.mkdirs()
            writeBytes(byteArrayOf(0x50, 0x4b))
        }
        val intent = ApkVerifier(context).installIntent(apk)

        assertEquals(Intent.ACTION_INSTALL_PACKAGE, intent.action)
        assertEquals("content", intent.data?.scheme)
        assertEquals("${context.packageName}.files", intent.data?.authority)
        assertEquals("application/vnd.android.package-archive", intent.type)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun unknownSourcesPermissionIntentIsScopedToOpenDrSai() {
        val intent = AndroidUpdateInstallPolicy.permissionIntent(context)
        assertEquals(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, intent.action)
        assertEquals("package", intent.data?.scheme)
        assertEquals(context.packageName, intent.data?.schemeSpecificPart)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun lastUpdateCheckPersistsSourceVersionAndResult() {
        val update = AndroidApkUpdate(
            schemaVersion = 1,
            platform = "android",
            channel = "dev",
            version = "9.8.7",
            versionCode = 90807,
            publishedAt = "2026-07-26T00:00:00Z",
            minimumSupportedVersion = "1.0.0",
            mandatory = false,
            apkUrl = "https://download-opendrsai.ihep.ac.cn/releases/v9.8.7/android/OpenDrSai-Android-v9.8.7.apk",
            sizeBytes = 123,
            sha256 = "a".repeat(64),
            signingCertSha256 = "b".repeat(64),
            releaseNotesUrl = null,
            source = AndroidUpdateSource.GITHUB,
        )
        val store = AndroidUpdateStore(context)
        store.recordCheck(AndroidUpdateState.Available(update), nowEpochMs = 123456789L)

        val record = store.lastCheck()!!
        assertEquals(123456789L, record.checkedAtEpochMs)
        assertEquals("available", record.result)
        assertEquals(AndroidUpdateSource.GITHUB, record.source)
        assertEquals("9.8.7", record.targetVersion)
        assertEquals(90807L, record.targetVersionCode)
    }

    private fun sha256(file: File): String = sha256(file.readBytes())

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
