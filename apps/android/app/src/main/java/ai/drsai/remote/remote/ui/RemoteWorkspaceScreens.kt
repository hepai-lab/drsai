package ai.drsai.remote.remote.ui

import ai.drsai.remote.R
import ai.drsai.remote.ui.LocalizedText
import ai.drsai.remote.ui.resolve
import ai.drsai.remote.ui.localizedDateTime

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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material3.Checkbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.data.RemoteActionableState
import ai.drsai.remote.remote.data.RemoteRecoveryAction
import ai.drsai.remote.remote.data.remoteActionableState
import ai.drsai.remote.remote.data.RemoteSearchResult
import ai.drsai.remote.remote.data.RemoteSearchKind
import ai.drsai.remote.remote.data.RemoteSearchSource

@Composable
private fun remoteSearchContext(result: RemoteSearchResult): String = stringResource(when (result.kind) {
    RemoteSearchKind.HOST -> R.string.computer
    RemoteSearchKind.WORKSPACE -> R.string.workspace
    RemoteSearchKind.SESSION -> R.string.conversation
    RemoteSearchKind.MESSAGE -> R.string.cached_message_match
})

@Composable
private fun remoteSearchSource(source: RemoteSearchSource): String = stringResource(when (source) {
    RemoteSearchSource.ONLINE -> R.string.online
    RemoteSearchSource.CACHE -> R.string.local_cache
})

data class RemoteComputerUi(
    val runtimeId: RuntimeId,
    val displayName: String,
    val state: RemoteConnectionState,
    val lastSeenLabel: String,
    val workspaces: List<RemoteWorkspaceRef>,
    val version: String = "",
    val pendingApprovalCount: Int = 0,
    val unreadTurnCount: Int = 0,
    val runningRunCount: Int = 0,
    val lastActivityAt: String = "",
    val workspacesCached: Boolean = false,
    val lastSyncedAtMillis: Long? = null,
    val workspaceSyncStatus: String? = null,
    val workspaceSyncFailed: Boolean = false,
    val workspaceSyncSucceeded: Boolean = false,
    val lastSeenText: LocalizedText? = null,
    val workspaceSyncText: LocalizedText? = null,
)

data class RemoteHomeUiState(
    val computers: List<RemoteComputerUi> = emptyList(),
    val query: String = "",
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val stale: Boolean = false,
    val error: String? = null,
    val errorText: LocalizedText? = null,
    val actionableError: RemoteActionableState? = null,
    val recentlyAssociatedRuntimeId: RuntimeId? = null,
    val refreshingRuntimeIds: Set<RuntimeId> = emptySet(),
    val searchResults: List<RemoteSearchResult> = emptyList(),
    val notificationState: RemoteNotificationReadiness = RemoteNotificationReadiness.READY,
    val diagnostic: RemoteConnectionDiagnostic? = null,
    val pairing: ai.drsai.remote.remote.data.RemotePairingJourneyState =
        ai.drsai.remote.remote.data.RemotePairingJourneyState(),
) {
    val lifecycleState: ai.drsai.remote.remote.data.RemoteLifecycleState get() = when {
        loading -> ai.drsai.remote.remote.data.RemoteLifecycleState.LOADING
        actionableError?.action == RemoteRecoveryAction.REASSOCIATE -> ai.drsai.remote.remote.data.RemoteLifecycleState.REVOKED
        actionableError?.action == RemoteRecoveryAction.SIGN_IN -> ai.drsai.remote.remote.data.RemoteLifecycleState.AUTH_REQUIRED
        actionableError?.action == RemoteRecoveryAction.UPDATE_APP -> ai.drsai.remote.remote.data.RemoteLifecycleState.INCOMPATIBLE
        stale || refreshing && computers.isNotEmpty() -> ai.drsai.remote.remote.data.RemoteLifecycleState.STALE
        computers.isNotEmpty() -> ai.drsai.remote.remote.data.RemoteLifecycleState.ONLINE
        error != null -> ai.drsai.remote.remote.data.RemoteLifecycleState.OFFLINE
        else -> ai.drsai.remote.remote.data.RemoteLifecycleState.IDLE
    }
}

