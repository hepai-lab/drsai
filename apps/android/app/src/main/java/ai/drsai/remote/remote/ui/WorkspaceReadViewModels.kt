package ai.drsai.remote.remote.ui

import android.app.Application
import android.content.Intent
import android.util.Base64
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import java.util.UUID
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job

class WorkspaceFilesViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
    workspaceName: String,
) : AndroidViewModel(app) {
    private val client = RemoteWorkspaceContainer.get(app).workspace(runtimeId)
    private val mutableState = MutableStateFlow(FileTreeUiState(workspaceName = workspaceName, loading = true,
        scopeKey = "${runtimeId.value}/${workspaceId.value}"))
    val state: StateFlow<FileTreeUiState> = mutableState.asStateFlow()
    private var previewJob: Job? = null
    private var previewSource: PreviewSource? = null

    init { load("") }

    fun expand(node: RemoteFileNode) { require(node.type == "directory"); load(node.relativePath) }
    fun loadMore() { mutableState.value.nextCursor?.let { load(mutableState.value.path, it, append = true) } }

    fun search(query: String) = viewModelScope.launch(Dispatchers.IO) {
        if (query.isBlank()) { mutableState.update { it.copy(searchResults = emptyList(), searchTruncated = false) }; return@launch }
        val result = client.searchFiles(workspaceId, query, null, 5_000, UUID.randomUUID().toString(), UUID.randomUUID().toString())
        result.fold(
            success = { map -> mutableState.update { it.copy(searchResults = map.nodes(), searchTruncated = map.bool("truncated")) } },
            failure = { failure -> mutableState.update { it.copy(ignoredHint = safeRemoteFailureMessage(failure)) } },
        )
    }

    fun open(node: RemoteFileNode) {
        require(node.type != "directory")
        previewJob?.cancel()
        previewJob = viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(preview = FilePreviewUiState(node.relativePath, PreviewKind.UNSUPPORTED, loading = true)) }
            runCatching {
                val stat = client.statFile(workspaceId, node.relativePath, UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
                val size = (stat["size"] as? Number)?.toLong() ?: error("file_size_missing")
                val digest = stat["digest"] as? String ?: error("file_digest_missing")
                val bytes = if (size == 0L) byteArrayOf() else {
                    val read = client.readFile(workspaceId, node.relativePath, 0, minOf(size, 1_048_576L),
                        UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
                    Base64.decode(read["content_base64"] as String, Base64.DEFAULT)
                }
                if (size <= bytes.size) {
                    val actual = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
                    require(actual == digest.lowercase()) { "file_digest_mismatch" }
                }
                previewSource = PreviewSource(node, size, digest)
                buildFilePreview(node, bytes, size > bytes.size)
            }.onSuccess { preview -> mutableState.update { it.copy(preview = preview) } }
                .onFailure { failure -> mutableState.update { it.copy(preview = FilePreviewUiState(node.relativePath,
                    PreviewKind.UNSUPPORTED, summary = safeRemoteFailureMessage(failure), loading = false,
                    canOpenExternal = false)) } }
        }
    }

    fun closePreview() { previewJob?.cancel(); previewSource = null; mutableState.update { it.copy(preview = null) } }
    fun cancelPreview() { previewJob?.cancel(); mutableState.update { state -> state.copy(preview = state.preview?.copy(loading = false)) } }

    fun openExternal() {
        val source = previewSource ?: return
        previewJob?.cancel()
        previewJob = viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { state -> state.copy(preview = state.preview?.copy(loading = true)) }
            runCatching {
                require(source.size <= 256L * 1024 * 1024) { "file_size_limit" }
                val root = File(getApplication<Application>().cacheDir, "remote/artifacts").apply { mkdirs() }
                val safeName = File(source.node.relativePath).name.ifBlank { "remote-file" }
                val target = File(root, "${source.digest.take(16)}-$safeName")
                val temporary = File(root, "${target.name}.partial")
                val digest = MessageDigest.getInstance("SHA-256")
                temporary.outputStream().use { output ->
                    var offset = 0L
                    while (offset < source.size) {
                        val length = minOf(256 * 1024L, source.size - offset)
                        val result = client.readFile(workspaceId, source.node.relativePath, offset, length,
                            UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
                        val bytes = Base64.decode(result["content_base64"] as String, Base64.DEFAULT)
                        require(bytes.isNotEmpty() && offset + bytes.size <= source.size) { "file_chunk_invalid" }
                        output.write(bytes); digest.update(bytes); offset += bytes.size
                    }
                }
                require(digest.digest().hex() == source.digest.lowercase()) { "file_digest_mismatch" }
                if (target.exists()) target.delete()
                require(temporary.renameTo(target)) { "file_cache_commit_failed" }
                val intent = artifactOpenIntent(getApplication(), target, mimeType(source.node.relativePath))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                getApplication<Application>().startActivity(intent)
            }.onFailure { failure -> mutableState.update { state -> state.copy(preview = state.preview?.copy(
                summary = safeRemoteFailureMessage(failure), loading = false)) } }
        }
    }

    private fun load(path: String, cursor: String? = null, append: Boolean = false) = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(loading = true) }
        val result = client.listFiles(workspaceId, path, UUID.randomUUID().toString(), UUID.randomUUID().toString(), cursor)
        result.fold(
            success = { map -> mutableState.update { state ->
                val rows = map.nodes()
                state.copy(path = path, nodes = if (append) state.nodes + rows else rows, loading = false,
                    nextCursor = map.string("next_cursor"), truncated = map.bool("truncated"),
                    ignoredHint = map.string("ignored_hint"))
            } },
            failure = { failure -> mutableState.update { it.copy(loading = false, ignoredHint = safeRemoteFailureMessage(failure)) } },
        )
    }

    companion object {
        fun factory(app: Application, runtimeId: RuntimeId, workspaceId: WorkspaceId, workspaceName: String) =
            simpleFactory { WorkspaceFilesViewModel(app, runtimeId, workspaceId, workspaceName) }
    }

    private data class PreviewSource(val node: RemoteFileNode, val size: Long, val digest: String)
}

class WorkspaceGitViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
) : AndroidViewModel(app) {
    private val client = RemoteWorkspaceContainer.get(app).workspace(runtimeId)
    private val mutableState = MutableStateFlow(GitReadUiState(GitStatusUi(null, "loading", emptyList())))
    val state: StateFlow<GitReadUiState> = mutableState.asStateFlow()

    init { refresh() }
    fun refresh() = viewModelScope.launch(Dispatchers.IO) {
        client.gitStatus(workspaceId, UUID.randomUUID().toString(), UUID.randomUUID().toString()).fold(
            success = { map -> mutableState.value = GitReadUiState(map.gitStatus()) }, failure = {})
    }
    fun diff(change: GitChangeUi) = viewModelScope.launch(Dispatchers.IO) {
        client.gitDiff(workspaceId, change.relativePath, UUID.randomUUID().toString(), UUID.randomUUID().toString()).fold(
            success = { map -> mutableState.update { it.copy(diff = BoundedDiff(map.string("text"), map.bool("binary"),
                map.bool("truncated"), map.bool("stale_revision"))) } }, failure = {})
    }

    companion object {
        fun factory(app: Application, runtimeId: RuntimeId, workspaceId: WorkspaceId) =
            simpleFactory { WorkspaceGitViewModel(app, runtimeId, workspaceId) }
    }
}

private inline fun OwopResult.fold(success: (Map<String, Any?>) -> Unit, failure: (OwopResult.Failure) -> Unit) {
    when (this) { is OwopResult.Success -> success(result); is OwopResult.Failure -> failure(this) }
}
private fun Map<String, Any?>.string(key: String): String? = this[key] as? String
private fun Map<String, Any?>.bool(key: String): Boolean = this[key] as? Boolean ?: false
private fun Map<String, Any?>.nodes(): List<RemoteFileNode> = (this["items"] as? List<*>)?.map { raw ->
    val row = raw as? Map<*, *> ?: error("owop_file_row_invalid")
    RemoteFileNode(row["token"] as String, row["relative_path"] as String, row["type"] as String,
        (row["size"] as? Number)?.toLong(), row["modified_at"] as? String, row["git_status"] as? String,
        row["truncated"] as? Boolean ?: false)
}.orEmpty()
private fun Map<String, Any?>.gitStatus(): GitStatusUi = GitStatusUi(string("branch"),
    string("revision") ?: error("git_revision_required"), (this["changes"] as? List<*>)?.map { raw ->
        val row = raw as? Map<*, *> ?: error("git_change_invalid")
        GitChangeUi(row["relative_path"] as String, row["status"] as String)
    }.orEmpty())
private fun OwopResult.success(): Map<String, Any?> = when (this) {
    is OwopResult.Success -> result
    is OwopResult.Failure -> error("$code: $message")
}
private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }
private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
    "txt", "md", "kt", "kts", "java", "py", "js", "ts", "tsx", "jsx", "json", "xml", "yaml", "yml", "toml", "csv", "log" -> "text/plain"
    "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"; "webp" -> "image/webp"
    "pdf" -> "application/pdf"; else -> "application/octet-stream"
}
internal fun buildFilePreview(node: RemoteFileNode, bytes: ByteArray, truncated: Boolean): FilePreviewUiState {
    val mime = mimeType(node.relativePath)
    return when {
        mime.startsWith("text/") -> FilePreviewUiState(node.relativePath, PreviewKind.TEXT,
            text = bytes.toString(Charsets.UTF_8), truncated = truncated)
        mime.startsWith("image/") -> FilePreviewUiState(node.relativePath, PreviewKind.IMAGE,
            imageBytes = bytes, truncated = truncated)
        mime == "application/octet-stream" -> FilePreviewUiState(node.relativePath, PreviewKind.BINARY,
            summary = "二进制文件 · ${node.size ?: bytes.size.toLong()} B", truncated = truncated)
        else -> FilePreviewUiState(node.relativePath, PreviewKind.UNSUPPORTED,
            summary = "暂不支持 ${mime} 内嵌预览")
    }
}
private fun simpleFactory(create: () -> ViewModel): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = create() as T
}
