package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import ai.drsai.remote.ui.LocalizedText
import ai.drsai.remote.ui.resolve
import ai.drsai.remote.ui.localizedBytes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import android.graphics.BitmapFactory
import ai.drsai.remote.remote.data.*

data class FileTreeUiState(val workspaceName: String, val path: String = "", val nodes: List<RemoteFileNode> = emptyList(),
                           val loading: Boolean = false, val nextCursor: String? = null, val truncated: Boolean = false,
                           val ignoredHint: String? = null, val searchResults: List<RemoteFileNode> = emptyList(),
                           val searchTruncated: Boolean = false, val scopeKey: String = "",
                           val preview: FilePreviewUiState? = null)

@Composable
fun WorkspaceFilesScreen(state: FileTreeUiState, onBack: () -> Unit, onExpand: (RemoteFileNode) -> Unit,
                         onOpen: (RemoteFileNode) -> Unit, onSearch: (String) -> Unit, onLoadMore: () -> Unit,
                         onClosePreview: () -> Unit = {}, onCancelPreview: () -> Unit = {},
                         onOpenExternal: () -> Unit = {}) {
    state.preview?.let {
        FilePreviewScreen(it, onClosePreview, onCancelPreview, onOpenExternal)
        return
    }
    var query by remember(state.scopeKey) { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }; Text(stringResource(R.string.workspace_files_title, state.workspaceName), fontWeight = FontWeight.Bold) }
        Text(state.path.ifBlank { "/" }, style = MaterialTheme.typography.labelSmall)
        OutlinedTextField(query, { query = it; onSearch(it) }, Modifier.fillMaxWidth(), placeholder = { Text(stringResource(R.string.workspace_search_hint)) })
        state.ignoredHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (state.truncated || state.searchTruncated) Text(stringResource(R.string.results_truncated), color = MaterialTheme.colorScheme.error)
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        val rows = if (query.isBlank()) state.nodes else state.searchResults
        LazyColumn(Modifier.weight(1f)) {
            items(rows, key = { it.token }) { node ->
                Row(Modifier.fillMaxWidth().clickable { if (node.type == "directory") onExpand(node) else onOpen(node) }.padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(if (node.type == "directory") "📁" else "📄"); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) { Text(node.relativePath, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(node.type, node.size?.let { "$it B" }, node.modifiedAt, node.gitStatus).joinToString(" · "), style = MaterialTheme.typography.bodySmall) }
                }
            }
            if (state.nextCursor != null) item { TextButton(onClick = onLoadMore, Modifier.fillMaxWidth()) { Text(stringResource(R.string.load_more)) } }
        }
    }
}

enum class PreviewKind { TEXT, IMAGE, BINARY, UNSUPPORTED }
data class FilePreviewUiState(val title: String, val kind: PreviewKind, val text: String? = null,
                              val summary: String? = null, val imageBytes: ByteArray? = null,
                              val truncated: Boolean = false, val loading: Boolean = false,
                              val canOpenExternal: Boolean = true,
                              val summaryText: LocalizedText? = null,
                              val sizeBytes: Long? = null,
                              val mimeType: String? = null)

@Composable
fun FilePreviewScreen(state: FilePreviewUiState, onBack: () -> Unit, onCancel: () -> Unit, onOpenExternal: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row { TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }; Text(state.title, Modifier.weight(1f), fontWeight = FontWeight.Bold); if (state.loading) TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) } }
        if (state.truncated) Text(stringResource(R.string.preview_truncated), color = MaterialTheme.colorScheme.error)
        when (state.kind) {
            PreviewKind.TEXT -> Text(state.text.orEmpty(), fontFamily = FontFamily.Monospace)
            PreviewKind.IMAGE -> {
                val bitmap = remember(state.imageBytes) { state.imageBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
                if (bitmap == null) Text(stringResource(R.string.image_decode_failed), color = MaterialTheme.colorScheme.error)
                else Image(bitmap.asImageBitmap(), state.title, Modifier.fillMaxWidth().weight(1f), contentScale = ContentScale.Fit)
            }
            PreviewKind.BINARY -> { Text(state.sizeBytes?.let { stringResource(R.string.binary_file_formatted_size, localizedBytes(it)) } ?: state.summaryText?.resolve() ?: state.summary ?: stringResource(R.string.binary_file)); if (state.canOpenExternal) Button(onClick = onOpenExternal) { Text(stringResource(R.string.download_and_open)) } }
            PreviewKind.UNSUPPORTED -> { Text(state.mimeType?.let { stringResource(R.string.unsupported_inline_preview, it) } ?: state.summaryText?.resolve() ?: state.summary ?: stringResource(R.string.unsupported_preview)); if (state.canOpenExternal) Button(onClick = onOpenExternal) { Text(stringResource(R.string.download_open_other_app)) } }
        }
    }
}

data class GitReadUiState(val status: GitStatusUi, val diff: BoundedDiff? = null)

@Composable
fun WorkspaceGitScreen(state: GitReadUiState, onBack: () -> Unit, onOpenDiff: (GitChangeUi) -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row { TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }; Text(stringResource(R.string.git_branch_title, state.status.branch ?: "detached"), fontWeight = FontWeight.Bold) }
        Text(stringResource(R.string.revision_label, state.status.revision))
        LazyColumn { items(state.status.changes, key = { it.relativePath }) { change ->
            Row(Modifier.fillMaxWidth().clickable { onOpenDiff(change) }.padding(vertical = 10.dp)) { Text(change.status, Modifier.width(80.dp)); Text(change.relativePath) }
        } }
        state.diff?.let { diff ->
            if (diff.staleRevision) Text(stringResource(R.string.baseline_changed), color = MaterialTheme.colorScheme.error)
            else if (diff.binary) Text(stringResource(R.string.binary_diff_unavailable))
            else { if (diff.truncated) Text(stringResource(R.string.diff_truncated)); Text(diff.text.orEmpty(), fontFamily = FontFamily.Monospace) }
        }
    }
}