enum class RemoteNotificationReadiness {
    READY,
    CHECKING,
    PERMISSION_REQUIRED,
    PROVIDER_NOT_CONFIGURED,
    PLAY_SERVICES_UNAVAILABLE,
    PLATFORM_UNAVAILABLE,
}

@Composable
fun RemoteHomeScreen(
    state: RemoteHomeUiState,
    onBack: () -> Unit,
    onAssociate: () -> Unit,
    onRefresh: () -> Unit,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit = {},
    onRevokeAssociation: (RuntimeId) -> Unit = {},
    onRevokeAssociationAndClear: (RuntimeId) -> Unit = onRevokeAssociation,
    onQueryChange: (String) -> Unit = {},
    onSignIn: () -> Unit = onBack,
    onCheckUpdate: () -> Unit = {},
    onContactAdmin: () -> Unit = onBack,
    onOpenSearchResult: (RemoteSearchResult) -> Unit = {},
    onEnableNotifications: () -> Unit = {},
    onDiagnose: () -> Unit = {},
    onDiagnosticAction: (RemoteDiagnosticAction) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val uiLanguage = currentRemoteUiLanguage()
    Box(modifier.fillMaxSize()) {
        when {
            state.loading && state.computers.isEmpty() -> RemoteLoadingState(Modifier.align(Alignment.Center))
            state.computers.isEmpty() -> RemoteEmptyState(onAssociate, Modifier.align(Alignment.Center))
            else -> RemoteComputerList(
                state,
                onOpenWorkspace,
                onRevokeAssociation,
                onRevokeAssociationAndClear,
                onRefreshWorkspaces,
                onOpenSearchResult,
                onHostAction = { action, runtimeId -> when (action) {
                    RemoteRecoveryAction.SIGN_IN -> onSignIn()
                    RemoteRecoveryAction.UPDATE_APP -> onCheckUpdate()
                    RemoteRecoveryAction.REASSOCIATE -> onAssociate()
                    else -> onRefreshWorkspaces(runtimeId)
                } },
            )
        }

        Column(
            Modifier.align(Alignment.TopCenter).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FloatingPageHeader(
                title = stringResource(R.string.remote_workspaces),
                onBack = onBack,
                onAssociate = onAssociate,
                onRefresh = onRefresh,
                onDiagnose = onDiagnose,
                refreshing = state.refreshing,
            )
            val workspaceSearchDescription = stringResource(R.string.search_remote_workspaces_a11y)
            OutlinedTextField(
                value = state.query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = workspaceSearchDescription },
                singleLine = true,
                shape = RoundedCornerShape(20.dp),
                leadingIcon = { Icon(Icons.Default.Search, null) },
            placeholder = { Text(stringResource(R.string.search_computer_workspace)) },
            )
            if (state.stale) RemoteStatusBanner(stringResource(R.string.showing_last_synced_content))
            when (state.pairing.stage) {
                ai.drsai.remote.remote.data.RemotePairingStage.SCANNING ->
                    RemoteStatusBanner(stringResource(R.string.scan_one_time_qr_code))
                ai.drsai.remote.remote.data.RemotePairingStage.CONNECTING ->
                    RemoteStatusBanner(stringResource(R.string.securely_connecting_computer))
                ai.drsai.remote.remote.data.RemotePairingStage.COMPLETE ->
                    RemoteStatusBanner(stringResource(R.string.computer_connected_choose_workspace))
                else -> Unit
            }
            if (state.computers.isNotEmpty() && state.notificationState != RemoteNotificationReadiness.READY) {
                RemoteNotificationReadinessCard(state.notificationState, onEnableNotifications)
            }
            state.diagnostic?.let { rawDiagnostic ->
                val diagnostic = remoteConnectionDiagnosticPresentation(rawDiagnostic)
                val diagnosticDescription = stringResource(
                    R.string.connection_check_a11y,
                    diagnostic.title,
                    diagnostic.reason,
                )
                Surface(
                    modifier = Modifier.fillMaxWidth().semantics {
                        liveRegion = LiveRegionMode.Polite
                        contentDescription = diagnosticDescription
                    },
                    shape = RoundedCornerShape(14.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(diagnostic.title, fontWeight = FontWeight.SemiBold)
                            Text(diagnostic.reason, style = MaterialTheme.typography.bodySmall)
                        }
                        diagnostic.actionLabel?.let { label ->
                            TextButton(onClick = { onDiagnosticAction(rawDiagnostic.action) }) { Text(label) }
                        }
                    }
                }
            }
            (state.errorText?.resolve() ?: state.error)?.let {
                RemoteActionableStateCard(
                    state.actionableError ?: remoteActionableState(state.lifecycleState) ?: return@let,
                    language = uiLanguage,
                    onAction = { action -> when (action) {
                        RemoteRecoveryAction.REASSOCIATE -> onAssociate()
                        RemoteRecoveryAction.SIGN_IN -> onSignIn()
                        RemoteRecoveryAction.UPDATE_APP -> onCheckUpdate()
                        RemoteRecoveryAction.CONTACT_ADMIN -> onContactAdmin()
                        else -> onRefresh()
                    } },
                )
            }
        }
    }
}

