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
import ai.drsai.remote.runtime.tools.ToolApprovalPreviewer
import ai.drsai.remote.runtime.tools.ToolRegistry
import ai.drsai.remote.runtime.tools.ToolRisk
import ai.drsai.remote.runtime.tools.objectToolSchema
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

    fun hasReadGrant(subject: String): Boolean = uri(subject)?.let { stored ->
        context.contentResolver.persistedUriPermissions.any { permission ->
            permission.uri == stored && permission.isReadPermission
        }
    } == true

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

object SafProjectInstructionPayload {
    private val candidates = setOf("saf:AGENTS.md", "saf:DRSAI.md", "saf:.drsai/DRSAI.md")
    private const val MAX_PROJECT_CHARS = 8_000

    fun authorized(granted: Boolean, load: () -> List<PromptFragment>): JSONObject =
        if (granted) agentFields(load()) else JSONObject()

    fun agentFields(values: List<PromptFragment>): JSONObject {
        val normalized = values.sortedBy(PromptFragment::source).map { fragment ->
            require(fragment.layer == PromptLayer.PROJECT) { "saf_project_layer_required" }
            require(fragment.source in candidates) { "saf_project_source_invalid" }
            val content = fragment.content.replace("\r\n", "\n").trim()
            require(content.isNotBlank()) { "saf_project_content_empty" }
            val digest = ProjectInstructionVersion.digest(content)
            require(fragment.version == null || fragment.version == digest) { "saf_project_digest_mismatch" }
            fragment.copy(content = content, version = digest)
        }
        val combined = normalized.joinToString("\n\n") { fragment ->
            "[PROJECT_SOURCE ${fragment.source} sha256=${fragment.version}]\n${fragment.content}"
        }
        require(combined.length <= MAX_PROJECT_CHARS) { "saf_project_instructions_too_large" }
        return JSONObject()
            .put("project_instructions", combined)
            .put("project_instruction_versions", JSONObject(ProjectInstructionVersion.versions(normalized)))
    }
}

data class SafEntry(val name: String, val directory: Boolean, val size: Long, val mimeType: String?)

class SafWorkspaceGateway(private val context: Context, private val store: SafWorkspaceStore) {
    private val mutationJournal = WorkspaceMutationJournal()
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

    fun glob(subject: String, pattern: String, relativePath: String = "", limit: Int = 100): List<String> {
        require(pattern.isNotBlank() && pattern.length <= 200) { "saf_glob_pattern_invalid" }
        require(limit in 1..250) { "saf_glob_limit_invalid" }
        val matcher = WorkspacePathSemantics.globRegex(pattern)
        return walk(subject, relativePath).map(SafWalkEntry::path).filter(matcher::matches).take(limit).toList()
    }

