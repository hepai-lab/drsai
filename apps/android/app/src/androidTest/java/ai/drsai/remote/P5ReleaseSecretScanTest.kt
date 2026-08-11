package ai.drsai.remote

import android.content.pm.ApplicationInfo
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import android.os.Process
import android.util.Base64
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith

/** Endpoint-local P5 scan. Raw app data and logs never leave the device. */
@RunWith(AndroidJUnit4::class)
class P5ReleaseSecretScanTest {
    @Test
    fun installedArtifactAndPrivateSurfacesContainNoBoundaryCanary() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        assumeFalse(
            "P5 endpoint scan runs only against a non-debuggable artifact",
            (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
        )
        val canaries = List(4) { "p5-${UUID.randomUUID()}-${UUID.randomUUID()}" }
        val variants = canaries.flatMap(::variants).distinct().map(String::toByteArray)
        val preferences = EncryptedSharedPreferences.create(
            context,
            "p5_release_secret_probe",
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        preferences.edit().putString("probe", canaries.first()).commit()
        Log.i("P5SecretScan", "boundary probe ${sha256(canaries.first().toByteArray()).take(12)}")

        val sentinel = context.getDatabasePath("p5-secret-scan-sentinel.db")
        sentinel.parentFile?.mkdirs()
        SQLiteDatabase.openOrCreateDatabase(sentinel, null).use { db ->
            db.execSQL("CREATE TABLE IF NOT EXISTS sentinel (value TEXT NOT NULL)")
            db.execSQL("INSERT INTO sentinel(value) VALUES ('prepared')")
        }
        try {
            val apk = File(context.applicationInfo.sourceDir)
            val apkStats = scanFiles(listOf(apk), variants, "android_apk")
            val roomRoot = context.getDatabasePath("opendrsai.db").parentFile
                ?: error("p5_android_room_root_missing")
            val roomStats = scanFiles(roomRoot.walkTopDown().filter(File::isFile).toList(), variants, "android_room")
            val backupFiles = listOf(context.filesDir, context.noBackupFilesDir,
                File(context.applicationInfo.dataDir, "shared_prefs"))
                .flatMap { root -> if (root.exists()) root.walkTopDown().filter(File::isFile).toList() else emptyList() }
            val backupStats = scanFiles(backupFiles, variants, "android_backup")
            val logBytes = instrumentation.uiAutomation.executeShellCommand(
                "logcat -d --pid=${Process.myPid()}",
            ).use { descriptor -> android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).readBytes() }
            require(logBytes.isNotEmpty()) { "p5_android_logs_empty" }
            requireNoVariant(logBytes, variants, "android_logs")
            val sources = JSONArray()
                .put(apkStats)
                .put(JSONObject().put("name", "android_logs").put("status", "clean")
                    .put("bytes_scanned", logBytes.size).put("files_scanned", 1))
                .put(roomStats)
                .put(backupStats)
            val report = JSONObject()
                .put("schema_version", "p5-android-endpoint/1")
                .put("passed", true)
                .put("matches", 0)
                .put("physical", isPhysicalDevice())
                .put("debuggable", false)
                .put("backup_disabled", (context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP) == 0)
                .put("artifact_sha256", sha256(apk.readBytes()))
                .put("canary_count", canaries.size)
                .put("sources", sources)
            assertEquals(4, sources.length())
            val encoded = report.toString()
            println("P5_ANDROID_SECRET_REPORT=$encoded")
            instrumentation.sendStatus(0, Bundle().apply { putString("p5AndroidSecretReport", encoded) })
        } finally {
            preferences.edit().clear().commit()
            context.deleteSharedPreferences("p5_release_secret_probe")
            listOf(sentinel, File(sentinel.path + "-wal"), File(sentinel.path + "-shm")).forEach(File::delete)
        }
    }

    private fun scanFiles(files: List<File>, forbidden: List<ByteArray>, name: String): JSONObject {
        val readable = files.filter { it.isFile && it.canRead() }
        require(readable.isNotEmpty()) { "p5_${name}_empty" }
        var bytes = 0L
        readable.forEach { file ->
            val value = file.readBytes()
            bytes += value.size
            requireNoVariant(value, forbidden, name)
        }
        require(bytes > 0) { "p5_${name}_empty" }
        return JSONObject().put("name", name).put("status", "clean")
            .put("bytes_scanned", bytes).put("files_scanned", readable.size)
    }

    private fun requireNoVariant(value: ByteArray, variants: List<ByteArray>, source: String) {
        require(variants.none { value.containsSubsequence(it) }) { "p5_android_secret_match:$source" }
    }

    private fun variants(value: String): List<String> {
        val bytes = value.toByteArray()
        return listOf(value, value.lowercase(), java.net.URLEncoder.encode(value, "UTF-8"),
            Base64.encodeToString(bytes, Base64.NO_WRAP),
            Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING),
            bytes.joinToString("") { "%02x".format(it) })
    }

    private fun isPhysicalDevice(): Boolean {
        val fingerprint = android.os.Build.FINGERPRINT.lowercase()
        val model = android.os.Build.MODEL.lowercase()
        val product = android.os.Build.PRODUCT.lowercase()
        val hardware = android.os.Build.HARDWARE.lowercase()
        return !fingerprint.startsWith("generic") && !fingerprint.contains("emulator") &&
            !model.contains("google_sdk") && !model.contains("emulator") &&
            !product.contains("sdk") && hardware !in setOf("goldfish", "ranchu", "vbox86")
    }

    private fun sha256(value: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(value).joinToString("") { "%02x".format(it) }

    private fun ByteArray.containsSubsequence(needle: ByteArray): Boolean {
        if (needle.isEmpty() || needle.size > size) return false
        return (0..size - needle.size).any { offset ->
            needle.indices.all { index -> this[offset + index] == needle[index] }
        }
    }
}