@Composable
private fun RemoteNotificationReadinessCard(
    state: RemoteNotificationReadiness,
    onEnableNotifications: () -> Unit,
) {
    val presentation = remoteNotificationPresentation(state) ?: return
    Surface(
        modifier = Modifier.semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = presentation.accessibilityDescription
        },
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(presentation.title, fontWeight = FontWeight.SemiBold)
                Text(presentation.reason, style = MaterialTheme.typography.bodySmall)
            }
            if (state == RemoteNotificationReadiness.PERMISSION_REQUIRED) {
                TextButton(onClick = onEnableNotifications) {
                    Text(requireNotNull(presentation.actionLabel))
                }
            }
        }
    }
}

@Composable
fun RemoteActionableStateCard(
    state: RemoteActionableState,
    onAction: (RemoteRecoveryAction) -> Unit,
    modifier: Modifier = Modifier,
    language: RemoteUiLanguage? = null,
) {
    val presentation = localizedRemoteActionableState(state)
    val actionableAccessibility = stringResource(
        R.string.remote_status_accessibility,
        presentation.title,
        presentation.reason.trimEnd('。', '.'),
    ) + (presentation.actionLabel?.let { stringResource(R.string.remote_status_action_accessibility, it) } ?: "")
    Surface(modifier.fillMaxWidth().semantics {
        liveRegion = LiveRegionMode.Polite
        contentDescription = actionableAccessibility
    }, shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(presentation.title, fontWeight = FontWeight.SemiBold)
                Text(presentation.reason, style = MaterialTheme.typography.bodySmall)
            }
            presentation.actionLabel?.let { label ->
                TextButton(onClick = { onAction(presentation.action) }) { Text(label) }
            }
        }
    }
}

