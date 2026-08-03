package ai.drsai.remote.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.RemoteAuditEntry
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect

data class RemoteCapabilityUi(val name: String, val available: Boolean)
data class RemoteSessionUi(val reference: RemoteSessionRef, val lastRunStatus: String?, val updatedAtLabel: String,
                           val lifecycle: String = "active")
fun activeRemoteSessions(items: List<RemoteSessionUi>): List<RemoteSessionUi> =
    items
        .filter {
            it.lifecycle == "active" &&
                it.reference.lifecycle == RemoteResourceLifecycle.ACTIVE
        }
        .groupBy { it.reference.sessionId.value }
        .values
        .map { versions ->
            versions.maxWith(
                compareBy<RemoteSessionUi> { it.updatedAtLabel }
                    .thenBy { it.reference.sessionId.value },
            )
        }
        .sortedWith(
            compareByDescending<RemoteSessionUi> { it.updatedAtLabel }
                .thenBy { it.reference.sessionId.value },
        )
data class WorkspaceSessionsUiState(
    val runtimeName: String,
    val workspaceName: String,
    val query: String = "",
    val capabilities: List<RemoteCapabilityUi> = emptyList(),
    val agentDefinitions: List<RemoteAgentDefinition> = emptyList(),
    val pendingApprovalCount: Int = 0,
    val sessions: List<RemoteSessionUi> = emptyList(),
    val instructionVersions: Map<String, String> = emptyMap(),
    val instructionStatus: String? = null,
    val instructionRefreshRequired: Boolean = false,
    val loading: Boolean = false,
    val creating: Boolean = false,
    val error: String? = null,
)

