package ai.drsai.remote.remote.ui

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
        Row(verticalAlignment = Alignment.CenterVertically) { TextButton(onClick = onBack) { Text("返回") }; Text("${state.workspaceName} · 文件", fontWeight = FontWeight.Bold) }
        Text(state.path.ifBlank { "/" }, style = MaterialTheme.typography.labelSmall)
        OutlinedTextField(query, { query = it; onSearch(it) }, Modifier.fillMaxWidth(), placeholder = { Text("在工作区中搜索") })
        state.ignoredHint?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        if (state.truncated || state.searchTruncated) Text("结果已截断，请缩小范围", color = MaterialTheme.colorScheme.error)
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
            if (state.nextCursor != null) item { TextButton(onClick = onLoadMore, Modifier.fillMaxWidth()) { Text("加载更多") } }
        }
    }
}

enum class PreviewKind { TEXT, IMAGE, BINARY, UNSUPPORTED }
data class FilePreviewUiState(val title: String, val kind: PreviewKind, val text: String? = null,
                              val summary: String? = null, val imageBytes: ByteArray? = null,
                              val truncated: Boolean = false, val loading: Boolean = false,
                              val canOpenExternal: Boolean = true)

@Composable
fun FilePreviewScreen(state: FilePreviewUiState, onBack: () -> Unit, onCancel: () -> Unit, onOpenExternal: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row { TextButton(onClick = onBack) { Text("返回") }; Text(state.title, Modifier.weight(1f), fontWeight = FontWeight.Bold); if (state.loading) TextButton(onClick = onCancel) { Text("取消") } }
        if (state.truncated) Text("预览已截断", color = MaterialTheme.colorScheme.error)
        when (state.kind) {
            PreviewKind.TEXT -> Text(state.text.orEmpty(), fontFamily = FontFamily.Monospace)
            PreviewKind.IMAGE -> {
                val bitmap = remember(state.imageBytes) { state.imageBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) } }
                if (bitmap == null) Text("图片无法解码", color = MaterialTheme.colorScheme.error)
                else Image(bitmap.asImageBitmap(), state.title, Modifier.fillMaxWidth().weight(1f), contentScale = ContentScale.Fit)
            }
            PreviewKind.BINARY -> { Text(state.summary ?: "二进制文件"); if (state.canOpenExternal) Button(onClick = onOpenExternal) { Text("下载并打开") } }
            PreviewKind.UNSUPPORTED -> { Text(state.summary ?: "暂不支持此格式预览"); if (state.canOpenExternal) Button(onClick = onOpenExternal) { Text("下载并使用其他应用打开") } }
        }
    }
}

data class GitReadUiState(val status: GitStatusUi, val diff: BoundedDiff? = null)

@Composable
fun WorkspaceGitScreen(state: GitReadUiState, onBack: () -> Unit, onOpenDiff: (GitChangeUi) -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row { TextButton(onClick = onBack) { Text("返回") }; Text("Git · ${state.status.branch ?: "detached"}", fontWeight = FontWeight.Bold) }
        Text("Revision ${state.status.revision}")
        LazyColumn { items(state.status.changes, key = { it.relativePath }) { change ->
            Row(Modifier.fillMaxWidth().clickable { onOpenDiff(change) }.padding(vertical = 10.dp)) { Text(change.status, Modifier.width(80.dp)); Text(change.relativePath) }
        } }
        state.diff?.let { diff ->
            if (diff.staleRevision) Text("基线已变化，请刷新", color = MaterialTheme.colorScheme.error)
            else if (diff.binary) Text("二进制文件无法显示 Diff")
            else { if (diff.truncated) Text("Diff 过大，已截断"); Text(diff.text.orEmpty(), fontFamily = FontFamily.Monospace) }
        }
    }
}
