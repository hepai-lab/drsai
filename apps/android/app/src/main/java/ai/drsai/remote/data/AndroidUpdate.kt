package ai.drsai.remote.data

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.annotation.SuppressLint
import android.os.Build
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.net.URI
import java.util.concurrent.TimeUnit

enum class AndroidUpdateSource {
    CDN,
    GITHUB,
    TEST,
}

data class AndroidUpdateManifestSource(
    val source: AndroidUpdateSource,
    val url: String,
)

data class InstalledAndroidVersion(
    val versionName: String,
    val versionCode: Long,
)

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
    val source: AndroidUpdateSource = AndroidUpdateSource.CDN,
    val manifestUrl: String? = null,
)

sealed interface AndroidUpdateState {
    data object Idle : AndroidUpdateState
    data object Checking : AndroidUpdateState
    data class Available(val update: AndroidApkUpdate) : AndroidUpdateState
    data class Downloading(val update: AndroidApkUpdate, val progress: Int) : AndroidUpdateState
    data class Verifying(val update: AndroidApkUpdate) : AndroidUpdateState
    data class Ready(val update: AndroidApkUpdate, val apk: File) : AndroidUpdateState
    data class PermissionRequired(val update: AndroidApkUpdate, val apk: File) : AndroidUpdateState
    data class Installing(val update: AndroidApkUpdate) : AndroidUpdateState
    data class Installed(val version: String, val versionCode: Long) : AndroidUpdateState
    data class Cancelled(val update: AndroidApkUpdate?) : AndroidUpdateState
    data class Failed(val code: String, val message: String, val update: AndroidApkUpdate? = null) : AndroidUpdateState
}

internal enum class AndroidUpdateStage {
    IDLE,
    CHECKING,
    AVAILABLE,
    DOWNLOADING,
    VERIFYING,
    READY,
    PERMISSION_REQUIRED,
    INSTALLING,
    INSTALLED,
    CANCELLED,
    FAILED,
}

internal object AndroidUpdateStateMachine {
    fun stage(state: AndroidUpdateState): AndroidUpdateStage = when (state) {
        AndroidUpdateState.Idle -> AndroidUpdateStage.IDLE
        AndroidUpdateState.Checking -> AndroidUpdateStage.CHECKING
        is AndroidUpdateState.Available -> AndroidUpdateStage.AVAILABLE
        is AndroidUpdateState.Downloading -> AndroidUpdateStage.DOWNLOADING
        is AndroidUpdateState.Verifying -> AndroidUpdateStage.VERIFYING
        is AndroidUpdateState.Ready -> AndroidUpdateStage.READY
        is AndroidUpdateState.PermissionRequired -> AndroidUpdateStage.PERMISSION_REQUIRED
        is AndroidUpdateState.Installing -> AndroidUpdateStage.INSTALLING
        is AndroidUpdateState.Installed -> AndroidUpdateStage.INSTALLED
        is AndroidUpdateState.Cancelled -> AndroidUpdateStage.CANCELLED
        is AndroidUpdateState.Failed -> AndroidUpdateStage.FAILED
    }

    fun canTransition(from: AndroidUpdateState, to: AndroidUpdateState): Boolean {
        val before = stage(from)
        val after = stage(to)
        if (before == after && before == AndroidUpdateStage.DOWNLOADING) return true
        return after in allowed.getValue(before)
    }