@Composable
fun FloatingPageHeader(
    title: String,
    onBack: () -> Unit,
    onAssociate: () -> Unit,
    onRefresh: () -> Unit,
    onDiagnose: () -> Unit,
    refreshing: Boolean,
    modifier: Modifier = Modifier,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val backDescription = stringResource(R.string.back)
    val moreDescription = stringResource(R.string.more)
    val associateMenuDescription = stringResource(R.string.scan_link_menu_item_a11y)
    val controlColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.60f)
        .compositeOver(MaterialTheme.colorScheme.background)
    Box(modifier.fillMaxWidth().heightIn(min = 52.dp)) {
        HeaderControl(Modifier.align(Alignment.CenterStart)) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, backDescription)
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
            Box(Modifier.heightIn(min = 52.dp).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Text(
                    title,
                    Modifier.semantics { heading() },
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(Modifier.align(Alignment.CenterEnd)) {
            HeaderControl {
                IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, moreDescription) }
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    modifier = Modifier.semantics { contentDescription = associateMenuDescription },
                        text = { Text(stringResource(R.string.scan_link_computer)) },
                    leadingIcon = { Icon(Icons.Default.QrCodeScanner, null) },
                    onClick = { menuOpen = false; onAssociate() },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(if (refreshing) R.string.refreshing else R.string.refresh)) },
                    leadingIcon = { Icon(Icons.Default.Refresh, null) },
                    enabled = !refreshing,
                    onClick = { menuOpen = false; onRefresh() },
                )
                DropdownMenuItem(
                        text = { Text(stringResource(R.string.check_connection)) },
                    leadingIcon = { Icon(Icons.Default.Computer, null) },
                    onClick = { menuOpen = false; onDiagnose() },
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
    val associateButtonDescription = stringResource(R.string.scan_link_primary_button_a11y)
    Column(
        modifier.padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Default.Computer, null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.no_linked_computers), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.enable_remote_access_then_scan),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = onAssociate,
            modifier = Modifier.semantics { contentDescription = associateButtonDescription },
        ) {
            Icon(Icons.Default.QrCodeScanner, null)
            Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.scan_link_computer))
        }
    }
}

