package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import ai.drsai.remote.ui.LocalizedText
import ai.drsai.remote.ui.resolve
import ai.drsai.remote.ui.localizedBytes
import ai.drsai.remote.ui.localizedDateTime

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
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import ai.drsai.remote.remote.data.labelResource
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
    val instructionStatusText: LocalizedText? = null,
    val errorText: LocalizedText? = null,
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
            TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }
            Column(Modifier.weight(1f)) {
                Text(state.workspaceName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(state.runtimeName, style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRefresh) { Text(stringResource(R.string.refresh)) }
            TextButton(onClick = onToggleArchived) { Text(stringResource(if (state.showArchived) R.string.active_sessions else R.string.archived)) }
            Button(onClick = { agentPickerOpen = true }, enabled = !state.creating && state.agentDefinitions.isNotEmpty() && !state.instructionRefreshRequired) {
                Text(stringResource(if (state.creating) R.string.creating else R.string.new_session))
            }
        }
        OutlinedTextField(state.query, onSearch, Modifier.fillMaxWidth(), placeholder = { Text(stringResource(R.string.search_sessions)) })
        if (state.pendingApprovalCount > 0) {
            Text(pluralStringResource(R.plurals.pending_confirmation_count, state.pendingApprovalCount, state.pendingApprovalCount), color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            state.capabilities.forEach { AssistChip(onClick = { onOpenCapability(it.name) }, enabled = it.available,
                label = { Text(it.name) }) }
        }
        Text(
            stringResource(R.string.remote_execution_safety_notice),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        (state.instructionStatusText?.resolve() ?: state.instructionStatus)?.let { status ->
            Text(
                status + state.instructionVersions.values.firstOrNull()?.let { " · ${it.take(12)}" }.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (state.instructionRefreshRequired) {
            OutlinedButton(onClick = onConfirmInstructions, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.confirm_latest_project_instructions))
            }
        }
        (state.errorText?.resolve() ?: state.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(activeSessions, key = { it.reference.sessionId.value }) { session ->
                Card(onClick = { if (!state.showArchived) onOpen(session.reference) }) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(session.reference.title, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.remote_session_summary, session.reference.backendId, session.lastRunStatus ?: stringResource(R.string.never_run), localizedDateTime(session.updatedAtLabel)),
                                style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (session.unreadTurns > 0) Text(pluralStringResource(R.plurals.unread_count, session.unreadTurns, session.unreadTurns), color = MaterialTheme.colorScheme.primary)
                        if (session.pendingApprovals > 0) Text(pluralStringResource(R.plurals.pending_confirmation_count, session.pendingApprovals, session.pendingApprovals), color = MaterialTheme.colorScheme.error)
                        if (session.runningRuns > 0) Text(pluralStringResource(R.plurals.running_count, session.runningRuns, session.runningRuns), color = MaterialTheme.colorScheme.tertiary)
                            }
                        }
                        Box {
                    TextButton(onClick = { sessionMenu = session.reference }) { Text(stringResource(R.string.manage)) }
                            DropdownMenu(
                                expanded = sessionMenu?.sessionId == session.reference.sessionId,
                                onDismissRequest = { sessionMenu = null },
                            ) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = {
                                    sessionMenu = null
                                    renameTarget = session.reference
                                    renameText = session.reference.title
                                })
                                DropdownMenuItem(
                                    text = { Text(stringResource(if (state.showArchived) R.string.unarchive else R.string.archive)) },
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
            title = { Text(stringResource(R.string.choose_remote_agent)) },
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
                                Text(stringResource(R.string.backend_version, definition.backendId, definition.version), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { agentPickerOpen = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.rename_session)) },
            text = { OutlinedTextField(renameText, { renameText = it },
                    Modifier.testTag("session-rename-input"), singleLine = true, label = { Text(stringResource(R.string.session_name)) }) },
            confirmButton = { TextButton(onClick = {
                if (renameText.trim().isNotEmpty()) onRename(target, renameText.trim())
                renameTarget = null
                }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

enum class RemoteAuditActionKind { RUN_CREATED, RUN_CANCELLED, APPROVAL_REQUESTED, APPROVAL_APPROVED, APPROVAL_DENIED, UPDATED }

fun remoteAuditActionKind(action: String): RemoteAuditActionKind = when (action) {
    "run.created" -> RemoteAuditActionKind.RUN_CREATED
    "run.cancelled" -> RemoteAuditActionKind.RUN_CANCELLED
    "approval.requested" -> RemoteAuditActionKind.APPROVAL_REQUESTED
    "approval.approved" -> RemoteAuditActionKind.APPROVAL_APPROVED
    "approval.denied" -> RemoteAuditActionKind.APPROVAL_DENIED
    else -> RemoteAuditActionKind.UPDATED
}

@Composable
fun remoteAuditActionLabel(action: String): String = stringResource(when (remoteAuditActionKind(action)) {
    RemoteAuditActionKind.RUN_CREATED -> R.string.audit_run_created
    RemoteAuditActionKind.RUN_CANCELLED -> R.string.audit_run_cancelled
    RemoteAuditActionKind.APPROVAL_REQUESTED -> R.string.audit_approval_requested
    RemoteAuditActionKind.APPROVAL_APPROVED -> R.string.audit_approval_approved
    RemoteAuditActionKind.APPROVAL_DENIED -> R.string.audit_approval_denied
    RemoteAuditActionKind.UPDATED -> R.string.audit_updated
})

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
            TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }
            Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.audit_log), fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.runtime_workspace, runtimeName, workspaceName), style = MaterialTheme.typography.labelSmall)
            }
            TextButton(onClick = onRefresh) { Text(stringResource(R.string.refresh)) }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!loading && entries.isEmpty()) Text(stringResource(R.string.no_audit_entries))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(entries, key = { it.auditId }) { entry ->
                Card {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(remoteAuditActionLabel(entry.action), fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.audit_actor, entry.actorLabel), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.workspace_label, workspaceName), style = MaterialTheme.typography.bodySmall)
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
    val localizedText: LocalizedText? = null,
)
data class RemoteArtifactUi(val artifactId: String, val name: String, val mimeType: String, val size: Long,
                            val sha256: String, val downloading: Boolean = false, val error: String? = null,
                            val errorText: LocalizedText? = null)
