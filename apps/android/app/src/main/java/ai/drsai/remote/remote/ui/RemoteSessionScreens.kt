package ai.drsai.remote.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.RemoteAuditEntry
import ai.drsai.remote.remote.data.RemoteDeliveryState
import ai.drsai.remote.remote.data.RemoteApprovalDecisionState
import ai.drsai.remote.remote.data.RemoteRunControlState
import ai.drsai.remote.remote.data.RemoteSessionUiAuthorityState
import ai.drsai.remote.remote.data.reduceRemoteTimelineUpdate
import ai.drsai.remote.remote.data.remoteActionableState
import ai.drsai.remote.remote.data.userLabel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.launch

data class RemoteCapabilityUi(val name: String, val available: Boolean)
data class RemoteSessionUi(val reference: RemoteSessionRef, val lastRunStatus: String?, val updatedAtLabel: String,
                           val lifecycle: String = "active", val unreadTurns: Int = 0,
                           val pendingApprovals: Int = 0, val runningRuns: Int = 0)
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
            compareByDescending<RemoteSessionUi> { it.pendingApprovals > 0 }
                .thenByDescending { it.runningRuns > 0 }
                .thenByDescending { it.unreadTurns }
                .thenByDescending { it.updatedAtLabel }
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
    val showArchived: Boolean = false,
)

@Composable
fun WorkspaceSessionsScreen(state: WorkspaceSessionsUiState, onBack: () -> Unit, onRefresh: () -> Unit,
                            onSearch: (String) -> Unit, onCreate: (RemoteAgentDefinition) -> Unit,
                            onOpen: (RemoteSessionRef) -> Unit, onResume: () -> Unit = onRefresh,
                            onOpenCapability: (String) -> Unit = {}, onConfirmInstructions: () -> Unit = {},
                            onToggleArchived: () -> Unit = {},
                            onRename: (RemoteSessionRef, String) -> Unit = { _, _ -> },
                            onSetArchived: (RemoteSessionRef, Boolean) -> Unit = { _, _ -> }) {
    var agentPickerOpen by remember { mutableStateOf(false) }
    var sessionMenu by remember { mutableStateOf<RemoteSessionRef?>(null) }
    var renameTarget by remember { mutableStateOf<RemoteSessionRef?>(null) }
    var renameText by remember { mutableStateOf("") }
    val activeSessions = if (state.showArchived) {
        state.sessions.filter { it.lifecycle == "archived" || it.reference.lifecycle == RemoteResourceLifecycle.ARCHIVED }
            .sortedByDescending { it.updatedAtLabel }
    } else activeRemoteSessions(state.sessions)
    LifecycleEventEffect(Lifecycle.Event.ON_START) { onResume() }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("返回") }
            Column(Modifier.weight(1f)) {
                Text(state.workspaceName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(state.runtimeName, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRefresh) { Text("刷新") }
            TextButton(onClick = onToggleArchived) { Text(if (state.showArchived) "活动会话" else "已归档") }
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
                Card(onClick = { if (!state.showArchived) onOpen(session.reference) }) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(session.reference.title, fontWeight = FontWeight.SemiBold)
                            Text("${session.reference.backendId} · ${session.lastRunStatus ?: "尚未运行"} · ${session.updatedAtLabel}",
                                style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (session.unreadTurns > 0) Text("未读 ${session.unreadTurns}", color = MaterialTheme.colorScheme.primary)
                                if (session.pendingApprovals > 0) Text("待确认 ${session.pendingApprovals}", color = MaterialTheme.colorScheme.error)
                                if (session.runningRuns > 0) Text("运行中 ${session.runningRuns}", color = MaterialTheme.colorScheme.tertiary)
                            }
                        }
                        Box {
                            TextButton(onClick = { sessionMenu = session.reference }) { Text("管理") }
                            DropdownMenu(
                                expanded = sessionMenu?.sessionId == session.reference.sessionId,
                                onDismissRequest = { sessionMenu = null },
                            ) {
                                DropdownMenuItem(text = { Text("重命名") }, onClick = {
                                    sessionMenu = null
                                    renameTarget = session.reference
                                    renameText = session.reference.title
                                })
                                DropdownMenuItem(
                                    text = { Text(if (state.showArchived) "取消归档" else "归档") },
                                    onClick = { sessionMenu = null; onSetArchived(session.reference, !state.showArchived) },
                                )
                            }
                        }
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
    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("重命名会话") },
            text = { OutlinedTextField(renameText, { renameText = it },
                Modifier.testTag("session-rename-input"), singleLine = true, label = { Text("会话名称") }) },
            confirmButton = { TextButton(onClick = {
                if (renameText.trim().isNotEmpty()) onRename(target, renameText.trim())
                renameTarget = null
            }) { Text("保存") } },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("取消") } },
        )
    }
}

