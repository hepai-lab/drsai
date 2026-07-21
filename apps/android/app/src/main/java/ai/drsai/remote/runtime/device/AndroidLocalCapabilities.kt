package ai.drsai.remote.runtime.device

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import androidx.documentfile.provider.DocumentFile
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.PromptLayer
import ai.drsai.remote.runtime.context.ProjectInstructionVersion
import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import ai.drsai.remote.runtime.tools.ToolDefinition
import ai.drsai.remote.runtime.tools.ToolRegistry
import ai.drsai.remote.runtime.tools.ToolRisk
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.security.MessageDigest
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

data class SafeDeviceSnapshot(
    val sdk: Int,
    val locale: String,
    val timeZone: String,
    val networkType: String,
)

class SafeDeviceInfoProvider(private val context: Context) {
    fun snapshot(): SafeDeviceSnapshot {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val capabilities = manager?.activeNetwork?.let(manager::getNetworkCapabilities)
        val networkType = when {
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "wifi"
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "cellular"
            capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ethernet"
            capabilities != null -> "other"
            else -> "offline"
        }
        return SafeDeviceSnapshot(
            sdk = Build.VERSION.SDK_INT,
            locale = Locale.getDefault().toLanguageTag(),
            timeZone = java.util.TimeZone.getDefault().id,
            networkType = networkType,
        )
    }
}

class SafWorkspaceStore(private val context: Context) {
    private val preferences = context.getSharedPreferences("opendrsai_saf_workspaces", Context.MODE_PRIVATE)

    fun grant(subject: String, uri: Uri) {
        require(uri.scheme == "content") { "saf_content_uri_required" }
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        preferences.edit().putString(key(subject), uri.toString()).apply()
    }

    fun uri(subject: String): Uri? = preferences.getString(key(subject), null)?.let(Uri::parse)

    fun clear(subject: String) {
        uri(subject)?.let { granted ->
            runCatching {
                context.contentResolver.releasePersistableUriPermission(
                    granted,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
            }
        }
        preferences.edit().remove(key(subject)).apply()
    }

    private fun key(subject: String): String = MessageDigest.getInstance("SHA-256")
        .digest(subject.toByteArray()).joinToString("") { "%02x".format(it) }
}

data class SafEntry(val name: String, val directory: Boolean, val size: Long, val mimeType: String?)

class SafWorkspaceGateway(private val context: Context, private val store: SafWorkspaceStore) {
    fun list(subject: String, relativePath: String = ""): List<SafEntry> =
        resolve(subject, relativePath, requireDirectory = true).listFiles().map {
            SafEntry(it.name.orEmpty(), it.isDirectory, it.length(), it.type)
        }.sortedWith(compareByDescending<SafEntry> { it.directory }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })

    fun read(subject: String, relativePath: String, maxBytes: Int = 256_000): ByteArray {
        require(maxBytes in 1..1_000_000) { "saf_read_limit_invalid" }
        val file = resolve(subject, relativePath, requireDirectory = false)
        require(file.isFile) { "saf_file_required" }
        require(file.length() <= maxBytes) { "saf_file_too_large" }
        return context.contentResolver.openInputStream(file.uri)?.use { input -> readBounded(input, maxBytes) }
            ?: error("saf_open_failed")
    }

    fun search(subject: String, query: String, limit: Int = 50): List<String> {
        require(query.isNotBlank() && query.length <= 100) { "saf_query_invalid" }
        require(limit in 1..100) { "saf_search_limit_invalid" }
        val root = root(subject)
        val results = mutableListOf<String>()
        fun visit(directory: DocumentFile, prefix: String, depth: Int) {
            if (depth > 8 || results.size >= limit) return
            directory.listFiles().forEach { child ->
                if (results.size >= limit) return@forEach
                val name = child.name.orEmpty()
                val path = if (prefix.isEmpty()) name else "$prefix/$name"
                if (name.contains(query, ignoreCase = true)) results += path
                if (child.isDirectory) visit(child, path, depth + 1)
            }
        }
        visit(root, "", 0)
        return results
    }

    fun write(subject: String, relativePath: String, bytes: ByteArray, approved: Boolean) {
        require(approved) { "saf_write_approval_required" }
        require(bytes.size <= 1_000_000) { "saf_write_too_large" }
        val parts = safeParts(relativePath)
        require(parts.isNotEmpty()) { "saf_file_path_required" }
        val parent = parts.dropLast(1).fold(root(subject)) { directory, name ->
            directory.findFile(name)?.takeIf(DocumentFile::isDirectory)
                ?: directory.createDirectory(name) ?: error("saf_directory_create_failed")
        }
        val name = parts.last()
        val temporaryName = ".$name.opendrsai-tmp"
        val backupName = ".$name.opendrsai-backup"
        parent.findFile(temporaryName)?.delete()
        parent.findFile(backupName)?.delete()
        val temporary = parent.createFile("application/octet-stream", temporaryName)
            ?: error("saf_temp_create_failed")
        var backup: DocumentFile? = null
        try {
            context.contentResolver.openOutputStream(temporary.uri, "wt")?.use { it.write(bytes) }
                ?: error("saf_write_failed")
            parent.findFile(name)?.let { original ->
                require(original.renameTo(backupName)) { "saf_backup_failed" }
                backup = parent.findFile(backupName) ?: error("saf_backup_missing")
            }
            if (!temporary.renameTo(name)) {
                backup?.renameTo(name)
                error("saf_atomic_rename_failed")
            }
            backup?.let { require(it.delete()) { "saf_backup_cleanup_failed" } }
        } catch (error: Throwable) {
            temporary.delete()
            if (parent.findFile(name) == null) backup?.renameTo(name)
            throw error
        }
    }

