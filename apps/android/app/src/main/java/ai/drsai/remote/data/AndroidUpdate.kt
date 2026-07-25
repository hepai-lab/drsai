package ai.drsai.remote.data

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.annotation.SuppressLint
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.security.MessageDigest
import java.net.URI
import java.util.concurrent.TimeUnit

data class AndroidApkUpdate(
    val schemaVersion: Int,
    val platform: String,
    val channel: String,
    val version: String,
    val versionCode: Long,
    val publishedAt: String,
    val minimumSupportedVersion: String,
    val mandatory: Boolean,
    val apkUrl: String,
    val sizeBytes: Long,
    val sha256: String,
    val signingCertSha256: String,
    val releaseNotesUrl: String?,
)

sealed interface AndroidUpdateState {
    data object Idle : AndroidUpdateState
    data object Checking : AndroidUpdateState
    data class Available(val update: AndroidApkUpdate) : AndroidUpdateState
    data class Downloading(val update: AndroidApkUpdate, val progress: Int) : AndroidUpdateState
    data class Ready(val update: AndroidApkUpdate, val apk: File) : AndroidUpdateState
    data class Failed(val code: String, val message: String, val update: AndroidApkUpdate? = null) : AndroidUpdateState
}

internal object AndroidUpdatePolicy {
    private val hosts = setOf(
        "download-opendrsai.ihep.ac.cn",
        "github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )

    fun parseManifest(raw: String, allowInsecureLocal: Boolean = false): AndroidApkUpdate {
        if (raw.toByteArray(Charsets.UTF_8).size > 64 * 1024) error("manifest-too-large")
        val root = runCatching { JSONObject(raw) }.getOrElse { error("manifest-json") }
        require(root.optInt("schemaVersion", -1) == 1) { "manifest-schema" }
        require(root.optString("platform") == "android") { "manifest-platform" }
        val channel = root.optString("channel")
        require(channel == "stable" || channel == "beta" || channel == "dev") { "manifest-channel" }
        val apk = root.optJSONObject("apk") ?: error("manifest-apk")
        val version = root.optString("version").trim().also { require(SEMVER.matches(it)) { "invalid-version" } }
        val update = AndroidApkUpdate(
            schemaVersion = 1,
            platform = "android",
            channel = channel,
            version = version,
            versionCode = apkLong(root, "versionCode"),
            publishedAt = root.optString("publishedAt").also { require(it.isNotBlank()) { "manifest-date" } },
            minimumSupportedVersion = root.optString("minimumSupportedVersion", "0.0.0").also { require(SEMVER.matches(it)) { "invalid-minimum-version" } },
            mandatory = root.optBoolean("mandatory", false),
            apkUrl = apk.optString("url").also { requireTrustedUrl(it, allowInsecureLocal) },
            sizeBytes = apk.optLong("sizeBytes", -1).also { require(it in 1..512_000_000) { "manifest-size" } },
            sha256 = apk.optString("sha256").lowercase().also { require(HASH.matches(it)) { "manifest-hash" } },
            signingCertSha256 = apk.optString("signingCertSha256").lowercase().also { require(HASH.matches(it)) { "manifest-signature" } },
            releaseNotesUrl = root.optString("releaseNotesUrl").takeIf { it.isNotBlank() }
                ?.also { requireTrustedUrl(it, allowInsecureLocal) },
        )
        require(!update.apkUrl.contains("/latest/")) { "mutable-apk-url" }
        return update
    }

    fun requireTrustedUrl(raw: String, allowInsecureLocal: Boolean = false) {
        val url = runCatching { URI(raw) }.getOrElse { error("invalid-url") }
        if (allowInsecureLocal && url.scheme.equals("http", ignoreCase = true) &&
            url.host in setOf("10.0.2.2", "127.0.0.1", "localhost") && url.userInfo == null
        ) return
        require(url.scheme.equals("https", ignoreCase = true)) { "unsafe-url" }
        require(hosts.contains(url.host?.lowercase())) { "untrusted-host" }
        require(url.userInfo == null) { "unsafe-url" }
    }

    fun isNewer(currentCode: Long, candidateCode: Long): Boolean = candidateCode > currentCode

    fun isBelowMinimum(current: String, minimum: String): Boolean = compareSemver(current, minimum) < 0

    fun compareSemver(left: String, right: String): Int {
        val a = SEMVER.matchEntire(left) ?: error("invalid-version")
        val b = SEMVER.matchEntire(right) ?: error("invalid-version")
        for (i in 1..3) {
            val x = a.groupValues[i].toInt(); val y = b.groupValues[i].toInt()
            if (x != y) return x.compareTo(y)
        }
        return 0
    }

    private fun apkLong(root: JSONObject, key: String): Long {
        val apk = root.optJSONObject("apk") ?: error("manifest-apk")
        val value = if (key == "versionCode") root.optLong(key, -1) else apk.optLong(key, -1)
        require(value > 0) { "manifest-$key" }
        return value
    }

    private val SEMVER = Regex("(\\d+)\\.(\\d+)\\.(\\d+)(?:-[0-9A-Za-z.-]+)?")
    private val HASH = Regex("[a-f0-9]{64}")
}

class AndroidUpdateRepository(
    private val context: Context,
    private val manifestUrl: String,
    private val channel: String,
    private val allowInsecureLocal: Boolean = false,
    private val http: OkHttpClient = OkHttpClient.Builder()
        // GitHub Release 下载先经过 github.com，再跳转到 release-assets CDN。
        // 移动网络下首字节和 CDN 切换可能超过 30 秒；分段下载仍由 partial 文件保证可恢复。
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.MINUTES)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.MINUTES)
        .retryOnConnectionFailure(true)
        .followRedirects(false).build(),
) {
    suspend fun check(): AndroidUpdateState = withContext(Dispatchers.IO) {
        try {
            AndroidUpdatePolicy.requireTrustedUrl(manifestUrl, allowInsecureLocal)
            val response = executeTrusted(Request.Builder().url(manifestUrl).header("Accept", "application/json").build())
            if (!response.isSuccessful) return@withContext AndroidUpdateState.Failed("manifest-http", "更新清单请求失败（HTTP ${response.code}）")
            val update = AndroidUpdatePolicy.parseManifest(
                response.body?.string() ?: error("manifest-empty"),
                allowInsecureLocal,
            )
            if (update.channel != channel) return@withContext AndroidUpdateState.Failed("channel-mismatch", "更新渠道不匹配")
            val info = packageInfo()
            if (!AndroidUpdatePolicy.isNewer(versionCode(info), update.versionCode)) return@withContext AndroidUpdateState.Idle
            AndroidUpdateState.Available(update.copy(mandatory = update.mandatory || AndroidUpdatePolicy.isBelowMinimum(info.versionName ?: "0.0.0", update.minimumSupportedVersion)))
        } catch (e: Throwable) {
            AndroidUpdateState.Failed((e.message ?: "update-failed").substringBefore(':').ifBlank { "update-failed" }, e.message ?: "检查更新失败")
        }
    }

    suspend fun download(update: AndroidApkUpdate, onProgress: (Int) -> Unit = {}): AndroidUpdateState = withContext(Dispatchers.IO) {
        val root = File(context.cacheDir, "updates").apply { mkdirs() }
        val partial = File(root, "${update.version}.apk.partial")
        val target = File(root, "${update.version}.apk")
        try {
            val offset = partial.length().takeIf { it in 1 until update.sizeBytes } ?: 0L
            val builder = Request.Builder().url(update.apkUrl)
            if (offset > 0) builder.header("Range", "bytes=$offset-")
            val response = executeTrusted(builder.build())
            if (!response.isSuccessful || response.body == null) error("download-http-${response.code}")
            val resumed = offset > 0 && response.code == 206
            if (!resumed && offset > 0) partial.delete()
            val start = if (resumed) offset else 0L
            var received = start
            response.body!!.byteStream().use { input ->
                FileOutputStream(partial, resumed).buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    var count: Int
                    while (input.read(buffer).also { count = it } >= 0) {
                        if (count == 0) continue
                        output.write(buffer, 0, count); received += count
                        onProgress(((received * 100) / update.sizeBytes).coerceIn(0, 100).toInt())
                    }
                }
            }
            if (partial.length() != update.sizeBytes) error("size-mismatch")
            if (sha256(partial) != update.sha256) { partial.delete(); error("hash-mismatch") }
            val verified = ApkVerifier(context).verify(partial, update)
            if (!verified) { partial.delete(); error("apk-verification-failed") }
            if (target.exists()) target.delete()
            check(partial.renameTo(target)) { "update-cache-failed" }
            AndroidUpdateState.Ready(update, target)
        } catch (e: Throwable) {
            val timeout = e is InterruptedIOException || e.cause is InterruptedIOException ||
                e.message.orEmpty().contains("timeout", ignoreCase = true)
            if (timeout) {
                AndroidUpdateState.Failed("download-timeout", "下载超时，已保留已下载部分，请重试继续", update)
            } else {
                AndroidUpdateState.Failed(e.message ?: "download-failed", e.message ?: "下载更新失败", update)
            }
        }
    }

    @SuppressLint("NewApi")
    fun packageInfo(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)

    private fun versionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

    private fun executeTrusted(initial: Request): okhttp3.Response {
        var request = initial
        repeat(6) { index ->
            val response = http.newCall(request).execute()
            if (response.code !in setOf(301, 302, 303, 307, 308)) return response
            val location = response.header("Location") ?: error("redirect-missing")
            response.close()
            val next = URI(request.url.toString()).resolve(location).toString()
            AndroidUpdatePolicy.requireTrustedUrl(next, allowInsecureLocal)
            request = request.newBuilder().url(next).build()
            if (index == 5) error("redirect-limit")
        }
        error("redirect-limit")
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            var count: Int
            while (input.read(buffer).also { count = it } >= 0) if (count > 0) digest.update(buffer, 0, count)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

class ApkVerifier(private val context: Context) {
    @SuppressLint("NewApi")
    fun verify(file: File, update: AndroidApkUpdate): Boolean {
        val packageManager = context.packageManager
        val info = packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
        val actualVersionCode = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        if (info.packageName != context.packageName || actualVersionCode != update.versionCode) return false
        val signing = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") info.signatures
        val cert = signing?.firstOrNull() ?: return false
        val hash = MessageDigest.getInstance("SHA-256").digest(cert.toByteArray()).joinToString("") { "%02x".format(it) }
        return hash == update.signingCertSha256
    }

    fun installIntent(file: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