fun remoteAuditActionLabel(action: String): String = when (action) {
    "run.created" -> "开始任务"
    "run.cancelled" -> "停止任务"
    "approval.requested" -> "请求审批"
    "approval.approved" -> "批准操作"
    "approval.denied" -> "拒绝操作"
    else -> "更新任务"
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
                        Text(remoteAuditActionLabel(entry.action), fontWeight = FontWeight.SemiBold)
                        Text("操作方：${entry.actorLabel}", style = MaterialTheme.typography.bodySmall)
                        Text("工作区：$workspaceName", style = MaterialTheme.typography.bodySmall)
                        Text(entry.timestamp, style = MaterialTheme.typography.bodySmall)
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
    val runId: String? = null,
    val phase: String? = null,
    val resources: List<RemoteTranscriptResource> = emptyList(),
    val deliveryState: RemoteDeliveryState? = null,
)
data class RemoteArtifactUi(val artifactId: String, val name: String, val mimeType: String, val size: Long,
                            val sha256: String, val downloading: Boolean = false, val error: String? = null)
enum class RemoteTranscriptFilter(val label: String) { ALL("全部"), RUN("运行"), TOOL("工具"), FILE("文件") }
enum class RemoteFocusItemState { IDLE, LOADING, FOUND, NOT_FOUND }

fun filterRemoteTranscript(
    messages: List<RemoteMessageUi>,
    filter: RemoteTranscriptFilter,
): List<RemoteMessageUi> = when (filter) {
    RemoteTranscriptFilter.ALL -> messages
    RemoteTranscriptFilter.RUN -> messages.filter { it.runId != null || it.kind.startsWith("run") }
    RemoteTranscriptFilter.TOOL -> messages.filter { "tool" in it.kind.lowercase() }
    RemoteTranscriptFilter.FILE -> messages.filter { message ->
        message.resources.isNotEmpty() || listOf(message.kind, message.title.orEmpty(), message.detail.orEmpty())
            .any { value -> "file" in value.lowercase() || "文件" in value }
    }
}
data class RemoteChatUiState(
    val runtimeName: String,
    val workspaceName: String,
    val sessionTitle: String,
    val messages: List<RemoteMessageUi> = emptyList(),
    val approval: RemoteApprovalCard? = null,
    val authority: RemoteSessionUiAuthorityState = RemoteSessionUiAuthorityState(),
    val correlationId: String? = null,
    val activeRunId: RunId? = null,
    val artifacts: List<RemoteArtifactUi> = emptyList(),
    val scopeKey: String = "",
    val draft: String = "",
    val approvalDecisionState: RemoteApprovalDecisionState = RemoteApprovalDecisionState.PENDING,
    val approvalOutcome: String? = null,
    val runControlState: RemoteRunControlState = RemoteRunControlState.IDLE,
    val runControlOutcome: String? = null,
    val pendingArtifactConfirmation: String? = null,
    val historyCursor: String? = null,
    val loadingHistory: Boolean = false,
    val historyError: String? = null,
    val transcriptSearchQuery: String = "",
    val transcriptSearchResults: List<RemoteMessageUi>? = null,
    val transcriptSearching: Boolean = false,
    val transcriptSearchTruncated: Boolean = false,
    val focusItemState: RemoteFocusItemState = RemoteFocusItemState.IDLE,
) {
    val running: Boolean get() = authority.running
    val online: Boolean get() = authority.online
    val connectionState: RemoteConnectionState get() = authority.connectionState
    val canRetry: Boolean get() = authority.canRetry
    val lifecycleState: ai.drsai.remote.remote.data.RemoteLifecycleState
        get() = authority.lifecycleState
}

