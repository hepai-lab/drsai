package ai.drsai.remote.remote.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId

private val RemoteHeaderInk = Color(0xFF18211D)

data class RemoteComputerUi(
    val runtimeId: RuntimeId,
    val displayName: String,
    val state: RemoteConnectionState,
    val lastSeenLabel: String,
    val workspaces: List<RemoteWorkspaceRef>,
    val version: String = "",
    val instanceId: String = "",
    val connectionGeneration: Long = 0,
    val pendingApprovalCount: Int = 0,
)

data class RemoteHomeUiState(
    val computers: List<RemoteComputerUi> = emptyList(),
    val query: String = "",
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val stale: Boolean = false,
    val error: String? = null,
    val recentlyAssociatedRuntimeId: RuntimeId? = null,
)

@Composable
fun RemoteHomeScreen(
    state: RemoteHomeUiState,
    onBack: () -> Unit,
    onAssociate: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
    onQueryChange: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        when {
            state.loading && state.computers.isEmpty() -> RemoteLoadingState(Modifier.align(Alignment.Center))
            state.computers.isEmpty() -> RemoteEmptyState(onAssociate, Modifier.align(Alignment.Center))
            else -> RemoteComputerList(state, onOpenWorkspace)
        }

        Column(
            Modifier.align(Alignment.TopCenter).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FloatingPageHeader(
                title = "远程工作区",
                onBack = onBack,
                onAssociate = onAssociate,
                onRefresh = onRefresh,
                refreshing = state.refreshing,
            )
            OutlinedTextField(
                value = state.query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "搜索远程工作区" },
                singleLine = true,
                shape = RoundedCornerShape(20.dp),
                leadingIcon = { Icon(Icons.Default.Search, null) },
                placeholder = { Text("搜索计算机或工作区") },
            )
            if (state.stale) RemoteStatusBanner("当前显示上次同步内容")
            state.error?.let { RemoteStatusBanner(it, error = true) }
        }
    }
}

@Composable
fun FloatingPageHeader(
    title: String,
    onBack: () -> Unit,
    onAssociate: () -> Unit,
    onRefresh: () -> Unit,
    refreshing: Boolean,
    modifier: Modifier = Modifier,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val controlColor = Color.White.copy(alpha = 0.60f)
    Box(modifier.fillMaxWidth().height(52.dp)) {
        HeaderControl(Modifier.align(Alignment.CenterStart)) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
            }
        }
        Surface(
            modifier = Modifier.align(Alignment.Center),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = RemoteHeaderInk,
            tonalElevation = 2.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Box(Modifier.height(52.dp).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Box(Modifier.align(Alignment.CenterEnd)) {
            HeaderControl {
                IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, "更多") }
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    modifier = Modifier.semantics { contentDescription = "扫码关联菜单项" },
                    text = { Text("扫码关联已有计算机") },
                    leadingIcon = { Icon(Icons.Default.QrCodeScanner, null) },
                    onClick = { menuOpen = false; onAssociate() },
                )
                DropdownMenuItem(
                    text = { Text(if (refreshing) "正在刷新" else "刷新") },
                    leadingIcon = { Icon(Icons.Default.Refresh, null) },
                    enabled = !refreshing,
                    onClick = { menuOpen = false; onRefresh() },
                )
            }
        }
    }
}

@Composable
private fun HeaderControl(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(
        modifier = modifier.size(52.dp),
        shape = RoundedCornerShape(20.dp),
        color = Color.White.copy(alpha = 0.60f),
        contentColor = RemoteHeaderInk,
        tonalElevation = 2.dp,
        shadowElevation = 5.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        content = content,
    )
}

@Composable
private fun RemoteEmptyState(onAssociate: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier.padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Computer, null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
        Text("还没有关联的计算机", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            "请先在电脑端注册 OpenDrSai Runtime，再扫描一次性二维码完成关联。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onAssociate,
            modifier = Modifier.semantics { contentDescription = "扫码关联主按钮" },
        ) {
            Icon(Icons.Default.QrCodeScanner, null)
            Spacer(Modifier.width(8.dp))
            Text("扫码关联已有计算机")
        }
    }
}

@Composable
private fun RemoteLoadingState(modifier: Modifier = Modifier) {
    Text("正在读取远程工作区…", modifier, style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun RemoteComputerList(
    state: RemoteHomeUiState,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, top = 146.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(state.computers, key = { it.runtimeId.value }) { computer ->
            RemoteComputerCard(computer, computer.runtimeId == state.recentlyAssociatedRuntimeId, onOpenWorkspace)
        }
    }
}

@Composable
private fun RemoteComputerCard(
    computer: RemoteComputerUi,
    recentlyAssociated: Boolean,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
) {
    var expanded by remember(computer.runtimeId) { mutableStateOf(true) }
    Surface(
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(if (recentlyAssociated) 2.dp else 1.dp,
            if (recentlyAssociated) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Computer, null)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(computer.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (recentlyAssociated) {
                        Text("刚刚关联", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    Text(
                        "${connectionLabel(computer.state)} · ${computer.lastSeenLabel}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (computer.version.isNotBlank()) {
                        Text(
                            "OpenDrSai ${computer.version}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (computer.pendingApprovalCount > 0) {
                    Text("待确认 ${computer.pendingApprovalCount}", color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(8.dp))
                }
                Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, if (expanded) "收起工作区" else "展开工作区")
            }
            if (expanded) {
                HorizontalDivider()
                computer.workspaces.forEach { workspace ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onOpenWorkspace(workspace) }.padding(horizontal = 18.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Folder, null, Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(workspace.displayName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
private fun RemoteStatusBanner(message: String, error: Boolean = false) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(message, Modifier.padding(horizontal = 14.dp, vertical = 9.dp), style = MaterialTheme.typography.bodySmall)
    }
}

private fun connectionLabel(state: RemoteConnectionState): String = when (state) {
    RemoteConnectionState.CONNECTING -> "正在连接"
    RemoteConnectionState.ONLINE -> "在线"
    RemoteConnectionState.DEGRADED -> "连接异常"
    RemoteConnectionState.OFFLINE -> "离线"
    RemoteConnectionState.AUTH_REQUIRED -> "需要登录"
    RemoteConnectionState.INCOMPATIBLE -> "需要更新"
}