@Composable
fun WorkspaceSessionsScreen(state: WorkspaceSessionsUiState, onBack: () -> Unit, onRefresh: () -> Unit,
                            onSearch: (String) -> Unit, onCreate: (RemoteAgentDefinition) -> Unit,
                            onOpen: (RemoteSessionRef) -> Unit, onResume: () -> Unit = onRefresh,
                            onOpenCapability: (String) -> Unit = {}, onConfirmInstructions: () -> Unit = {}) {
    var agentPickerOpen by remember { mutableStateOf(false) }
    val activeSessions = activeRemoteSessions(state.sessions)
    LifecycleEventEffect(Lifecycle.Event.ON_START) { onResume() }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Column(Modifier.weight(1f)) {
                Text(state.workspaceName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(state.runtimeName, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRefresh) { Text("刷新") }
            Button(onClick = { agentPickerOpen = true }, enabled = !state.creating && state.agentDefinitions.isNotEmpty() && !state.instructionRefreshRequired) {
                Text(if (state.creating) "创建中" else "新会话")
            }
        }
        OutlinedTextField(state.query, onSearch, Modifier.fillMaxWidth(), placeholder = { Text("搜索会话") })
        if (state.pendingApprovalCount > 0) {
            Text("待确认 ${state.pendingApprovalCount}", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            state.capabilities.forEach { AssistChip(onClick = { onOpenCapability(it.name) }, enabled = it.available,
                label = { Text(it.name) }) }
        }
        Text(
            "文件写入、命令和 Git 修改只能在远程会话中发起，并需要逐项审批；Android 不会在设备上静默执行。",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        state.instructionStatus?.let { status ->
            Text(
                status + state.instructionVersions.values.firstOrNull()?.let { " · ${it.take(12)}" }.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (state.instructionRefreshRequired) {
            OutlinedButton(onClick = onConfirmInstructions, modifier = Modifier.fillMaxWidth()) {
                Text("确认使用最新项目指令")
            }
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(activeSessions, key = { it.reference.sessionId.value }) { session ->
                Card(onClick = { onOpen(session.reference) }) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(session.reference.title, fontWeight = FontWeight.SemiBold)
                        Text("${session.reference.backendId} · ${session.lastRunStatus ?: "尚未运行"} · ${session.updatedAtLabel}",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
    if (agentPickerOpen) {
        AlertDialog(
            onDismissRequest = { agentPickerOpen = false },
            title = { Text("选择远程智能体") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.agentDefinitions.forEach { definition ->
                        OutlinedButton(
                            onClick = { agentPickerOpen = false; onCreate(definition) },
                            enabled = definition.backendHealth == "healthy",
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.fillMaxWidth()) {
                                Text(definition.name)
                                Text("${definition.backendId} · ${definition.version}", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { agentPickerOpen = false }) { Text("取消") } },
        )
    }
}

@Composable
fun RemoteAuditScreen(
    runtimeName: String,
    workspaceName: String,
    entries: List<RemoteAuditEntry>,
    loading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Column(Modifier.weight(1f)) {
                Text("审计记录", fontWeight = FontWeight.Bold)
                Text("$runtimeName · $workspaceName", style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRefresh) { Text("刷新") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!loading && entries.isEmpty()) Text("暂无审计记录")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(entries, key = { it.auditId }) { entry ->
                Card {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(entry.action, fontWeight = FontWeight.SemiBold)
                        Text("操作者：${entry.subject}", style = MaterialTheme.typography.bodySmall)
                        Text(entry.timestamp, style = MaterialTheme.typography.bodySmall)
                        Text("关联 ID：${entry.correlationId}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
}

data class RemoteMessageUi(
    val id: String,
    val role: String,
    val text: String,
    val progress: String? = null,
    val kind: String = "message",
    val title: String? = null,
    val detail: String? = null,
)
data class RemoteArtifactUi(val artifactId: String, val name: String, val mimeType: String, val size: Long,
                            val sha256: String, val downloading: Boolean = false, val error: String? = null)
data class RemoteChatUiState(
    val runtimeName: String,
    val workspaceName: String,
    val sessionTitle: String,
    val messages: List<RemoteMessageUi> = emptyList(),
    val approval: RemoteApprovalCard? = null,
    val running: Boolean = false,
    val online: Boolean = true,
    val correlationId: String? = null,
    val activeRunId: RunId? = null,
    val artifacts: List<RemoteArtifactUi> = emptyList(),
    val scopeKey: String = "",
    val connectionState: RemoteConnectionState = RemoteConnectionState.ONLINE,
)

@Composable
fun RemoteChatScreen(state: RemoteChatUiState, onBack: () -> Unit, onSend: (String) -> Unit,
                     onCancelRun: () -> Unit, onApproval: (String, String) -> Unit, onOpenAudit: () -> Unit,
                     onOpenArtifact: (String) -> Unit = {}) {
    var input by remember(state.scopeKey) { mutableStateOf("") }
    val transcriptListState = rememberLazyListState()
    val transcriptItemCount =
        state.messages.size + state.artifacts.size + if (state.approval == null) 0 else 1
    LaunchedEffect(state.scopeKey, transcriptItemCount) {
        if (transcriptItemCount > 0) {
            transcriptListState.scrollToItem(transcriptItemCount - 1)
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Column(Modifier.weight(1f)) {
                Text(state.sessionTitle, fontWeight = FontWeight.Bold)
                Text("${state.runtimeName} · ${state.workspaceName}", style = MaterialTheme.typography.labelSmall)
            }
            state.correlationId?.let { TextButton(onClick = onOpenAudit) { Text("审计") } }
        }
        if (!state.online) Text("连接已中断，任务可能仍在运行", color = MaterialTheme.colorScheme.error)
        LazyColumn(
            Modifier.weight(1f),
            state = transcriptListState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(state.messages, key = { it.id }) { message ->
                val isUser = message.role == "user"
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = if (isUser) Alignment.CenterEnd else Alignment.CenterStart,
                ) {
                    Surface(
                        modifier = if (isUser) Modifier.widthIn(max = 620.dp) else Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        color = if (isUser) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.surface
                        },
                        tonalElevation = 0.dp,
                    ) {
                        Column(Modifier.padding(if (isUser) 12.dp else 4.dp)) {
                            Text(
                                message.title ?: remoteRoleLabel(message.role),
                                fontWeight = FontWeight.SemiBold,
                            )
                            message.detail?.takeIf(String::isNotBlank)?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall)
                            }
                            if (message.text.isNotBlank()) RemoteMarkdownContent(message.text)
                            message.progress?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
            }
            items(state.artifacts, key = { "artifact-${it.artifactId}" }) { artifact ->
                OutlinedCard {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(artifact.name, fontWeight = FontWeight.SemiBold)
                            Text("${artifact.mimeType} · ${artifact.size} B", style = MaterialTheme.typography.bodySmall)
                            artifact.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        }
                        Button(onClick = { onOpenArtifact(artifact.artifactId) }, enabled = state.online && !artifact.downloading) {
                            Text(if (artifact.downloading) "下载中" else "下载并打开")
                        }
                    }
                }
            }
            state.approval?.let { approval -> item { ApprovalCard(approval, state.online, onApproval) } }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(input, { input = it }, Modifier.weight(1f), enabled = state.online && !state.running,
                placeholder = { Text(if (state.online) "发送消息" else "离线时只能查看历史") })
            Spacer(Modifier.width(8.dp))
            if (state.running) Button(onClick = onCancelRun, enabled = state.online) { Text("停止") }
            else Button(onClick = { val value = input; input = ""; onSend(value) }, enabled = state.online && input.isNotBlank()) { Text("发送") }
        }
    }
}

@Composable
private fun ApprovalCard(card: RemoteApprovalCard, enabled: Boolean, onDecision: (String, String) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("需要你的确认", fontWeight = FontWeight.Bold)
            Text("${card.runtimeName} · ${card.workspaceName} · ${card.agentName} · ${card.identity.backendId}")
            Text(card.operation); Text(card.safeSummary); Text("范围：${card.safeScope}"); Text("过期：${card.expiresAt}")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDecision(card.approvalId.value, "approve") }, enabled = enabled) { Text("同意") }
                OutlinedButton(onClick = { onDecision(card.approvalId.value, "deny") }, enabled = enabled) { Text("拒绝") }
                TextButton(onClick = { onDecision(card.approvalId.value, "cancel") }, enabled = enabled) { Text("取消") }
            }
        }
    }
}