@Composable
fun RemoteChatScreen(state: RemoteChatUiState, onBack: () -> Unit, onSend: (String) -> Unit,
                     onCancelRun: () -> Unit, onApproval: (String, String) -> Unit, onOpenAudit: () -> Unit,
                      onOpenArtifact: (String) -> Unit = {}, onDraftChange: (String) -> Unit = {},
                      onRetryRun: () -> Unit = {}, onConfirmArtifact: (Boolean) -> Unit = {},
                      onLoadOlderHistory: () -> Unit = {}, onSearchTranscript: (String) -> Unit = {},
                      focusItemId: String? = null, onFocusResolved: () -> Unit = {},
                      onSignIn: () -> Unit = {}, onRendered: () -> Unit = {}) {
    var input by remember(state.scopeKey) { mutableStateOf(state.draft) }
    LaunchedEffect(state.scopeKey, state.draft) {
        if (input != state.draft) input = state.draft
    }
    LaunchedEffect(
        state.scopeKey,
        state.authority.generation,
        state.messages,
        state.artifacts,
        state.approval,
    ) {
        withFrameNanos { }
        onRendered()
    }
    val transcriptListState = rememberLazyListState()
    if (state.pendingArtifactConfirmation != null) {
        AlertDialog(
            onDismissRequest = { onConfirmArtifact(false) },
            title = { Text("使用移动网络下载？") },
            text = { Text("这是较大的文件，继续下载可能消耗较多流量。") },
            confirmButton = { TextButton(onClick = { onConfirmArtifact(true) }) { Text("继续下载") } },
            dismissButton = { TextButton(onClick = { onConfirmArtifact(false) }) { Text("取消") } },
        )
    }
    val uiScope = rememberCoroutineScope()
    var transcriptFilter by remember(state.scopeKey) { mutableStateOf(RemoteTranscriptFilter.ALL) }
    var followLatest by remember(state.scopeKey) { mutableStateOf(true) }
    var unreadStart by remember(state.scopeKey) { mutableStateOf<Int?>(null) }
    var previousMessageCount by remember(state.scopeKey) { mutableIntStateOf(0) }
    var focusApplied by remember(state.scopeKey, focusItemId) { mutableStateOf(false) }
    var historyAnchor by remember(state.scopeKey) { mutableStateOf<Pair<String, Int>?>(null) }
    val transcriptSearchActive = state.transcriptSearchQuery.isNotBlank()
    val searchedMessages = state.transcriptSearchResults ?: state.messages
    val visibleMessages = remember(searchedMessages, transcriptFilter) {
        filterRemoteTranscript(searchedMessages, transcriptFilter)
    }
    val rawMessageIndices = remember(state.messages) {
        state.messages.withIndex().associate { it.value.id to it.index }
    }
    val transcriptItemCount = visibleMessages.size + if (transcriptSearchActive) 0 else
        state.artifacts.size + if (state.approval == null) 0 else 1
    LaunchedEffect(state.scopeKey) {
        snapshotFlow {
            val info = transcriptListState.layoutInfo
            info.totalItemsCount == 0 ||
                (info.visibleItemsInfo.lastOrNull()?.index ?: -1) >= info.totalItemsCount - 2
        }.collect { nearBottom -> followLatest = nearBottom }
    }
    LaunchedEffect(state.scopeKey, state.messages.size, state.loadingHistory, transcriptFilter) {
        historyAnchor?.takeIf { !state.loadingHistory }?.let { (itemId, offset) ->
            val restoredIndex = visibleMessages.indexOfFirst { it.id == itemId }
            if (restoredIndex >= 0) transcriptListState.scrollToItem(restoredIndex, offset)
            historyAnchor = null
            previousMessageCount = state.messages.size
            return@LaunchedEffect
        }
        val update = reduceRemoteTimelineUpdate(
            previousMessageCount, state.messages.size, followLatest, unreadStart,
            searchActive = transcriptSearchActive,
        )
        unreadStart = update.unreadStart
        if (transcriptItemCount > 0 && update.scrollToLatest) {
            transcriptListState.scrollToItem(transcriptItemCount - 1)
        }
        previousMessageCount = state.messages.size
    }
    LaunchedEffect(state.scopeKey, focusItemId, visibleMessages) {
        if (focusApplied || focusItemId.isNullOrBlank()) return@LaunchedEffect
        if (transcriptFilter != RemoteTranscriptFilter.ALL) {
            transcriptFilter = RemoteTranscriptFilter.ALL
            return@LaunchedEffect
        }
        val index = visibleMessages.indexOfFirst { it.id == focusItemId }
        if (index >= 0) {
            transcriptListState.scrollToItem(index)
            followLatest = false
            focusApplied = true
            onFocusResolved()
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
        if (state.connectionState == RemoteConnectionState.AUTH_REQUIRED) {
            RemoteActionableStateCard(
                requireNotNull(remoteActionableState(state.lifecycleState)),
                onAction = { onSignIn() },
            )
        }
        when (state.focusItemState) {
            RemoteFocusItemState.LOADING -> Text("正在定位通知对应的内容…")
            RemoteFocusItemState.NOT_FOUND -> Text(
                "通知对应的内容暂时无法读取；重新登录或恢复连接后会继续定位。",
                color = MaterialTheme.colorScheme.error,
            )
            else -> Unit
        }
        state.runControlOutcome?.let {
            Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(
            value = state.transcriptSearchQuery,
            onValueChange = onSearchTranscript,
            modifier = Modifier.fillMaxWidth().testTag("remote-transcript-search"),
            singleLine = true,
            label = { Text("搜索已缓存会话") },
            trailingIcon = {
                if (state.transcriptSearching) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            },
        )
        if (state.transcriptSearchTruncated) {
            Text("仅显示前 200 条结果，请缩小搜索范围", style = MaterialTheme.typography.labelSmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RemoteTranscriptFilter.entries.forEach { filter ->
                FilterChip(
                    selected = transcriptFilter == filter,
                    onClick = { transcriptFilter = filter },
                    label = { Text(filter.label) },
                )
            }
        }
        if (state.historyCursor != null && !transcriptSearchActive) {
            OutlinedButton(
                onClick = {
                    val first = transcriptListState.firstVisibleItemIndex
                    visibleMessages.getOrNull(first)?.let { item ->
                        historyAnchor = item.id to transcriptListState.firstVisibleItemScrollOffset
                    }
                    onLoadOlderHistory()
                },
                enabled = !state.loadingHistory,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (state.loadingHistory) "正在加载历史…" else "加载更早内容") }
        }
        state.historyError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(
            Modifier.weight(1f).testTag("remote-transcript"),
            state = transcriptListState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (transcriptSearchActive && !state.transcriptSearching && visibleMessages.isEmpty()) {
                item("remote-transcript-search-empty") {
                    Text(
                        "未在已同步的会话内容中找到结果",
                        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            itemsIndexed(visibleMessages, key = { _, item -> item.id }) { index, message ->
                val rawIndex = rawMessageIndices[message.id]
                if (!transcriptSearchActive && unreadStart != null && rawIndex == unreadStart) {
                    HorizontalDivider()
                    Text("以下是新内容", color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelMedium)
                }
                OaepSemanticItem(
                    message.role, message.text, message.progress, message.kind, message.title,
                    message.detail, message.phase, message.resources,
                )
                message.deliveryState?.let { Text(it.userLabel(), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary) }
            }
            if (!transcriptSearchActive) items(state.artifacts, key = { "artifact-${it.artifactId}" }) { artifact ->
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
            if (!transcriptSearchActive) state.approval?.let { approval -> item { ApprovalCard(
                approval, state.online && state.approvalDecisionState == RemoteApprovalDecisionState.PENDING,
                state.approvalDecisionState, onApproval,
            ) } }
        }
        state.approvalOutcome?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        if (!transcriptSearchActive) unreadStart?.let { start ->
            val count = (state.messages.size - start).coerceAtLeast(0)
            OutlinedButton(
                onClick = {
                    unreadStart = null
                    if (transcriptItemCount > 0) {
                        uiScope.launch {
                            transcriptListState.animateScrollToItem(transcriptItemCount - 1)
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("跳到最新（$count）") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(input, { value -> input = value; onDraftChange(value) }, Modifier.weight(1f), enabled = state.online && !state.running,
                placeholder = { Text(if (state.online) "发送消息" else "离线时只能查看历史") })
            Spacer(Modifier.width(8.dp))
            if (state.running) Button(onClick = onCancelRun,
                enabled = state.online && state.runControlState == RemoteRunControlState.IDLE) {
                Text(when (state.runControlState) {
                    RemoteRunControlState.CANCELLING -> "停止中"
                    RemoteRunControlState.RECONCILING -> "确认状态中"
                    else -> "停止"
                })
            }
            else Button(onClick = { onSend(input) }, enabled = state.online && input.isNotBlank()) { Text("发送") }
        }
        if (state.canRetry && !state.running) {
            OutlinedButton(onClick = onRetryRun,
                enabled = state.online && state.runControlState == RemoteRunControlState.IDLE,
                modifier = Modifier.fillMaxWidth()) {
                Text(when (state.runControlState) {
                    RemoteRunControlState.RETRYING -> "重试中"
                    RemoteRunControlState.RECONCILING -> "确认状态中"
                    else -> "重试上次运行"
                })
            }
        }
    }
}

@Composable
fun OaepSemanticItem(
    role: String,
    text: String,
    status: String?,
    kind: String,
    title: String?,
    detail: String?,
    phase: String?,
    resources: List<RemoteTranscriptResource>,
) {
    val isUser = role == "user"
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isUser) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
        Surface(
            modifier = if (isUser) Modifier.widthIn(max = 620.dp) else Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = if (isUser) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
        ) {
            Column(Modifier.padding(if (isUser) 12.dp else 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title ?: if (kind == "message") remoteRoleLabel(role) else kind.replace('_', ' '), fontWeight = FontWeight.SemiBold)
                listOfNotNull(phase?.takeIf(String::isNotBlank), detail?.takeIf(String::isNotBlank))
                    .joinToString(" · ").takeIf(String::isNotBlank)?.let {
                        Text(it, style = MaterialTheme.typography.labelSmall)
                    }
                resources.forEach { resource ->
                    Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                        Column(Modifier.fillMaxWidth().padding(8.dp)) {
                            Text(resource.label, fontWeight = FontWeight.Medium)
                            Text(
                                listOfNotNull(resource.kind, resource.mimeType, resource.size?.let { "$it B" })
                                    .joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                }
                if (text.isNotBlank()) RemoteMarkdownContent(text)
                status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun ApprovalCard(card: RemoteApprovalCard, enabled: Boolean, decisionState: RemoteApprovalDecisionState,
                         onDecision: (String, String) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("需要你的确认", fontWeight = FontWeight.Bold)
            Text("${card.runtimeName} · ${card.workspaceName} · ${card.agentName} · ${card.identity.backendId}")
            Text(card.operation); Text(card.safeSummary); Text("范围：${card.safeScope}"); Text("过期：${card.expiresAt}")
            if (decisionState == RemoteApprovalDecisionState.DECIDING) Text("正在提交决定…")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDecision(card.approvalId.value, "approve") }, enabled = enabled) { Text("同意") }
                OutlinedButton(onClick = { onDecision(card.approvalId.value, "deny") }, enabled = enabled) { Text("拒绝") }
                TextButton(onClick = { onDecision(card.approvalId.value, "cancel") }, enabled = enabled) { Text("取消") }
            }
        }
    }
}