    fun projectInstructions(subject: String): List<PromptFragment> =
        listOf("AGENTS.md", "DRSAI.md", ".drsai/DRSAI.md").mapNotNull { path ->
            runCatching { read(subject, path, 64_000).decodeToString() }.getOrNull()
                ?.takeIf(String::isNotBlank)
                ?.let { PromptFragment(PromptLayer.PROJECT, it, "saf:$path", ProjectInstructionVersion.digest(it)) }
        }

    private fun resolve(subject: String, relativePath: String, requireDirectory: Boolean): DocumentFile {
        val result = safeParts(relativePath).fold(root(subject)) { current, part ->
            current.findFile(part) ?: error("saf_path_not_found")
        }
        if (requireDirectory) require(result.isDirectory) { "saf_directory_required" }
        return result
    }

    private fun root(subject: String): DocumentFile {
        val uri = store.uri(subject) ?: error("saf_workspace_not_granted")
        val persisted = context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
        require(persisted) { "saf_permission_missing" }
        return DocumentFile.fromTreeUri(context, uri)?.takeIf(DocumentFile::isDirectory)
            ?: error("saf_workspace_invalid")
    }

    companion object {
        internal fun readBounded(input: InputStream, maxBytes: Int): ByteArray {
            require(maxBytes > 0) { "saf_read_limit_invalid" }
            val output = ByteArrayOutputStream(minOf(maxBytes, 16_384))
            val buffer = ByteArray(8_192)
            var total = 0
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                total += read
                require(total <= maxBytes) { "saf_file_too_large" }
                output.write(buffer, 0, read)
            }
            return output.toByteArray()
        }

        fun safeParts(relativePath: String): List<String> {
            val normalized = relativePath.replace('\\', '/').trim('/')
            if (normalized.isEmpty()) return emptyList()
            val parts = normalized.split('/')
            require(parts.none { it.isBlank() || it == "." || it == ".." || '\u0000' in it }) {
                "saf_path_invalid"
            }
            return parts
        }
    }
}

fun registerAndroidDeviceTools(
    registry: ToolRegistry,
    deviceInfo: SafeDeviceInfoProvider,
    saf: SafWorkspaceGateway,
) {
    registry.register(
        ToolDefinition(
            "get_device_info", 1, "Get non-identifying Android environment information", ToolRisk.READ_ONLY,
            requiredCapabilities = setOf(RuntimeCapability.SAFE_DEVICE_INFO),
        ),
    ) { _, _ ->
        deviceInfo.snapshot().let {
            JSONObject().put("sdk", it.sdk).put("locale", it.locale)
                .put("time_zone", it.timeZone).put("network_type", it.networkType).toString()
        }
    }
    registry.register(
        ToolDefinition(
            "workspace.list", 1, "List the user-granted workspace", ToolRisk.READ_ONLY,
            requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
        ),
    ) { context, arguments ->
        JSONArray(saf.list(context.accountSubject, arguments.optString("path")).map {
            JSONObject().put("name", it.name).put("directory", it.directory).put("size", it.size).put("mime_type", it.mimeType)
        }).toString()
    }
    registry.register(
        ToolDefinition(
            "workspace.read", 1, "Read a text file in the user-granted workspace", ToolRisk.READ_ONLY,
            requiredArguments = setOf("path"), requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
        ),
    ) { context, arguments -> saf.read(context.accountSubject, arguments.getString("path")).decodeToString() }
    registry.register(
        ToolDefinition(
            "workspace.search", 1, "Search names in the user-granted workspace", ToolRisk.READ_ONLY,
            requiredArguments = setOf("query"), requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
        ),
    ) { context, arguments -> JSONArray(saf.search(context.accountSubject, arguments.getString("query"))).toString() }
    registry.register(
        ToolDefinition(
            "workspace.write", 1, "Write a file in the user-granted workspace", ToolRisk.EXTERNAL_WRITE,
            requiredArguments = setOf("path", "content"), requiredCapabilities = setOf(RuntimeCapability.SAF_WRITE),
        ),
    ) { context, arguments ->
        saf.write(
            context.accountSubject,
            arguments.getString("path"),
            arguments.getString("content").encodeToByteArray(),
            approved = context.approved,
        )
        JSONObject().put("written", true).toString()
    }
}

object ClipboardAccessPolicy {
    fun requireUserInitiated(userInitiated: Boolean) {
        require(userInitiated) { "clipboard_user_action_required" }
    }

    fun sanitizeForWrite(value: String, userInitiated: Boolean): String {
        requireUserInitiated(userInitiated)
        return SensitiveDataRedactor.redact(value).take(MAX_CLIPBOARD_CHARS)
    }

    private const val MAX_CLIPBOARD_CHARS = 100_000
}