    private val allowed = mapOf(
        AndroidUpdateStage.IDLE to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.READY,
            AndroidUpdateStage.INSTALLED,
        ),
        AndroidUpdateStage.CHECKING to setOf(
            AndroidUpdateStage.IDLE,
            AndroidUpdateStage.AVAILABLE,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.AVAILABLE to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.DOWNLOADING,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.DOWNLOADING to setOf(
            AndroidUpdateStage.VERIFYING,
            AndroidUpdateStage.CANCELLED,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.VERIFYING to setOf(
            AndroidUpdateStage.DOWNLOADING,
            AndroidUpdateStage.READY,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.READY to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.PERMISSION_REQUIRED,
            AndroidUpdateStage.INSTALLING,
            AndroidUpdateStage.INSTALLED,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.PERMISSION_REQUIRED to setOf(
            AndroidUpdateStage.PERMISSION_REQUIRED,
            AndroidUpdateStage.INSTALLING,
            AndroidUpdateStage.READY,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.INSTALLING to setOf(
            AndroidUpdateStage.READY,
            AndroidUpdateStage.INSTALLED,
            AndroidUpdateStage.FAILED,
        ),
        AndroidUpdateStage.INSTALLED to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.IDLE,
        ),
        AndroidUpdateStage.CANCELLED to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.DOWNLOADING,
        ),
        AndroidUpdateStage.FAILED to setOf(
            AndroidUpdateStage.CHECKING,
            AndroidUpdateStage.DOWNLOADING,
            AndroidUpdateStage.READY,
        ),
    )
}

internal object AndroidUpdatePolicy {
    private val hosts = setOf(
        "download-opendrsai.ihep.ac.cn",
        "github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )

    fun parseManifest(
        raw: String,
        allowInsecureLocal: Boolean = false,
        source: AndroidUpdateSource = AndroidUpdateSource.CDN,
        manifestUrl: String? = null,
    ): AndroidApkUpdate {
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
            source = source,
            manifestUrl = manifestUrl,
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

    fun sameRelease(left: AndroidApkUpdate, right: AndroidApkUpdate): Boolean =
        left.channel == right.channel &&
            left.version == right.version &&
            left.versionCode == right.versionCode &&
            left.sizeBytes == right.sizeBytes &&
            left.sha256 == right.sha256 &&
            left.signingCertSha256 == right.signingCertSha256

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

internal class AndroidUpdateCheckEngine(
    private val sources: List<AndroidUpdateManifestSource>,
    private val channel: String,
    private val installedVersion: () -> InstalledAndroidVersion,
    private val allowInsecureLocal: Boolean,
    private val http: OkHttpClient,
) {
    suspend fun check(): AndroidUpdateState = withContext(Dispatchers.IO) {
        val failures = mutableListOf<String>()
        for (source in sources.distinctBy(AndroidUpdateManifestSource::url)) {
            try {
                val update = fetchManifest(source)
                if (update.channel != channel) error("channel-mismatch")
                val current = installedVersion()
                if (!AndroidUpdatePolicy.isNewer(current.versionCode, update.versionCode)) {
                    return@withContext AndroidUpdateState.Idle
                }
                return@withContext AndroidUpdateState.Available(
                    update.copy(
                        mandatory = update.mandatory ||
                            AndroidUpdatePolicy.isBelowMinimum(
                                current.versionName,
                                update.minimumSupportedVersion,
                            ),
                    ),
                )
            } catch (error: Throwable) {
                // A channel has exactly two independently hosted manifests.
                // The aggregate failure is reported only after both have failed.
                failures += "${source.source.name.lowercase()}:${error.message ?: error::class.java.simpleName}"
            }
        }
        AndroidUpdateState.Failed(
            "manifest-sources-failed",
            "无法从 CDN 或 GitHub 获取更新，请检查网络后重试 (${failures.joinToString()})",
        )
    }

    private fun fetchManifest(source: AndroidUpdateManifestSource): AndroidApkUpdate {
        AndroidUpdatePolicy.requireTrustedUrl(source.url, allowInsecureLocal)
        executeTrusted(
            Request.Builder()
                .url(source.url)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
                .build(),
        ).use { response ->
            if (!response.isSuccessful) error("manifest-http-${response.code}")
            val raw = response.body?.string() ?: error("manifest-empty")
            return AndroidUpdatePolicy.parseManifest(
                raw = raw,
                allowInsecureLocal = allowInsecureLocal,
                source = source.source,
                manifestUrl = source.url,
            )
        }
    }

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
}

internal class AndroidUpdateDownloadEngine(
    private val cacheRoot: File,
    private val channel: String,
    private val fallbackManifestUrl: String?,
    private val allowInsecureLocal: Boolean,
    private val http: OkHttpClient,
    private val verifier: (File, AndroidApkUpdate) -> Boolean,
    private val isCancelled: () -> Boolean = { false },
) {
    suspend fun download(
        requested: AndroidApkUpdate,
        onProgress: (Int) -> Unit = {},
        onVerifying: (AndroidApkUpdate) -> Unit = {},
    ): AndroidUpdateState = withContext(Dispatchers.IO) {
        val failures = mutableListOf<String>()
        try {
            return@withContext downloadOne(requested, onProgress, onVerifying)
        } catch (_: AndroidUpdateCancelledException) {
            return@withContext AndroidUpdateState.Cancelled(requested)
        } catch (error: Throwable) {
            failures += "${requested.source.name.lowercase()}:${error.message ?: "download-failed"}"
        }

        if (requested.source != AndroidUpdateSource.GITHUB && !fallbackManifestUrl.isNullOrBlank()) {
            try {
                val fallback = fetchFallbackManifest(fallbackManifestUrl)
                if (fallback.channel != channel) error("fallback-channel-mismatch")
                if (!AndroidUpdatePolicy.sameRelease(requested, fallback)) {
                    error("fallback-release-mismatch")
                }
                return@withContext downloadOne(fallback, onProgress, onVerifying)
            } catch (_: AndroidUpdateCancelledException) {
                return@withContext AndroidUpdateState.Cancelled(requested)
            } catch (error: Throwable) {
                failures += "github:${error.message ?: "download-failed"}"
            }
        }

        val timeout = failures.any { it.contains("timeout", ignoreCase = true) }
        AndroidUpdateState.Failed(
            code = if (timeout) "download-timeout" else "download-sources-failed",
            message = if (timeout) {
                "下载超时，已保留已下载部分，请重试继续"
            } else {
                "CDN 和 GitHub 均无法完成下载或校验 (${failures.joinToString()})"
            },
            update = requested,
        )
    }

    private fun downloadOne(
        update: AndroidApkUpdate,
        onProgress: (Int) -> Unit,
        onVerifying: (AndroidApkUpdate) -> Unit,
    ): AndroidUpdateState.Ready {
        val root = File(cacheRoot, "${update.channel}/${update.versionCode}").apply { mkdirs() }
        cleanupStale(root)
        val fileName = "OpenDrSai-Android-v${update.version}.apk"
        val partial = File(root, "$fileName.partial")
        val target = File(root, fileName)

        if (target.isFile && target.length() == update.sizeBytes) {
            onVerifying(update)
            if (sha256(target) == update.sha256 && verifier(target, update)) {
                return AndroidUpdateState.Ready(update, target)
            }
            target.delete()
        }

        if (partial.length() >= update.sizeBytes) partial.delete()
        val offset = partial.length().takeIf { it in 1 until update.sizeBytes } ?: 0L
        val builder = Request.Builder().url(update.apkUrl)
        if (offset > 0) builder.header("Range", "bytes=$offset-")

        executeTrusted(builder.build()).use { response ->
            if (!response.isSuccessful || response.body == null) {
                error("download-http-${response.code}")
            }
            val resumed = offset > 0 && response.code == 206
            if (!resumed && offset > 0) partial.delete()
            var received = if (resumed) offset else 0L
            response.body!!.byteStream().use { input ->
                FileOutputStream(partial, resumed).buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        if (isCancelled()) throw AndroidUpdateCancelledException()
                        received += count
                        if (received > update.sizeBytes) {
                            partial.delete()
                            error("size-overflow")
                        }
                        output.write(buffer, 0, count)
                        onProgress(
                            ((received * 100) / update.sizeBytes)
                                .coerceIn(0, 100)
                                .toInt(),
                        )
                    }
                }
            }
        }

        if (partial.length() != update.sizeBytes) error("size-mismatch")
        onVerifying(update)
        if (sha256(partial) != update.sha256) {
            partial.delete()
            error("hash-mismatch")
        }
        if (!verifier(partial, update)) {
            partial.delete()
            error("apk-verification-failed")
        }
        if (target.exists() && !target.delete()) error("update-cache-delete-failed")
        if (!partial.renameTo(target)) error("update-cache-failed")
        return AndroidUpdateState.Ready(update, target)
    }

    private fun cleanupStale(activeRoot: File) {
        val cutoff = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(7)
        cacheRoot.walkTopDown()
            .maxDepth(2)
            .filter { candidate ->
                candidate.isDirectory &&
                    candidate != cacheRoot &&
                    candidate != activeRoot &&
                    candidate.parentFile?.parentFile == cacheRoot &&
                    candidate.lastModified() in 1 until cutoff
            }
            .forEach(File::deleteRecursively)
    }

    private fun fetchFallbackManifest(url: String): AndroidApkUpdate {
        AndroidUpdatePolicy.requireTrustedUrl(url, allowInsecureLocal)
        executeTrusted(
            Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-cache")
                .build(),
        ).use { response ->
            if (!response.isSuccessful) error("fallback-manifest-http-${response.code}")
            return AndroidUpdatePolicy.parseManifest(
                raw = response.body?.string() ?: error("fallback-manifest-empty"),
                allowInsecureLocal = allowInsecureLocal,
                source = AndroidUpdateSource.GITHUB,
                manifestUrl = url,
            )
        }
    }

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
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (count > 0) digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

private class AndroidUpdateCancelledException : RuntimeException("download-cancelled")

internal object AndroidUpdateInstallPolicy {
    fun requiresUnknownSourcesPermission(
        sdkInt: Int,
        canRequestPackageInstalls: Boolean,
    ): Boolean = sdkInt >= Build.VERSION_CODES.O && !canRequestPackageInstalls

    fun permissionIntent(context: Context): Intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

class AndroidUpdateRepository(
    private val context: Context,
    private val manifestUrl: String,
    private val fallbackManifestUrl: String? = null,
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
    suspend fun check(): AndroidUpdateState {
        val sources = buildList {
            add(AndroidUpdateManifestSource(sourceFor(manifestUrl, primary = true), manifestUrl))
            fallbackManifestUrl?.takeIf { it.isNotBlank() && it != manifestUrl }?.let {
                add(AndroidUpdateManifestSource(sourceFor(it, primary = false), it))
            }
        }
        return AndroidUpdateCheckEngine(
            sources = sources,
            channel = channel,
            installedVersion = {
                val info = packageInfo()
                InstalledAndroidVersion(
                    versionName = info.versionName ?: "0.0.0",
                    versionCode = versionCode(info),
                )
            },
            allowInsecureLocal = allowInsecureLocal,
            http = http,
        ).check()
    }

    private fun sourceFor(url: String, primary: Boolean): AndroidUpdateSource {
        val host = runCatching { URI(url).host?.lowercase() }.getOrNull()
        return when {
            host == "download-opendrsai.ihep.ac.cn" -> AndroidUpdateSource.CDN
            host == "github.com" || host?.endsWith(".githubusercontent.com") == true ->
                AndroidUpdateSource.GITHUB
            allowInsecureLocal -> AndroidUpdateSource.TEST
            primary -> AndroidUpdateSource.CDN
            else -> AndroidUpdateSource.GITHUB
        }
    }

    suspend fun download(
        update: AndroidApkUpdate,
        onProgress: (Int) -> Unit = {},
        onVerifying: (AndroidApkUpdate) -> Unit = {},
        isCancelled: () -> Boolean = { false },
    ): AndroidUpdateState = AndroidUpdateDownloadEngine(
        cacheRoot = File(context.cacheDir, "updates"),
        channel = channel,
        fallbackManifestUrl = fallbackManifestUrl,
        allowInsecureLocal = allowInsecureLocal,
        http = http,
        verifier = { file, candidate -> ApkVerifier(context).verify(file, candidate) },
        isCancelled = isCancelled,
    ).download(update, onProgress, onVerifying)

    @SuppressLint("NewApi")
    fun packageInfo(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)

    private fun versionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

}

class ApkVerifier(private val context: Context) {
    @SuppressLint("NewApi")
    fun verify(file: File, update: AndroidApkUpdate): Boolean {
        val packageManager = context.packageManager
        val candidate = packageManager.getPackageArchiveInfo(
            file.absolutePath,
            PackageManager.GET_SIGNING_CERTIFICATES,
        ) ?: return false
        val installed = runCatching {
            packageManager.getPackageInfo(
                context.packageName,
                PackageManager.GET_SIGNING_CERTIFICATES,
            )
        }.getOrNull() ?: return false
        val actualVersionCode = versionCode(candidate)
        if (
            candidate.packageName != context.packageName ||
            actualVersionCode != update.versionCode ||
            candidate.versionName != update.version
        ) return false

        if (Build.VERSION.SDK_INT >= 28) {
            val candidateSigning = candidate.signingInfo ?: return false
            val installedSigning = installed.signingInfo ?: return false
            val candidateCurrent = candidateSigning.apkContentsSigners
                .orEmpty()
                .map(::certificateSha256)
                .toSet()
            val installedCurrent = installedSigning.apkContentsSigners
                .orEmpty()
                .map(::certificateSha256)
                .toSet()
            if (update.signingCertSha256 !in candidateCurrent) return false
            if (candidateCurrent == installedCurrent) return true
            if (candidateSigning.hasMultipleSigners() || installedSigning.hasMultipleSigners()) {
                return false
            }
            val candidateHistory = candidateSigning.signingCertificateHistory
                .orEmpty()
                .map(::certificateSha256)
                .toSet()
            return installedCurrent.any(candidateHistory::contains)
        }

        @Suppress("DEPRECATION")
        val candidateCurrent = candidate.signatures.orEmpty().map(::certificateSha256).toSet()
        @Suppress("DEPRECATION")
        val installedCurrent = installed.signatures.orEmpty().map(::certificateSha256).toSet()
        return update.signingCertSha256 in candidateCurrent &&
            candidateCurrent == installedCurrent
    }

    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode
        else @Suppress("DEPRECATION") info.versionCode.toLong()

    private fun certificateSha256(signature: android.content.pm.Signature): String =
        MessageDigest.getInstance("SHA-256")
            .digest(signature.toByteArray())
            .joinToString("") { "%02x".format(it) }

    fun installIntent(file: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        return Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }
}