@Composable
private fun RemoteLoadingState(modifier: Modifier = Modifier) {
        Text(stringResource(R.string.loading_remote_workspaces), modifier, style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun RemoteComputerList(
    state: RemoteHomeUiState,
    onOpenWorkspace: (RemoteWorkspaceRef) -> Unit,
    onRevokeAssociation: (RuntimeId) -> Unit,
    onRevokeAssociationAndClear: (RuntimeId) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit,
    onOpenSearchResult: (RemoteSearchResult) -> Unit,
    onHostAction: (RemoteRecoveryAction, RuntimeId) -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(start = 12.dp, end = 12.dp, top = 146.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (state.query.isNotBlank() && state.searchResults.isNotEmpty()) {
            item(key = "unified-search-results") {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.search_results), fontWeight = FontWeight.SemiBold)
                    state.searchResults.forEach { result ->
                        Surface(
                            Modifier.fillMaxWidth().clickable { onOpenSearchResult(result) },
                            shape = RoundedCornerShape(12.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                        ) {
                            Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(result.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(remoteSearchContext(result), style = MaterialTheme.typography.labelSmall)
                                }
                                Text(remoteSearchSource(result.source), style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }
        items(state.computers, key = { it.runtimeId.value }) { computer ->
            RemoteComputerCard(
                computer,
                computer.runtimeId == state.recentlyAssociatedRuntimeId,
                onOpenWorkspace,
                onRevokeAssociation,
                onRevokeAssociationAndClear,
                onRefreshWorkspaces,
                onHostAction,
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
    onRevokeAssociationAndClear: (RuntimeId) -> Unit,
    onRefreshWorkspaces: (RuntimeId) -> Unit,
    onHostAction: (RemoteRecoveryAction, RuntimeId) -> Unit,
    refreshingWorkspaces: Boolean,
) {
    val status = remoteHostStatusPresentation(computer.state, computer.lastSeenLabel)
    val refreshWorkspacesDescription = stringResource(R.string.refresh_computer_workspaces_a11y, computer.displayName)
    val collapseWorkspacesDescription = stringResource(R.string.collapse_workspaces)
    val expandWorkspacesDescription = stringResource(R.string.expand_workspaces)
    val computerActionsDescription = stringResource(R.string.computer_actions)
    val unlinkComputerDescription = stringResource(R.string.unlink_computer_a11y, computer.displayName)
    var expanded by remember(computer.runtimeId) { mutableStateOf(true) }
    var menuOpen by remember(computer.runtimeId) { mutableStateOf(false) }
    var confirmRevoke by remember(computer.runtimeId) { mutableStateOf(false) }
    var clearLocalCache by remember(computer.runtimeId) { mutableStateOf(false) }
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
                        Text(stringResource(R.string.just_linked), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    }
                    RemoteConnectionIndicator(computer.state, status)
                    Text(status.reason, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    status.actionLabel?.let { label ->
                        TextButton(onClick = { onHostAction(status.action, computer.runtimeId) }) { Text(label) }
                    }
                    if (computer.workspacesCached && computer.state !in setOf(RemoteConnectionState.OFFLINE, RemoteConnectionState.PAUSED)) {
                        Text(
                            if (computer.workspacesCached && computer.lastSyncedAtMillis != null) {
                                stringResource(
                                    R.string.remote_cached_last_synced,
                                    localizedDateTime(computer.lastSyncedAtMillis),
                                )
                            } else computer.lastSeenText?.resolve() ?: computer.lastSeenLabel.takeIf(String::isNotBlank)
                                ?: stringResource(R.string.cached_workspace_directory),
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
                    (if (computer.workspaceSyncSucceeded && computer.lastSyncedAtMillis != null) {
                        stringResource(R.string.remote_synced_at, localizedDateTime(computer.lastSyncedAtMillis))
                    } else computer.workspaceSyncText?.resolve() ?: computer.workspaceSyncStatus)?.let { status ->
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
                        Text(pluralStringResource(R.plurals.pending_confirmation_count, computer.pendingApprovalCount, computer.pendingApprovalCount), color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(8.dp))
                }
                if (computer.unreadTurnCount > 0) {
                        Text(pluralStringResource(R.plurals.unread_count, computer.unreadTurnCount, computer.unreadTurnCount), color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(8.dp))
                }
                if (computer.runningRunCount > 0) {
                        Text(pluralStringResource(R.plurals.running_count, computer.runningRunCount, computer.runningRunCount), color = MaterialTheme.colorScheme.tertiary)
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
                            refreshWorkspacesDescription,
                        )
                    }
                }
                IconButton(onClick = { expanded = !expanded }) {
                    Icon(
                        if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        if (expanded) collapseWorkspacesDescription else expandWorkspacesDescription,
                    )
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, computerActionsDescription)
                    }
                    DropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                    ) {
                        DropdownMenuItem(
                            modifier = Modifier.semantics {
                                contentDescription = unlinkComputerDescription
                            },
                    text = { Text(stringResource(R.string.unlink)) },
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
            title = { Text(stringResource(R.string.unlink_question)) },
            text = { Column {
                    Text(stringResource(R.string.unlink_detail, computer.displayName))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(clearLocalCache, { clearLocalCache = it })
                        Text(stringResource(R.string.clear_local_projection))
                }
            } },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmRevoke = false
                        if (clearLocalCache) onRevokeAssociationAndClear(computer.runtimeId)
                        else onRevokeAssociation(computer.runtimeId)
                    },
                ) { Text(stringResource(R.string.unlink)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRevoke = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
private fun RemoteConnectionIndicator(
    state: RemoteConnectionState,
    presentation: RemoteHostStatusPresentation,
) {
    val connecting = state == RemoteConnectionState.CONNECTING
    val animationsEnabled = ai.drsai.remote.ui.ReducedMotionPolicy.animationsEnabled(
        android.animation.ValueAnimator.areAnimatorsEnabled(),
    )
    val pulseAlpha = if (connecting && animationsEnabled) {
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
        RemoteConnectionState.PAUSED -> MaterialTheme.colorScheme.outline
        RemoteConnectionState.CONNECTING -> MaterialTheme.colorScheme.primary
        RemoteConnectionState.DEGRADED,
        RemoteConnectionState.INCOMPATIBLE -> Color(0xFFB7791F)
        RemoteConnectionState.AUTH_REQUIRED -> MaterialTheme.colorScheme.error
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.semantics {
            contentDescription = presentation.accessibilityDescription
        },
    ) {
        Box(
            Modifier
                .size(8.dp)
                .alpha(pulseAlpha)
                .background(color, CircleShape),
        )
        Spacer(Modifier.width(6.dp))
        Text(presentation.title, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RemoteStatusBanner(message: String, error: Boolean = false) {
    Surface(
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(14.dp),
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Text(message, Modifier.padding(horizontal = 14.dp, vertical = 9.dp), style = MaterialTheme.typography.bodySmall)
    }
}