    fun grep(
        subject: String, pattern: String, relativePath: String = "", glob: String? = null, limit: Int = 250,
    ): List<JSONObject> {
        require(pattern.isNotBlank() && pattern.length <= 500) { "saf_grep_pattern_invalid" }
        require(limit in 1..250) { "saf_grep_limit_invalid" }
        val regex = Regex(pattern)
        val globRegex = glob?.let(WorkspacePathSemantics::globRegex)
        val results = mutableListOf<JSONObject>()
        for (entry in walk(subject, relativePath).filterNot(SafWalkEntry::directory)) {
            if (globRegex != null && !globRegex.matches(entry.path)) continue
            val bytes = runCatching { read(subject, entry.path, 256_000) }.getOrNull() ?: continue
            bytes.decodeToString().lineSequence().forEachIndexed { index, line ->
                if (results.size < limit && regex.containsMatchIn(line)) {
                    results += JSONObject().put("path", entry.path).put("line", index + 1).put("text", line.take(1_000))
                }
            }
            if (results.size >= limit) break
        }
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

    fun edit(subject: String, relativePath: String, oldText: String, newText: String, approved: Boolean): Int {
        require(approved) { "saf_edit_approval_required" }
        require(oldText.isNotEmpty() && oldText.length <= 256_000 && newText.length <= 256_000) { "saf_edit_text_invalid" }
        val current = read(subject, relativePath, 1_000_000).decodeToString()
        val index = current.indexOf(oldText)
        require(index >= 0) { "saf_edit_text_not_found" }
        val updated = current.replaceRange(index, index + oldText.length, newText)
        write(subject, relativePath, updated.encodeToByteArray(), approved = true)
        return index
    }

    fun previewWrite(subject: String, callId: String, path: String, content: String): String =
        mutationJournal.prepare(subject, callId, WorkspaceMutationPlanner.plan(
            "write", path, readOptional(subject, path), content,
        )).previewJson()

    fun previewEdit(subject: String, callId: String, path: String, oldText: String, newText: String): String {
        val current = requireNotNull(readOptional(subject, path)) { "saf_edit_file_missing" }
        val index = current.indexOf(oldText)
        require(index >= 0) { "saf_edit_text_not_found" }
        return mutationJournal.prepare(subject, callId, WorkspaceMutationPlanner.plan(
            "edit", path, current, current.replaceRange(index, index + oldText.length, newText),
        )).previewJson()
    }

    fun previewUndo(subject: String, callId: String, mutationToken: String): String {
        val receipt = mutationJournal.planUndo(subject, callId, mutationToken) { path -> readOptional(subject, path) }
        return receipt.previewJson()
    }

    fun commitPrepared(subject: String, callId: String): JSONObject {
        val committed = mutationJournal.commit(subject, callId, { path -> readOptional(subject, path) }) { plan ->
            if (plan.after == null) delete(subject, plan.path)
            else write(subject, plan.path, plan.after.encodeToByteArray(), approved = true)
        }
        return receipt(committed.plan, committed.replayed)
    }

    private fun readOptional(subject: String, path: String): String? = try {
        read(subject, path, 1_000_000).decodeToString()
    } catch (error: Throwable) {
        if (error.message == "saf_path_not_found") null else throw error
    }

    private fun delete(subject: String, path: String) {
        val file = resolve(subject, path, requireDirectory = false)
        require(file.delete()) { "saf_delete_failed" }
    }

    private fun receipt(plan: WorkspaceMutationPlan, replay: Boolean) = JSONObject()
        .put("operation", plan.operation).put("path", plan.path).put("before_sha256", plan.beforeSha256)
        .put("after_sha256", plan.afterSha256).put("mutation_token", plan.token)
        .put("replayed", replay).put("changed", !replay)

    private data class SafWalkEntry(val path: String, val directory: Boolean)

    private fun walk(subject: String, relativePath: String): Sequence<SafWalkEntry> = sequence {
        val start = resolve(subject, relativePath, requireDirectory = true)
        suspend fun SequenceScope<SafWalkEntry>.visit(directory: DocumentFile, prefix: String, depth: Int) {
            if (depth > 8) return
            for (child in directory.listFiles().sortedBy { it.name.orEmpty().lowercase() }) {
                val name = child.name.orEmpty()
                val path = if (prefix.isBlank()) name else "$prefix/$name"
                yield(SafWalkEntry(path, child.isDirectory))
                if (child.isDirectory) visit(child, path, depth + 1)
            }
        }
        visit(start, safeParts(relativePath).joinToString("/"), 0)
    }

    private fun root(subject: String): DocumentFile {
        val uri = store.uri(subject) ?: error("saf_workspace_not_granted")
        require(store.hasReadGrant(subject)) { "saf_permission_missing" }
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

object WorkspacePathSemantics {
    fun globRegex(pattern: String): Regex {
        val normalized = pattern.replace('\\', '/').trimStart('/')
        require(normalized.isNotBlank() && ".." !in normalized.split('/')) { "workspace_glob_pattern_invalid" }
        val output = StringBuilder("^")
        var index = 0
        while (index < normalized.length) {
            when (val value = normalized[index]) {
                '*' -> if (index + 1 < normalized.length && normalized[index + 1] == '*') {
                    output.append(".*"); index += 1
                } else output.append("[^/]*")
                '?' -> output.append("[^/]")
                else -> output.append(Regex.escape(value.toString()))
            }
            index += 1
        }
        return Regex(output.append('$').toString(), RegexOption.IGNORE_CASE)
    }

    fun lineSlice(text: String, startLine: Int?, endLine: Int?): String {
        val lines = text.lines()
        val start = (startLine ?: 1).coerceAtLeast(1)
        val end = (endLine ?: lines.size).coerceAtMost(lines.size)
        if (start > lines.size) return ""
        require(end >= start - 1) { "workspace_line_range_invalid" }
        return lines.subList(start - 1, end).joinToString("\n")
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
            parameterSchemaJson = objectToolSchema(
                JSONObject().put("path", JSONObject().put("type", "string")),
            ),
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
            parameterSchemaJson = objectToolSchema(
                JSONObject().put("path", JSONObject().put("type", "string"))
                    .put("start_line", JSONObject().put("type", "integer").put("minimum", 1))
                    .put("end_line", JSONObject().put("type", "integer").put("minimum", 1)), setOf("path"),
            ),
        ),
    ) { context, arguments ->
        WorkspacePathSemantics.lineSlice(
            saf.read(context.accountSubject, arguments.getString("path")).decodeToString(),
            arguments.optInt("start_line").takeIf { arguments.has("start_line") },
            arguments.optInt("end_line").takeIf { arguments.has("end_line") },
        )
    }
    registry.register(
        ToolDefinition(
            "workspace.search", 1, "Search names in the user-granted workspace", ToolRisk.READ_ONLY,
            requiredArguments = setOf("query"), requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
            parameterSchemaJson = objectToolSchema(
                JSONObject().put("query", JSONObject().put("type", "string")), setOf("query"),
            ),
            oaepOutputType = "command_execution",
        ),
    ) { context, arguments -> JSONArray(saf.search(context.accountSubject, arguments.getString("query"))).toString() }
    registry.register(
        ToolDefinition(
            "workspace.glob", 1, "Find paths by glob inside the user-granted workspace", ToolRisk.READ_ONLY,
            requiredArguments = setOf("pattern"), requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
            parameterSchemaJson = objectToolSchema(JSONObject()
                .put("pattern", JSONObject().put("type", "string")).put("path", JSONObject().put("type", "string"))
                .put("limit", JSONObject().put("type", "integer").put("minimum", 1).put("maximum", 250)), setOf("pattern")),
            oaepOutputType = "command_execution",
        ),
    ) { context, arguments -> JSONArray(saf.glob(context.accountSubject, arguments.getString("pattern"), arguments.optString("path"), arguments.optInt("limit", 100))).toString() }
    registry.register(
        ToolDefinition(
            "workspace.grep", 1, "Search file contents inside the user-granted workspace", ToolRisk.READ_ONLY,
            requiredArguments = setOf("pattern"), requiredCapabilities = setOf(RuntimeCapability.SAF_READ),
            parameterSchemaJson = objectToolSchema(JSONObject()
                .put("pattern", JSONObject().put("type", "string")).put("path", JSONObject().put("type", "string"))
                .put("glob", JSONObject().put("type", "string"))
                .put("limit", JSONObject().put("type", "integer").put("minimum", 1).put("maximum", 250)), setOf("pattern")),
            oaepOutputType = "command_execution",
        ),
    ) { context, arguments -> JSONArray(saf.grep(
        context.accountSubject, arguments.getString("pattern"), arguments.optString("path"),
        arguments.optString("glob").ifBlank { null }, arguments.optInt("limit", 250),
    )).toString() }
    registry.register(
        ToolDefinition(
            "workspace.write", 1, "Write a file in the user-granted workspace", ToolRisk.EXTERNAL_WRITE,
            requiredArguments = setOf("path", "content"), requiredCapabilities = setOf(RuntimeCapability.SAF_WRITE),
            parameterSchemaJson = objectToolSchema(
                JSONObject()
                    .put("path", JSONObject().put("type", "string"))
                    .put("content", JSONObject().put("type", "string")),
                setOf("path", "content"),
            ),
            oaepOutputType = "file_change",
        ),
        approvalPreviewer = ToolApprovalPreviewer { context, arguments ->
            saf.previewWrite(
                context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
                arguments.getString("path"), arguments.getString("content"),
            )
        },
    ) { context, arguments ->
        saf.commitPrepared(
            context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
        ).toString()
    }
    registry.register(
        ToolDefinition(
            "workspace.edit", 1, "Replace exact text once inside a file in the user-granted workspace", ToolRisk.EXTERNAL_WRITE,
            requiredArguments = setOf("path", "old_text", "new_text"), requiredCapabilities = setOf(RuntimeCapability.SAF_WRITE),
            parameterSchemaJson = objectToolSchema(JSONObject()
                .put("path", JSONObject().put("type", "string"))
                .put("old_text", JSONObject().put("type", "string"))
                .put("new_text", JSONObject().put("type", "string")), setOf("path", "old_text", "new_text")),
            oaepOutputType = "file_change",
        ),
        approvalPreviewer = ToolApprovalPreviewer { context, arguments ->
            saf.previewEdit(
                context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
                arguments.getString("path"), arguments.getString("old_text"), arguments.getString("new_text"),
            )
        },
    ) { context, _ -> saf.commitPrepared(
        context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
    ).toString() }
    registry.register(
        ToolDefinition(
            "workspace.undo", 1, "Undo a previously committed workspace mutation", ToolRisk.EXTERNAL_WRITE,
            requiredArguments = setOf("mutation_token"), requiredCapabilities = setOf(RuntimeCapability.SAF_WRITE),
            parameterSchemaJson = objectToolSchema(
                JSONObject().put("mutation_token", JSONObject().put("type", "string")), setOf("mutation_token"),
            ),
            oaepOutputType = "file_change",
        ),
        approvalPreviewer = ToolApprovalPreviewer { context, arguments ->
            saf.previewUndo(
                context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
                arguments.getString("mutation_token"),
            )
        },
    ) { context, _ -> saf.commitPrepared(
        context.accountSubject, requireNotNull(context.toolCallId) { "workspace_mutation_call_id_required" },
    ).toString() }
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