enum class RemoteTranscriptFilter { ALL, RUN, TOOL, FILE }

@Composable
fun remoteTranscriptFilterLabel(filter: RemoteTranscriptFilter): String = stringResource(when (filter) {
    RemoteTranscriptFilter.ALL -> R.string.all_filter
    RemoteTranscriptFilter.RUN -> R.string.run_filter
    RemoteTranscriptFilter.TOOL -> R.string.tool_filter
    RemoteTranscriptFilter.FILE -> R.string.file_filter
})
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
            .any { value -> "file" in value.lowercase() }
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
    val approvalOutcomeText: LocalizedText? = null,
    val runControlOutcomeText: LocalizedText? = null,
    val historyErrorText: LocalizedText? = null,
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
            title = { Text(stringResource(R.string.cellular_download_question)) },
            text = { Text(stringResource(R.string.cellular_download_detail)) },
            confirmButton = { TextButton(onClick = { onConfirmArtifact(true) }) { Text(stringResource(R.string.continue_download)) } },
            dismissButton = { TextButton(onClick = { onConfirmArtifact(false) }) { Text(stringResource(R.string.cancel)) } },
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
                TextButton(onClick = onBack) { Text(stringResource(R.string.back)) }
            Column(Modifier.weight(1f)) {
                Text(state.sessionTitle, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.runtime_workspace, state.runtimeName, state.workspaceName), style = MaterialTheme.typography.labelSmall)
            }
                state.correlationId?.let { TextButton(onClick = onOpenAudit) { Text(stringResource(R.string.audit)) } }
        }
            if (!state.online) Text(stringResource(R.string.connection_interrupted), color = MaterialTheme.colorScheme.error)
        if (state.connectionState == RemoteConnectionState.AUTH_REQUIRED) {
            RemoteActionableStateCard(
                requireNotNull(remoteActionableState(state.lifecycleState)),
                onAction = { onSignIn() },
            )
        }
        when (state.focusItemState) {
                RemoteFocusItemState.LOADING -> Text(stringResource(R.string.locating_notification_content))
            RemoteFocusItemState.NOT_FOUND -> Text(
                stringResource(R.string.notification_content_unavailable),
                color = MaterialTheme.colorScheme.error,
            )
            else -> Unit
        }
        (state.runControlOutcomeText?.resolve() ?: state.runControlOutcome)?.let {
            Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(
            value = state.transcriptSearchQuery,
            onValueChange = onSearchTranscript,
            modifier = Modifier.fillMaxWidth().testTag("remote-transcript-search"),
            singleLine = true,
                        label = { Text(stringResource(R.string.search_cached_sessions)) },
            trailingIcon = {
                if (state.transcriptSearching) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            },
        )
        if (state.transcriptSearchTruncated) {
                    Text(stringResource(R.string.search_limit_notice), style = MaterialTheme.typography.labelSmall)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RemoteTranscriptFilter.entries.forEach { filter ->
                FilterChip(
                    selected = transcriptFilter == filter,
                    onClick = { transcriptFilter = filter },
                    label = { Text(remoteTranscriptFilterLabel(filter)) },
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
            ) { Text(stringResource(if (state.loadingHistory) R.string.loading_history else R.string.load_older_content)) }
        }
        (state.historyErrorText?.resolve() ?: state.historyError)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(
            Modifier.weight(1f).testTag("remote-transcript"),
            state = transcriptListState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (transcriptSearchActive && !state.transcriptSearching && visibleMessages.isEmpty()) {
                item("remote-transcript-search-empty") {
                    Text(
                        stringResource(R.string.no_synced_transcript_results),
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
                                Text(stringResource(R.string.new_content_below), color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.labelMedium)
                }
                OaepSemanticItem(
                    message.role, message.localizedText?.resolve() ?: message.text, message.progress, message.kind, message.title,
                    message.detail, message.phase, message.resources,
                )
                message.deliveryState?.let { Text(stringResource(it.labelResource()), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary) }
            }
            if (!transcriptSearchActive) items(state.artifacts, key = { "artifact-${it.artifactId}" }) { artifact ->
                OutlinedCard {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(artifact.name, fontWeight = FontWeight.SemiBold)
                                Text(stringResource(R.string.artifact_mime_size, artifact.mimeType, localizedBytes(artifact.size)), style = MaterialTheme.typography.bodySmall)
                            (artifact.errorText?.resolve() ?: artifact.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                        }
                        Button(onClick = { onOpenArtifact(artifact.artifactId) }, enabled = state.online && !artifact.downloading) {
                            Text(stringResource(if (artifact.downloading) R.string.downloading else R.string.download_and_open))
                        }
                    }
                }
            }
            if (!transcriptSearchActive) state.approval?.let { approval -> item { ApprovalCard(
                approval, state.online && state.approvalDecisionState == RemoteApprovalDecisionState.PENDING,
                state.approvalDecisionState, onApproval,
            ) } }
        }
        (state.approvalOutcomeText?.resolve() ?: state.approvalOutcome)?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
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
                ) { Text(pluralStringResource(R.plurals.jump_latest_count, count, count)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(input, { value -> input = value; onDraftChange(value) }, Modifier.weight(1f), enabled = state.online && !state.running,
                placeholder = { Text(stringResource(if (state.online) R.string.send_message else R.string.offline_history_only)) })
            Spacer(Modifier.width(8.dp))
            if (state.running) Button(onClick = onCancelRun,
                enabled = state.online && state.runControlState == RemoteRunControlState.IDLE) {
                Text(when (state.runControlState) {
                    RemoteRunControlState.CANCELLING -> stringResource(R.string.stopping)
                    RemoteRunControlState.RECONCILING -> stringResource(R.string.confirming_status)
                    else -> stringResource(R.string.stop)
                })
            }
                else Button(onClick = { onSend(input) }, enabled = state.online && input.isNotBlank()) { Text(stringResource(R.string.send_message)) }
        }
        if (state.canRetry && !state.running) {
            OutlinedButton(onClick = onRetryRun,
                enabled = state.online && state.runControlState == RemoteRunControlState.IDLE,
                modifier = Modifier.fillMaxWidth()) {
                Text(when (state.runControlState) {
                    RemoteRunControlState.RETRYING -> stringResource(R.string.retrying)
                    RemoteRunControlState.RECONCILING -> stringResource(R.string.confirming_status)
                    else -> stringResource(R.string.retry_last_run)
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
            Text(stringResource(R.string.confirmation_required), fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.approval_identity_summary, card.runtimeName, card.workspaceName, card.agentName, card.identity.backendId))
            Text(card.operation); Text(card.safeSummary); Text(stringResource(R.string.scope_label, card.safeScope)); Text(stringResource(R.string.expires_label, card.expiresAt))
            if (decisionState == RemoteApprovalDecisionState.DECIDING) Text(stringResource(R.string.submitting_decision))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDecision(card.approvalId.value, "approve") }, enabled = enabled) { Text(stringResource(R.string.approve)) }
                OutlinedButton(onClick = { onDecision(card.approvalId.value, "deny") }, enabled = enabled) { Text(stringResource(R.string.decline)) }
                TextButton(onClick = { onDecision(card.approvalId.value, "cancel") }, enabled = enabled) { Text(stringResource(R.string.cancel)) }
            }
        }
    }
}
