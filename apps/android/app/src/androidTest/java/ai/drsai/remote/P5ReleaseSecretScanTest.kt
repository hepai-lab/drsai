package ai.drsai.remote

import ai.drsai.remote.remote.security.StreamingBytePatternScanner
import android.content.pm.ApplicationInfo
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import android.os.Process
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
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
        val canaryRunId = InstrumentationRegistry.getArguments().getString("p5CanaryRunId")
            ?.takeIf { it.matches(Regex("[A-Za-z0-9._:-]{8,128}")) }
            ?: error("p5_canary_run_id_invalid")
        val canaries = List(4) { index ->
            "p5-canary-v1-" + sha256("opendrsai-p5-secret-canary/1\u0000$canaryRunId\u0000$index".toByteArray())
        }
        val canarySetSha256 = sha256(canaries.sorted().joinToString("\n").toByteArray())
        val expectedCanarySetSha256 = InstrumentationRegistry.getArguments()
            .getString("p5CanarySetSha256")
            ?.takeIf { it.matches(Regex("[0-9a-f]{64}")) }
            ?: error("p5_canary_set_digest_invalid")
        require(canarySetSha256 == expectedCanarySetSha256) { "p5_canary_derivation_drift" }
        val variants = canaries.flatMap(::variants).distinct().map(String::toByteArray)
        val keyAlias = "p5_release_secret_probe_key"
        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        keyGenerator.init(KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        val key = keyGenerator.generateKey()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val encryptedProbe = cipher.doFinal(canaries.first().toByteArray())
        val preferences = context.getSharedPreferences("p5_release_secret_probe", 0)
        preferences.edit().putString(
            "probe",
            Base64.encodeToString(cipher.iv + encryptedProbe, Base64.NO_WRAP),
        ).commit()
        val decrypt = Cipher.getInstance("AES/GCM/NoPadding")
        decrypt.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, cipher.iv))
        require(decrypt.doFinal(encryptedProbe).contentEquals(canaries.first().toByteArray())) {
            "p5_android_keystore_roundtrip_failed"
        }
        Log.i("P5SecretScan", "boundary probe ${sha256(canaries.first().toByteArray()).take(12)}")

        val sentinel = context.getDatabasePath("p5-secret-scan-sentinel.db")
        sentinel.parentFile?.mkdirs()
        val roomCanaryDigest = sha256(canaries[1].toByteArray())
        SQLiteDatabase.openOrCreateDatabase(sentinel, null).use { db ->
            db.execSQL("CREATE TABLE IF NOT EXISTS sentinel (value TEXT NOT NULL)")
            db.execSQL("DELETE FROM sentinel")
            db.execSQL("INSERT INTO sentinel(value) VALUES (?)", arrayOf(roomCanaryDigest))
            db.rawQuery("SELECT value FROM sentinel", null).use { cursor ->
                require(cursor.moveToFirst() && cursor.getString(0) == roomCanaryDigest) {
                    "p5_android_room_hash_assertion_failed"
                }
            }
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
            val logScan = instrumentation.uiAutomation.executeShellCommand(
                "logcat -d --pid=${Process.myPid()}",
            ).use { descriptor ->
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { input ->
                    StreamingBytePatternScanner(variants).scan(input)
                }
            }
            require(logScan.bytesScanned > 0) { "p5_android_logs_empty" }
            require(!logScan.matched) { "p5_android_secret_match:android_logs" }
            val sources = JSONArray()
                .put(apkStats)
                .put(JSONObject().put("name", "android_logs").put("status", "clean")
                    .put("bytes_scanned", logScan.bytesScanned).put("files_scanned", 1))
                .put(roomStats)
                .put(backupStats)
            val report = JSONObject()
                .put("schema_version", "p5-android-endpoint/1")
                .put("passed", true)
                .put("matches", 0)
                .put("physical", isPhysicalDevice())
                .put("debuggable", false)
                .put("backup_disabled", (context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP) == 0)
                .put("artifact_sha256", sha256(apk))
                .put("canary_count", canaries.size)
                .put("canary_set_sha256", canarySetSha256)
                .put("storage_assertions", JSONObject()
                    .put("android_logs", "sha256_only")
                    .put("android_room", "sha256_only")
                    .put("android_backup", "keystore_encrypted_only"))
                .put("sources", sources)
            assertEquals(4, sources.length())
            val encoded = report.toString()
            println("P5_ANDROID_SECRET_REPORT=$encoded")
            instrumentation.sendStatus(0, Bundle().apply { putString("p5AndroidSecretReport", encoded) })
        } finally {
            preferences.edit().clear().commit()
            context.deleteSharedPreferences("p5_release_secret_probe")
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(keyAlias)
            listOf(sentinel, File(sentinel.path + "-wal"), File(sentinel.path + "-shm")).forEach(File::delete)
        }
    }

    private fun scanFiles(files: List<File>, forbidden: List<ByteArray>, name: String): JSONObject {
        val readable = files.filter { it.isFile && it.canRead() }
        require(readable.isNotEmpty()) { "p5_${name}_empty" }
        val scanner = StreamingBytePatternScanner(forbidden)
        var bytes = 0L
        readable.forEach { file ->
            bytes += file.length()
            file.inputStream().buffered().use { input ->
                require(!scanner.contains(input)) { "p5_android_secret_match:$name" }
            }
        }
        require(bytes > 0) { "p5_${name}_empty" }
        return JSONObject().put("name", name).put("status", "clean")
            .put("bytes_scanned", bytes).put("files_scanned", readable.size)
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

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        file.inputStream().buffered().use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

}
