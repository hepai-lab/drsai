package ai.drsai.remote.remote.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId

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
    val workspacesCached: Boolean = false,
    val lastSyncedAtMillis: Long? = null,
    val workspaceSyncStatus: String? = null,
    val workspaceSyncFailed: Boolean = false,
)

data class RemoteHomeUiState(
    val computers: List<RemoteComputerUi> = emptyList(),
    val query: String = "",
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val stale: Boolean = false,
    val error: String? = null,
    val recentlyAssociatedRuntimeId: RuntimeId? = null,
    val refreshingRuntimeIds: Set<RuntimeId> = emptySet(),
)

@Composable
fun RemoteHomeScreen(
    state: RemoteHomeUiState,
    onBack: () -> Unit,
    onAssociate: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit = {},
    onRevokeAssociation: (RuntimeId) -> Unit = {},
    onQueryChange: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize()) {
        when {
            state.loading && state.computers.isEmpty() -> RemoteLoadingState(Modifier.align(Alignment.Center))
            state.computers.isEmpty() -> RemoteEmptyState(onAssociate, Modifier.align(Alignment.Center))
            else -> RemoteComputerList(
                state,
                onOpenWorkspace,
                onRevokeAssociation,
                onRefreshWorkspaces,
            )
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
    val controlColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.60f)
        .compositeOver(MaterialTheme.colorScheme.background)
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
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp,
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
    val controlColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.60f)
        .compositeOver(MaterialTheme.colorScheme.background)
    Surface(
        modifier = modifier.size(52.dp),
        shape = RoundedCornerShape(20.dp),
        color = controlColor,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = 0.dp,
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
    onRevokeAssociation: (RuntimeId) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, top = 146.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(state.computers, key = { it.runtimeId.value }) { computer ->
            RemoteComputerCard(
                computer,
                computer.runtimeId == state.recentlyAssociatedRuntimeId,
                onOpenWorkspace,
                onRevokeAssociation,
                onRefreshWorkspaces,
                computer.runtimeId in state.refreshingRuntimeIds,
            )
        }
    }
}

@Composable
private fun RemoteComputerCard(
    computer: RemoteComputerUi,
    recentlyAssociated: Boolean,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
    onRevokeAssociation: (RuntimeId) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit,
    refreshingWorkspaces: Boolean,
) {
    var expanded by remember(computer.runtimeId) { mutableStateOf(true) }
    var menuOpen by remember(computer.runtimeId) { mutableStateOf(false) }
    var confirmRevoke by remember(computer.runtimeId) { mutableStateOf(false) }
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
                    RemoteConnectionIndicator(computer.state, computer.lastSeenLabel)
                    if (computer.workspacesCached && computer.state != RemoteConnectionState.OFFLINE) {
                        Text(
                            computer.lastSeenLabel.takeIf(String::isNotBlank)
                                ?: "缓存的工作区目录",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (computer.version.isNotBlank()) {
                        Text(
                            "OpenDrSai ${computer.version}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    computer.workspaceSyncStatus?.let { status ->
                        Text(
                            status,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (computer.workspaceSyncFailed) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                        )
                    }
                }
                if (computer.pendingApprovalCount > 0) {
                    Text("待确认 ${computer.pendingApprovalCount}", color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(8.dp))
                }
                IconButton(
                    enabled = !refreshingWorkspaces,
                    onClick = { onRefreshWorkspaces(computer.runtimeId) },
                ) {
                    if (refreshingWorkspaces) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Icon(
                            Icons.Default.Refresh,
                            "刷新 ${computer.displayName} 的工作区",
                        )
                    }
                }
                IconButton(onClick = { expanded = !expanded }) {
                    Icon(
                        if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        if (expanded) "收起工作区" else "展开工作区",
                    )
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, "计算机操作")
                    }
                    DropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                    ) {
                        DropdownMenuItem(
                            modifier = Modifier.semantics {
                                contentDescription = "解除 ${computer.displayName} 的关联"
                            },
                            text = { Text("解除关联") },
                            leadingIcon = { Icon(Icons.Default.DeleteForever, null) },
                            onClick = {
                                menuOpen = false
                                confirmRevoke = true
                            },
                        )
                    }
                }
            }
            if (expanded) {
                HorizontalDivider()
                computer.workspaces.forEach { workspace ->
                    val compatible = computer.state != RemoteConnectionState.INCOMPATIBLE
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = compatible) { onOpenWorkspace(workspace) }
                            .alpha(if (compatible) 1f else 0.55f)
                            .padding(horizontal = 18.dp, vertical = 14.dp),
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
    if (confirmRevoke) {
        AlertDialog(
            onDismissRequest = { confirmRevoke = false },
            title = { Text("解除关联？") },
            text = {
                Text("解除后，这台设备将立即停止接收 ${computer.displayName} 的会话和事件。重新扫码可以恢复访问。")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmRevoke = false
                        onRevokeAssociation(computer.runtimeId)
                    },
                ) { Text("解除关联") }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevoke = false }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun RemoteConnectionIndicator(
    state: RemoteConnectionState,
    lastSeenLabel: String,
) {
    val connecting = state == RemoteConnectionState.CONNECTING
    val pulseAlpha = if (connecting) {
        rememberInfiniteTransition(label = "remote-connection-pulse").animateFloat(
            initialValue = 0.38f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 850),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "remote-connection-alpha",
        ).value
    } else {
        1f
    }
    val color = when (state) {
        RemoteConnectionState.ONLINE -> Color(0xFF2F7D5B)
        RemoteConnectionState.OFFLINE -> MaterialTheme.colorScheme.outline
        RemoteConnectionState.CONNECTING -> MaterialTheme.colorScheme.primary
        RemoteConnectionState.DEGRADED,
        RemoteConnectionState.INCOMPATIBLE -> Color(0xFFB7791F)
        RemoteConnectionState.AUTH_REQUIRED -> MaterialTheme.colorScheme.error
    }
    val detail = when (state) {
        RemoteConnectionState.ONLINE -> lastSeenLabel.takeUnless {
            it.isBlank() || it == "在线"
        }
        RemoteConnectionState.OFFLINE -> lastSeenLabel.takeIf(String::isNotBlank) ?: "离线"
        RemoteConnectionState.CONNECTING -> "连接中…"
        RemoteConnectionState.DEGRADED -> "连接异常"
        RemoteConnectionState.AUTH_REQUIRED -> "需要登录"
        RemoteConnectionState.INCOMPATIBLE -> "需要更新"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.semantics {
            contentDescription = "连接状态：${connectionLabel(state)}"
        },
    ) {
        Box(
            Modifier
                .size(8.dp)
                .alpha(pulseAlpha)
                .background(color, CircleShape),
        )
        detail?.let {
            Spacer(Modifier.width(6.dp))
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
