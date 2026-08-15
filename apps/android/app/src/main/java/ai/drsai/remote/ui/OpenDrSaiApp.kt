package ai.drsai.remote.ui

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.speech.RecognizerIntent
import android.widget.Toast
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.compose.material3.rememberDrawerState
import ai.drsai.remote.AppViewModel
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.R
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.ApprovalUiItem
import ai.drsai.remote.data.ApprovalGrantUiItem
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.WorkbenchSessionItem
import ai.drsai.remote.data.WorkbenchWorkspaceItem
import ai.drsai.remote.data.WorkbenchArtifactItem
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.AndroidUpdateManager
import ai.drsai.remote.data.AndroidUpdateSource
import ai.drsai.remote.data.AndroidUpdateState
import ai.drsai.remote.data.AndroidModelProviderPresets
import ai.drsai.remote.data.ModelInfo
import ai.drsai.remote.data.ModelConfigurationMessageKind
import ai.drsai.remote.data.SkillUiItem
import ai.drsai.remote.data.ConnectorUiItem
import ai.drsai.remote.data.mergeDiscoveredModels
import ai.drsai.remote.remote.navigation.AppRoute
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.device.ClipboardAccessPolicy
import ai.drsai.remote.remote.ui.RemoteHomeScreen
import ai.drsai.remote.remote.ui.RemoteHomeViewModel
import ai.drsai.remote.remote.ui.WorkspaceSessionsScreen
import ai.drsai.remote.remote.ui.WorkspaceSessionsViewModel
import ai.drsai.remote.remote.ui.RemoteAuditScreen
import ai.drsai.remote.remote.ui.RemoteAuditViewModel
import ai.drsai.remote.remote.ui.RemoteChatScreen
import ai.drsai.remote.remote.ui.RemoteMarkdownContent
import ai.drsai.remote.remote.ui.OaepSemanticItem
import ai.drsai.remote.remote.model.RemoteTranscriptMessage
import ai.drsai.remote.remote.model.OaepTimelineEntry
import ai.drsai.remote.remote.model.OaepProcessItem
import ai.drsai.remote.remote.model.OaepSourceLink
import ai.drsai.remote.remote.ui.RemoteSessionViewModel
import ai.drsai.remote.remote.ui.WorkspaceFilesScreen
import ai.drsai.remote.remote.ui.WorkspaceFilesViewModel
import ai.drsai.remote.remote.ui.WorkspaceGitScreen
import ai.drsai.remote.remote.ui.WorkspaceGitViewModel
import java.io.File
import java.util.UUID
import kotlinx.coroutines.launch
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

@Composable
private fun BrandLogo(size: Dp) {
    Image(
        painter = painterResource(R.drawable.opendrsai_logo),
        contentDescription = stringResource(R.string.logo_content_description),
        modifier = Modifier.size(size),
        contentScale = ContentScale.Fit,
    )
}

@Composable
fun OpenDrSaiApp(viewModel: AppViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val dark = state.darkTheme ?: isSystemInDarkTheme()
    val context = LocalContext.current
    val colorScheme = if (dark) OpenDrSaiDarkColorScheme else OpenDrSaiLightColorScheme
    SideEffect {
        (context as? Activity)?.window?.let { window ->
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    MaterialTheme(
        colorScheme = colorScheme,
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when (state.destination) {
                AppDestination.Splash -> SplashScreen()
                AppDestination.Login -> LoginScreen(state, viewModel)
                AppDestination.Chat -> ChatScreen(state, viewModel)
            }
        }
    }
}

/** Lightweight first frame: keep cold start independent of database and Full Runtime bootstrap. */
@Composable
fun OpenDrSaiStartupFrame() {
    val dark = isSystemInDarkTheme()
    MaterialTheme(colorScheme = if (dark) OpenDrSaiDarkColorScheme else OpenDrSaiLightColorScheme) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { SplashScreen() }
    }
}

@Composable
private fun SplashScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(112.dp)
            Spacer(Modifier.height(18.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.tagline))
            Spacer(Modifier.height(24.dp))
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun LoginScreen(state: AppState, viewModel: AppViewModel) {
    val context = LocalContext.current
    LaunchedEffect(state.loginUrl) {
        state.loginUrl?.let { url ->
            runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) }
                .onFailure { viewModel.cancelLogin() }
            viewModel.loginUrlOpened()
        }
    }
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(148.dp)
            Spacer(Modifier.height(18.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.login_prompt), style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(42.dp))
            Button(
                onClick = viewModel::login,
                enabled = !state.loading && !state.waitingForLogin,
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Login, null)
                Spacer(Modifier.width(8.dp))
                    Text(stringResource(if (state.waitingForLogin) R.string.waiting_browser_authorization else R.string.continue_with_hepai))
            }
            if (state.waitingForLogin) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = viewModel::cancelLogin, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.cancel_login)) }
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.complete_browser_authorization), style = MaterialTheme.typography.bodySmall)
            }
            state.error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(28.dp))
            Text(stringResource(R.string.login_legal_notice), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatScreen(state: AppState, viewModel: AppViewModel) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val localWorkspaceLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri == null) viewModel.denyLocalWorkspaceRequest() else viewModel.grantLocalWorkspace(uri)
    }
    var mainRoutePath by rememberSaveable { mutableStateOf(AppRoute.Chat.path) }
    var remoteRuntimeName by rememberSaveable { mutableStateOf("") }
    var remoteWorkspaceName by rememberSaveable { mutableStateOf("") }
    var remoteFocusItemId by rememberSaveable { mutableStateOf<String?>(null) }
    val mainRoute = AppRoute.parse(mainRoutePath) ?: AppRoute.Chat
    LaunchedEffect(state.requestedRoutePath, state.destination) {
        state.requestedRoutePath?.let { requested ->
            if (state.destination == AppDestination.Chat && AppRoute.parse(requested) != null) {
                mainRoutePath = requested
                remoteFocusItemId = state.requestedRemoteItemId
                if (AppRoute.parse(requested) !is AppRoute.RemoteSession ||
                    state.requestedRemoteItemId == null
                ) viewModel.consumeRequestedRoute()
            }
        }
    }
    fun closeDrawer() = scope.launch { drawerState.close() }
    var wideDrawerVisible by rememberSaveable { mutableStateOf(true) }
    var newTaskPickerOpen by rememberSaveable { mutableStateOf(false) }
    val remoteTargets = state.workbenchWorkspaces.filterNot { it.local }
    val requestNewTask: () -> Unit = {
        if (remoteTargets.isEmpty()) viewModel.newConversation() else newTaskPickerOpen = true
    }

    if (newTaskPickerOpen) {
        NewTaskTargetDialog(
            remoteTargets = remoteTargets,
            onDismiss = { newTaskPickerOpen = false },
            onLocal = {
                newTaskPickerOpen = false
                viewModel.newConversation()
                mainRoutePath = AppRoute.Chat.path
                closeDrawer()
            },
            onRemote = { workspace ->
                newTaskPickerOpen = false
                mainRoutePath = AppRoute.WorkspaceSessions(
                    ai.drsai.remote.remote.model.RuntimeId(workspace.runtimeId),
                    ai.drsai.remote.remote.model.WorkspaceId(workspace.workspaceId),
                ).path
                closeDrawer()
            },
        )
    }

    state.pendingDesktopHandoff?.let { handoff ->
        AlertDialog(
            onDismissRequest = { viewModel.decideDesktopHandoff(false) },
            title = { Text(stringResource(R.string.handoff_dialog_title)) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(handoff.message)
                HandoffTargetPicker(handoff, viewModel::selectDesktopHandoffTarget)
                Text(
                    buildString {
                    append(stringResource(R.string.handoff_target_location, handoff.targetName ?: stringResource(R.string.not_chosen), handoff.executionLocation))
                    handoff.transport?.let { append(stringResource(R.string.handoff_transport, it)) }
                        handoff.resourceId?.let { append("\nMCP Server：$it") }
                        append(stringResource(R.string.handoff_capabilities, handoff.requiredCapabilities.joinToString(" / ")))
                    if (handoff.transport == "stdio") append(stringResource(R.string.handoff_stdio_notice))
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } },
            confirmButton = { TextButton(
                onClick = { viewModel.decideDesktopHandoff(true) }, enabled = handoff.targetRuntimeId != null,
                    ) { Text(stringResource(R.string.create_handoff)) } },
                dismissButton = { TextButton(onClick = { viewModel.decideDesktopHandoff(false) }) { Text(stringResource(R.string.cancel)) } },
        )
    }

    val drawerContent: @Composable (Boolean) -> Unit = { modal ->
            NavigationDrawer(
                state = state,
                modal = modal,
                newConversationSelected =
                    mainRoute == AppRoute.Chat && state.currentConversation == null,
                onNewConversation = {
                    requestNewTask()
                    if (!newTaskPickerOpen) closeDrawer()
                },
                onOpenConversation = {
                    viewModel.openConversation(it)
                    mainRoutePath = AppRoute.Chat.path
                    closeDrawer()
                },
                onOpenWorkbenchSession = { session ->
                    if (session.local) {
                        viewModel.openConversation(session.sessionId)
                        mainRoutePath = AppRoute.Chat.path
                    } else {
                        mainRoutePath = AppRoute.RemoteSession(
                            ai.drsai.remote.remote.model.RuntimeId(session.runtimeId),
                            ai.drsai.remote.remote.model.WorkspaceId(session.workspaceId),
                            ai.drsai.remote.remote.model.SessionId(session.sessionId),
                        ).path
                    }
                    closeDrawer()
                },
                onSelectAgent = {
                    viewModel.selectAgent(it)
                    closeDrawer()
                },
                onRefreshAgents = viewModel::refreshAgents,
                onOpenProfile = {
                    closeDrawer()
                    viewModel.toggleProfile(true)
                },
                onOpenSettings = {
                    mainRoutePath = AppRoute.Settings.path
                    closeDrawer()
                },
                onOpenSearch = {
                    mainRoutePath = AppRoute.Search.path
                    closeDrawer()
                },
                onOpenRemoteWorkspaces = {
                    mainRoutePath = AppRoute.RemoteHome.path
                    closeDrawer()
                },
                onOpenScheduled = {
                    mainRoutePath = AppRoute.Scheduled.path
                    closeDrawer()
                },
                onOpenResults = {
                    mainRoutePath = AppRoute.Results.path
                    closeDrawer()
                },
                onOpenAgentsAndSkills = {
                    mainRoutePath = AppRoute.AgentsAndSkills.path
                    closeDrawer()
                },
                onOpenApprovals = {
                    mainRoutePath = AppRoute.Approvals.path
                    closeDrawer()
                },
                onOpenArchived = {
                    mainRoutePath = AppRoute.Archived.path
                    closeDrawer()
                },
                onRenameSession = viewModel::renameSession,
                onSetSessionPinned = viewModel::setSessionPinned,
                onArchiveSession = { viewModel.setSessionArchived(it, true) },
                onDeleteSession = viewModel::deleteSession,
                onSetSessionUnread = viewModel::setSessionUnread,
                onLoadMoreSessions = viewModel::loadMoreWorkbenchSessions,
                onGrantLocalWorkspace = { localWorkspaceLauncher.launch(null) },
                onClearLocalWorkspace = viewModel::clearLocalWorkspace,
            )
    }
    val screenContent: @Composable (Boolean) -> Unit = { wide ->
        val showChatRightSidebar = shouldShowChatRightSidebar(
            wide,
            LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE,
        )
        Scaffold { systemPadding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(systemPadding)
                    .imePadding(),
            ) {
                if (mainRoute == AppRoute.Settings) {
                    SettingsScreen(
                        state = state,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onOpenModels = { mainRoutePath = AppRoute.ModelSettings.path },
                    )
                } else if (mainRoute == AppRoute.ModelSettings) {
                    ModelSettingsScreen(
                        state = state,
                        onBack = { mainRoutePath = AppRoute.Settings.path },
                        onSelectModel = viewModel::selectModel,
                        onDeleteProvider = viewModel::deleteModelProvider,
                        onSaveProvider = viewModel::saveModelProvider,
                        onDiscoverModels = viewModel::discoverProviderModels,
                        onTestConnection = viewModel::testProviderConnection,
                        onClearMessage = viewModel::clearModelConfigurationMessage,
                    )
                } else if (mainRoute == AppRoute.Search) {
                    WorkbenchSearchScreen(
                        state = state,
                        onBack = {
                            viewModel.searchWorkbench("")
                            mainRoutePath = AppRoute.Chat.path
                        },
                        onSearch = viewModel::searchWorkbench,
                        onOpenSession = { session ->
                            viewModel.searchWorkbench("")
                            if (session.local) {
                                viewModel.openConversation(session.sessionId)
                                mainRoutePath = AppRoute.Chat.path
                            } else {
                                mainRoutePath = AppRoute.RemoteSession(
                                    ai.drsai.remote.remote.model.RuntimeId(session.runtimeId),
                                    ai.drsai.remote.remote.model.WorkspaceId(session.workspaceId),
                                    ai.drsai.remote.remote.model.SessionId(session.sessionId),
                                ).path
                            }
                        },
                        onSelectAgent = { agentId ->
                            viewModel.selectAgent(agentId)
                            viewModel.searchWorkbench("")
                            mainRoutePath = AppRoute.Chat.path
                        },
                    )
                } else if (mainRoute == AppRoute.Approvals) {
                    ApprovalsScreen(
                        approvals = state.pendingApprovals,
                        grants = state.approvalGrants,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onDecision = viewModel::decideApproval,
                        onRevokeGrant = viewModel::revokeApprovalGrant,
                    )
                } else if (mainRoute == AppRoute.Recovery) {
                    RecoveryCenterScreen(
                        runs = state.recoveryRuns,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onContinue = viewModel::continueRunFromNotification,
                        onCancel = viewModel::cancelRunFromNotification,
                        onArchive = viewModel::archiveRecoveryRun,
                    )
                } else if (mainRoute == AppRoute.Archived) {
                    ArchivedSessionsScreen(
                        sessions = state.archivedSessions,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onRestore = { viewModel.setSessionArchived(it, false) },
                    )
                } else if (mainRoute == AppRoute.Scheduled) {
                    WorkbenchInfoScreen(
                title = stringResource(R.string.scheduled_tasks),
                description = stringResource(R.string.scheduled_tasks_detail),
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                actionLabel = stringResource(if (remoteTargets.isEmpty()) R.string.connect_remote_runtime else R.string.choose_remote_workspace),
                        onAction = { mainRoutePath = AppRoute.RemoteHome.path },
                    )
                } else if (mainRoute == AppRoute.Results) {
                    WorkbenchResultsScreen(
                        artifacts = state.workbenchArtifacts,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onOpen = { viewModel.openWorkbenchArtifact(it.id, it.source) },
                        onShare = { viewModel.openWorkbenchArtifact(it.id, it.source, share = true) },
                onRegenerate = { viewModel.send(context.getString(R.string.regenerate_result_prompt, it.name)) },
                    )
                } else if (mainRoute == AppRoute.AgentsAndSkills) {
                    val skillImporter = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                        uri?.let(viewModel::importUserSkill)
                    }
                    AgentsAndSkillsScreen(
                        agents = state.agents,
                        skills = state.skills,
                        connectors = state.connectors,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onRefresh = viewModel::refreshAgents,
                        onImportSkill = { skillImporter.launch(arrayOf("application/json", "text/plain")) },
                        onSetSkillEnabled = viewModel::setUserSkillEnabled,
                        onRollbackSkill = viewModel::rollbackUserSkill,
                        onDeleteSkill = viewModel::deleteUserSkill,
                        onConnectMcp = viewModel::connectMcpServer,
                        onRevokeMcp = viewModel::revokeMcpServer,
                    )
                } else if (mainRoute == AppRoute.RemoteHome) {
                    val remoteViewModel: RemoteHomeViewModel = viewModel(key = "remote-home")
                    val remoteState by remoteViewModel.state.collectAsState()
                    LifecycleEventEffect(Lifecycle.Event.ON_START) {
                        remoteViewModel.onForeground()
                    }
                    val notificationPermission = rememberLauncherForActivityResult(
                        ActivityResultContracts.RequestPermission(),
                    ) { remoteViewModel.refreshNotificationReadiness() }
                    LaunchedEffect(remoteState.computers) {
                        viewModel.projectRemoteWorkspaces(remoteState.computers.flatMap { computer ->
                            computer.workspaces.map { computer.displayName to it }
                        })
                    }
                    fun startRemoteAssociationScan() {
                        remoteViewModel.beginAssociationScan()
                        com.google.mlkit.common.MlKit.initialize(context)
                        GmsBarcodeScanning.getClient(context).startScan()
                            .addOnSuccessListener { barcode ->
                                barcode.rawValue?.let(remoteViewModel::associate)
                                    ?: remoteViewModel.cancelAssociationScan()
                            }
                            .addOnFailureListener { remoteViewModel.cancelAssociationScan() }
                            .addOnCanceledListener(remoteViewModel::cancelAssociationScan)
                    }
                    RemoteHomeScreen(
                        state = remoteState,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onAssociate = {
                            remoteViewModel.beginAssociationScan()
                            com.google.mlkit.common.MlKit.initialize(context)
                            GmsBarcodeScanning.getClient(context).startScan()
                                .addOnSuccessListener { barcode ->
                                    barcode.rawValue?.let(remoteViewModel::associate) ?: run {
                                        remoteViewModel.cancelAssociationScan()
                        Toast.makeText(context, context.getString(R.string.empty_qr_code), Toast.LENGTH_SHORT).show()
                                    }
                                }
                                .addOnFailureListener { failure ->
                                    remoteViewModel.cancelAssociationScan()
                    Toast.makeText(context, failure.message ?: context.getString(R.string.scanner_start_failed), Toast.LENGTH_SHORT).show()
                                }
                                .addOnCanceledListener(remoteViewModel::cancelAssociationScan)
                        },
                        onRefresh = { remoteViewModel.refresh() },
                        onDiagnose = remoteViewModel::diagnoseConnection,
                        onDiagnosticAction = { action -> when (action) {
                            ai.drsai.remote.remote.ui.RemoteDiagnosticAction.SIGN_IN -> viewModel.login()
                            ai.drsai.remote.remote.ui.RemoteDiagnosticAction.REPAIR_DEVICE -> startRemoteAssociationScan()
                            ai.drsai.remote.remote.ui.RemoteDiagnosticAction.UPDATE -> mainRoutePath = AppRoute.Settings.path
                            ai.drsai.remote.remote.ui.RemoteDiagnosticAction.ENABLE_NOTIFICATIONS -> {
                                if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                else context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                })
                            }
                            else -> remoteViewModel.refresh()
                        } },
                        onSignIn = viewModel::login,
                        onCheckUpdate = { mainRoutePath = AppRoute.Settings.path },
                        onContactAdmin = { mainRoutePath = AppRoute.Settings.path },
                        onEnableNotifications = {
                            if (Build.VERSION.SDK_INT >= 33) {
                                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            } else {
                                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                                    putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                })
                            }
                        },
                        onRefreshWorkspaces = remoteViewModel::refreshWorkspaces,
                        onQueryChange = remoteViewModel::updateQuery,
                        onRevokeAssociation = { runtimeId -> remoteViewModel.revokeAssociation(runtimeId, false) },
                        onRevokeAssociationAndClear = { runtimeId -> remoteViewModel.revokeAssociation(runtimeId, true) },
                        onOpenSearchResult = { result ->
                            mainRoutePath = when {
                                result.sessionId != null && result.workspaceId != null ->
                                    AppRoute.RemoteSession(result.runtimeId, result.workspaceId, result.sessionId).path
                                result.workspaceId != null ->
                                    AppRoute.WorkspaceSessions(result.runtimeId, result.workspaceId).path
                                else -> AppRoute.RemoteHome.path
                            }
                        },
                        onOpenWorkspace = { workspace ->
                            remoteViewModel.markWorkspaceOpened(workspace)
                            remoteRuntimeName = remoteState.computers
                                .firstOrNull { it.runtimeId == workspace.runtimeId }?.displayName
                                ?: workspace.runtimeId.value
                            remoteWorkspaceName = workspace.displayName
                            mainRoutePath = AppRoute.WorkspaceSessions(workspace.runtimeId, workspace.workspaceId).path
                        },
                    )
                } else if (mainRoute is AppRoute.WorkspaceSessions) {
                    val route = mainRoute
                    val factory = remember(route.path, remoteRuntimeName, remoteWorkspaceName) {
                        WorkspaceSessionsViewModel.factory(
                            context.applicationContext as Application,
                            route.runtimeId,
                            route.workspaceId,
                            remoteRuntimeName.ifBlank { route.runtimeId.value },
                            remoteWorkspaceName.ifBlank { route.workspaceId.value },
                        )
                    }
                    val sessionsViewModel: WorkspaceSessionsViewModel = viewModel(key = route.path, factory = factory)
                    val sessionsState by sessionsViewModel.state.collectAsState()
                    LaunchedEffect(sessionsState.sessions) {
                        viewModel.projectRemoteSessions(sessionsState.sessions.map { it.reference })
                    }
                    WorkspaceSessionsScreen(
                        state = sessionsState,
                        onBack = { mainRoutePath = AppRoute.RemoteHome.path },
                        onRefresh = { sessionsViewModel.refresh() },
                        onSearch = sessionsViewModel::search,
                        onCreate = sessionsViewModel::createSession,
                        onOpen = { session ->
                            mainRoutePath = AppRoute.RemoteSession(session.runtimeId, session.workspaceId, session.sessionId).path
                        },
                        onOpenCapability = { capability ->
                            mainRoutePath = when (capability) {
                                "Files" -> AppRoute.WorkspaceFiles(route.runtimeId, route.workspaceId).path
                                "Git" -> AppRoute.WorkspaceGit(route.runtimeId, route.workspaceId).path
                                else -> mainRoutePath
                            }
                        },
                        onConfirmInstructions = sessionsViewModel::confirmInstructionRefresh,
                        onToggleArchived = sessionsViewModel::toggleArchived,
                        onRename = sessionsViewModel::renameSession,
                        onSetArchived = sessionsViewModel::setArchived,
                    )
                } else if (mainRoute is AppRoute.RemoteSession) {
                    val route = mainRoute
                    val factory = remember(route.path, remoteRuntimeName, remoteWorkspaceName) {
                        RemoteSessionViewModel.factory(
                            context.applicationContext as Application,
                            route.runtimeId, route.workspaceId, route.sessionId,
                            remoteRuntimeName.ifBlank { route.runtimeId.value },
                            remoteWorkspaceName.ifBlank { route.workspaceId.value },
                        )
                    }
                    val sessionViewModel: RemoteSessionViewModel = viewModel(key = route.path, factory = factory)
                    val remoteChatState by sessionViewModel.state.collectAsState()
                    LaunchedEffect(route.path, remoteFocusItemId) {
                        remoteFocusItemId?.let(sessionViewModel::focusItem)
                    }
                    RemoteChatScreen(
                        state = remoteChatState,
                        onBack = { mainRoutePath = AppRoute.WorkspaceSessions(route.runtimeId, route.workspaceId).path },
                        onSend = sessionViewModel::send,
                        onDraftChange = sessionViewModel::updateDraft,
                        onCancelRun = sessionViewModel::cancel,
                        onRetryRun = sessionViewModel::retry,
                        onSearchTranscript = sessionViewModel::searchTranscript,
                        onApproval = sessionViewModel::decide,
                        onOpenArtifact = sessionViewModel::openArtifact,
                        onConfirmArtifact = sessionViewModel::confirmArtifactDownload,
                        onLoadOlderHistory = sessionViewModel::loadOlderHistory,
                        focusItemId = remoteFocusItemId,
                        onFocusResolved = {
                            remoteFocusItemId = null
                            viewModel.consumeRequestedRoute(focusedItemId = state.requestedRemoteItemId)
                        },
                        onRendered = sessionViewModel::onUiRendered,
                        onSignIn = viewModel::login,
                        onOpenAudit = {
                            remoteChatState.activeRunId?.let { runId ->
                                mainRoutePath = AppRoute.RunAudit(route.runtimeId, route.workspaceId, route.sessionId, runId).path
                            }
                        },
                    )
                } else if (mainRoute is AppRoute.RunAudit) {
                    val route = mainRoute
                    val factory = remember(route.path, remoteRuntimeName, remoteWorkspaceName) {
                        RemoteAuditViewModel.factory(
                            context.applicationContext as Application,
                            route.runtimeId, route.workspaceId, route.runId,
                            remoteRuntimeName.ifBlank { route.runtimeId.value },
                            remoteWorkspaceName.ifBlank { route.workspaceId.value },
                        )
                    }
                    val auditViewModel: RemoteAuditViewModel = viewModel(key = route.path, factory = factory)
                    val auditState by auditViewModel.state.collectAsState()
                    RemoteAuditScreen(
                        runtimeName = auditState.runtimeName,
                        workspaceName = auditState.workspaceName,
                        entries = auditState.entries,
                        loading = auditState.loading,
                        error = auditState.error,
                        onBack = { mainRoutePath = AppRoute.WorkspaceSessions(route.runtimeId, route.workspaceId).path },
                        onRefresh = auditViewModel::refresh,
                    )
                } else if (mainRoute is AppRoute.WorkspaceFiles) {
                    val route = mainRoute
                    val factory = remember(route.path, remoteWorkspaceName) {
                        WorkspaceFilesViewModel.factory(context.applicationContext as Application, route.runtimeId,
                            route.workspaceId, remoteWorkspaceName.ifBlank { route.workspaceId.value })
                    }
                    val filesViewModel: WorkspaceFilesViewModel = viewModel(key = route.path, factory = factory)
                    val filesState by filesViewModel.state.collectAsState()
                    WorkspaceFilesScreen(filesState,
                        onBack = { mainRoutePath = AppRoute.WorkspaceSessions(route.runtimeId, route.workspaceId).path },
                        onExpand = filesViewModel::expand,
                        onOpen = filesViewModel::open,
                        onSearch = filesViewModel::search,
                        onLoadMore = filesViewModel::loadMore,
                        onClosePreview = filesViewModel::closePreview,
                        onCancelPreview = filesViewModel::cancelPreview,
                        onOpenExternal = filesViewModel::openExternal)
                } else if (mainRoute is AppRoute.WorkspaceGit) {
                    val route = mainRoute
                    val factory = remember(route.path) {
                        WorkspaceGitViewModel.factory(context.applicationContext as Application, route.runtimeId, route.workspaceId)
                    }
                    val gitViewModel: WorkspaceGitViewModel = viewModel(key = route.path, factory = factory)
                    val gitState by gitViewModel.state.collectAsState()
                    WorkspaceGitScreen(gitState,
                        onBack = { mainRoutePath = AppRoute.WorkspaceSessions(route.runtimeId, route.workspaceId).path },
                        onOpenDiff = gitViewModel::diff)
                } else {
                    Row(Modifier.fillMaxSize()) {
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (state.messages.isEmpty() && state.oaepTimeline.isEmpty() && state.oaepTranscript.isEmpty()) {
                        Welcome(state.selectedAgent, Modifier.fillMaxSize().padding(top = 82.dp, bottom = 92.dp))
                    } else if (state.oaepTimeline.isNotEmpty()) {
                        OaepTimeline(
                            state.oaepTimeline,
                            state.oaepSnapshotSequence,
                            state.attachmentDrafts.isNotEmpty(),
                            Modifier.fillMaxSize(),
                            onRemedy = viewModel::send,
                        )
                    } else {
                        Messages(
                            state.messages,
                            state.selectedAgent?.name ?: "OpenDrSai",
                            state.attachmentDrafts.isNotEmpty(),
                            viewModel::retryResultAttachment,
                            Modifier.fillMaxSize(),
                        )
                    }

                    Column(
                        Modifier.align(Alignment.TopCenter).padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FloatingHeader(
                            onOpenDrawer = {
                                if (wide) wideDrawerVisible = !wideDrawerVisible
                                else scope.launch { drawerState.open() }
                            },
                            onNewConversation = requestNewTask,
                            newConversationEnabled = !state.streaming && !state.recovering,
                        )
                        if (state.pendingApprovals.isNotEmpty()) {
                            PendingApprovalCard(
                                state.pendingApprovals.first(),
                                state.pendingApprovals.size,
                                onOpenAll = { mainRoutePath = AppRoute.Approvals.path },
                                onDecision = viewModel::decideApproval,
                            )
                        }
                        if (state.setupJourney.visible) {
                            AgentSetupCard(
                                state = state,
                                onOpenModels = { mainRoutePath = AppRoute.ModelSettings.path },
                                onRetryRuntime = viewModel::retryFullRuntimeBinding,
                                onRunRuntimeCheck = viewModel::runFullRuntimeSmoke,
                                onRunExample = viewModel::send,
                                onSkip = viewModel::skipSetupJourney,
                            )
                        } else if (
                            state.setupJourney.status == ai.drsai.remote.runtime.setup.SetupStatus.SKIPPED &&
                            !state.agentReadiness.canStartAgentRun
                        ) {
                            DeferredSetupCard(
                                onResume = viewModel::resumeSetupJourney,
                            )
                        }
                        if (state.capabilityGuidance.isNotEmpty()) {
                            CapabilityGuidanceCard(
                                items = state.capabilityGuidance,
                                onGrantWorkspace = viewModel::requestLocalWorkspaceForCurrentTask,
                                onOpenDesktop = { mainRoutePath = AppRoute.RemoteHome.path },
                                onOpenModels = { mainRoutePath = AppRoute.ModelSettings.path },
                            )
                        }
                if (state.localWorkspaceGranted) WorkspaceScopeBanner(state.localWorkspaceName ?: stringResource(R.string.authorized_directory))
                        if (state.recoveryRuns.isNotEmpty()) {
                            RecoverySummaryCard(state.recoveryRuns.size) { mainRoutePath = AppRoute.Recovery.path }
                        }
                        state.error?.let {
                            ErrorBar(
                                it, state.diagnostic, state.capabilityRepair,
                    retryLabel = stringResource(if (state.oaepRunStatus in setOf("failed", "cancelled", "completed")) R.string.retry_new_run else R.string.retry),
                                retry = viewModel::retry,
                            ) { action ->
                                when (action) {
                                    ai.drsai.remote.runtime.errors.CapabilityRepairAction.GRANT_WORKSPACE -> viewModel.requestLocalWorkspaceForCurrentTask()
                                    ai.drsai.remote.runtime.errors.CapabilityRepairAction.OPEN_NETWORK_SETTINGS -> context.startActivity(android.content.Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS))
                                    ai.drsai.remote.runtime.errors.CapabilityRepairAction.CHOOSE_MODEL -> mainRoutePath = AppRoute.ModelSettings.path
                                    ai.drsai.remote.runtime.errors.CapabilityRepairAction.CONNECT_DESKTOP -> mainRoutePath = AppRoute.RemoteHome.path
                                }
                            }
                        }
                        state.runtimeStatus?.let { RuntimeBar(it) }
                if (state.toolDowngraded) RuntimeBar(stringResource(R.string.chat_only_model_notice))
                    }

                    Composer(
                        state = state,
                        onSend = viewModel::send,
                        onStop = viewModel::stop,
                        onAddAttachment = viewModel::addAttachment,
                        onRemoveAttachment = viewModel::removeAttachment,
                        onRetryAttachment = viewModel::retryAttachment,
                        modifier = Modifier.align(Alignment.BottomCenter),
                    )
                    }
                    if (showChatRightSidebar) ChatRightSidebar(state)
                    }
                }
            }
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = usesPermanentWorkbenchDrawer(maxWidth)
        if (wide) {
            Row(Modifier.fillMaxSize()) {
                if (wideDrawerVisible) drawerContent(false)
                Box(Modifier.weight(1f).fillMaxHeight()) { screenContent(true) }
            }
        } else {
            ModalNavigationDrawer(
                drawerState = drawerState,
                drawerContent = { drawerContent(true) },
            ) { screenContent(false) }
        }
    }
    if (state.profileOpen) ProfileSheet(state, viewModel)
    if (state.workspaceAuthorization.visible) WorkspaceAuthorizationDialog(
        onDismiss = viewModel::denyLocalWorkspaceRequest,
        onChooseDirectory = {
            viewModel.openLocalWorkspacePicker()
            localWorkspaceLauncher.launch(null)
        },
    )
}

@Composable
internal fun WorkspaceAuthorizationDialog(onDismiss: () -> Unit, onChooseDirectory: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.workspace_dialog_title)) },
        text = { Text(stringResource(R.string.workspace_dialog_detail)) },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.not_now)) } },
        confirmButton = {
            Button(onClick = onChooseDirectory, modifier = Modifier.testTag("workspace-choose-directory")) { Text(stringResource(R.string.choose_directory)) }
        },
    )
}

@Composable
internal fun CapabilityGuidanceCard(
    items: List<ai.drsai.remote.runtime.readiness.CapabilityGuidanceItem>,
    onGrantWorkspace: () -> Unit,
    onOpenDesktop: () -> Unit,
    onOpenModels: () -> Unit,
) {
    val context = LocalContext.current
    var expanded by rememberSaveable { mutableStateOf(false) }
    val grouped = items.groupBy { it.availability }
    val localCount = grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.LOCAL_AVAILABLE].orEmpty().size
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("capability-guidance-card"),
        shape = RoundedCornerShape(14.dp),
        tonalElevation = 2.dp,
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                Modifier.fillMaxWidth().clickable { expanded = !expanded }.testTag("capability-guidance-toggle"),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
            Text(stringResource(R.string.capability_title), fontWeight = FontWeight.SemiBold)
            Text(pluralStringResource(R.plurals.direct_capability_count, localCount, localCount), style = MaterialTheme.typography.bodySmall)
                }
                Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
            }
            if (expanded) {
                        CapabilityGuidanceGroup(stringResource(R.string.capability_local_available), grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.LOCAL_AVAILABLE].orEmpty())
                        CapabilityGuidanceGroup(stringResource(R.string.capability_permission_required), grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.PERMISSION_REQUIRED].orEmpty())
                if (grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.PERMISSION_REQUIRED].orEmpty().isNotEmpty()) {
                            TextButton(onClick = onGrantWorkspace, modifier = Modifier.testTag("capability-grant-workspace")) { Text(stringResource(R.string.grant_local_workspace)) }
                }
                        CapabilityGuidanceGroup(stringResource(R.string.capability_desktop_required), grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.DESKTOP_REQUIRED].orEmpty())
                            TextButton(onClick = onOpenDesktop, modifier = Modifier.testTag("capability-open-desktop")) { Text(stringResource(R.string.connect_desktop_runtime)) }
                        CapabilityGuidanceGroup(stringResource(R.string.capability_model_unsupported), grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.UNSUPPORTED].orEmpty())
                if (grouped[ai.drsai.remote.runtime.readiness.CapabilityAvailability.UNSUPPORTED].orEmpty().isNotEmpty()) {
                            TextButton(onClick = onOpenModels, modifier = Modifier.testTag("capability-open-models")) { Text(stringResource(R.string.change_model)) }
                }
            }
        }
    }
}

@Composable
internal fun HandoffTargetPicker(handoff: ai.drsai.remote.data.DesktopHandoffUi, onSelect: (String) -> Unit) {
                        Text(stringResource(R.string.handoff_transfer_summary, handoff.transferSummary), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.choose_execution_computer), fontWeight = FontWeight.Medium)
    handoff.targets.forEach { target ->
        OutlinedButton(
            onClick = { onSelect(target.runtimeId) }, enabled = target.online,
            modifier = Modifier.fillMaxWidth().testTag("handoff-target-${target.runtimeId}"),
                            ) { Text(target.name + if (handoff.targetRuntimeId == target.runtimeId) stringResource(R.string.selected_suffix) else "") }
    }
}

@Composable
internal fun WorkspaceScopeBanner(name: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("workspace-scope-banner"),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.FolderOpen, null)
            Spacer(Modifier.width(8.dp))
            Column {
                        Text(stringResource(R.string.current_workspace, name), fontWeight = FontWeight.Medium)
                        Text(stringResource(R.string.workspace_relative_path_notice), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun CapabilityGuidanceGroup(
    title: String,
    items: List<ai.drsai.remote.runtime.readiness.CapabilityGuidanceItem>,
) {
    if (items.isEmpty()) return
    Text(title, style = MaterialTheme.typography.labelLarge)
    items.groupBy { it.title }.entries.take(6).forEach { (itemTitle, values) ->
                                    Text(stringResource(R.string.capability_guidance_item, itemTitle, values.first().guidance), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun AgentSetupCard(
    state: AppState,
    onOpenModels: () -> Unit,
    onRetryRuntime: () -> Unit,
    onRunRuntimeCheck: () -> Unit,
    onRunExample: (String) -> Unit,
    onSkip: () -> Unit,
) {
    val readiness = state.agentReadiness
    val primary = when (readiness.primaryAction) {
                    ai.drsai.remote.runtime.readiness.ReadinessAction.RETRY_RUNTIME -> stringResource(R.string.restart)
                    ai.drsai.remote.runtime.readiness.ReadinessAction.RUN_RUNTIME_CHECK -> stringResource(R.string.check_agent_features)
                    ai.drsai.remote.runtime.readiness.ReadinessAction.NONE -> stringResource(R.string.continue_action)
                    else -> stringResource(R.string.complete_setup)
    }
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("agent-setup-card"),
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 3.dp,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (
                state.setupJourney.step == ai.drsai.remote.runtime.setup.SetupStep.FIRST_TASK &&
                readiness.canStartAgentRun
            ) {
                FirstTaskExamplesContent(
                    availableTools = state.fullRuntimeDiagnostic.availableTools,
                    onRunExample = onRunExample,
                    onSkip = onSkip,
                )
                return@Column
            }
            Text(readiness.title, fontWeight = FontWeight.SemiBold)
            Text(readiness.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onSkip) { Text(stringResource(R.string.later)) }
                Button(onClick = {
                    when (readiness.primaryAction) {
                        ai.drsai.remote.runtime.readiness.ReadinessAction.RETRY_RUNTIME -> onRetryRuntime()
                        ai.drsai.remote.runtime.readiness.ReadinessAction.RUN_RUNTIME_CHECK -> onRunRuntimeCheck()
                        else -> onOpenModels()
                    }
                }, enabled = readiness.primaryAction != ai.drsai.remote.runtime.readiness.ReadinessAction.NONE,
                    modifier = Modifier.testTag("agent-setup-primary")) { Text(primary) }
            }
        }
    }
}

@Composable
private fun FirstTaskExamplesContent(
    availableTools: Collection<String>,
    onRunExample: (String) -> Unit,
    onSkip: () -> Unit,
) {
            Text(stringResource(R.string.choose_first_example), fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.choose_example_detail), style = MaterialTheme.typography.bodySmall)
    ai.drsai.remote.runtime.setup.FirstTaskExamples.available(availableTools).forEach { example ->
        val prompt = stringResource(example.prompt)
        OutlinedButton(
            onClick = { onRunExample(prompt) },
            modifier = Modifier.fillMaxWidth().testTag("first-task-${example.kind.name.lowercase()}"),
        ) {
            Column(Modifier.fillMaxWidth()) {
                Text(stringResource(example.title), fontWeight = FontWeight.Medium)
                Text(stringResource(example.description), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onSkip) { Text(stringResource(R.string.later)) }
    }
}

@Composable
internal fun DeferredSetupCard(onResume: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().testTag("deferred-setup-card"),
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 2.dp,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.agent_not_ready), fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.agent_not_ready_detail), style = MaterialTheme.typography.bodySmall)
            }
            Button(onClick = onResume) { Text(stringResource(R.string.complete_model_configuration)) }
        }
    }
}

internal fun usesPermanentWorkbenchDrawer(width: androidx.compose.ui.unit.Dp): Boolean = width >= 840.dp

internal fun shouldShowChatRightSidebar(wide: Boolean, isLandscape: Boolean): Boolean = wide && isLandscape

@Composable
private fun ChatRightSidebar(state: AppState) {
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf(stringResource(R.string.diagnostic_tab))
    Surface(
        modifier = Modifier.width(320.dp).fillMaxHeight().testTag("chat-right-sidebar"),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        tonalElevation = 0.dp,
    ) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                tabs.forEachIndexed { index, title ->
                    TextButton(
                        onClick = { selectedTab = index },
                        modifier = Modifier.weight(1f).testTag("chat-right-tab-$index"),
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = if (selectedTab == index) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    ) { Text(title, fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Medium) }
                }
            }
            HorizontalDivider()
            when (selectedTab) {
                0 -> ChatDiagnosticTab(state)
            }
        }
    }
}

@Composable
private fun ChatDiagnosticTab(state: AppState) {
    val diagnostic = state.fullRuntimeDiagnostic
    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("chat-diagnostic-tab"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
                Text(stringResource(R.string.current_session), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
                DiagnosticRow(stringResource(R.string.diagnostic_route), diagnostic.route)
                DiagnosticRow(stringResource(R.string.agent), state.selectedAgent?.name ?: stringResource(R.string.not_selected))
                DiagnosticRow(stringResource(R.string.model), state.selectedModel?.name ?: stringResource(R.string.not_selected))
                DiagnosticRow(stringResource(R.string.conversation), state.currentConversation?.title ?: stringResource(R.string.new_session))
                DiagnosticRow("Run", state.oaepActiveRunId?.takeLast(12) ?: stringResource(R.string.none))
                DiagnosticRow(stringResource(R.string.run_status), state.oaepRunStatus ?: if (state.streaming) "running" else "idle")
                DiagnosticRow(stringResource(R.string.oaep_sequence), state.oaepSnapshotSequence.toString())
        }
        item {
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
                Text(stringResource(R.string.runtime), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
                DiagnosticRow(stringResource(R.string.binding), diagnostic.bindingState)
                DiagnosticRow(stringResource(R.string.health_status), diagnostic.health)
                DiagnosticRow(stringResource(R.string.process), diagnostic.process)
                DiagnosticRow(stringResource(R.string.binding_attempts), "${diagnostic.bindSuccesses}/${diagnostic.bindAttempts}")
                DiagnosticRow(stringResource(R.string.safe_fallbacks), diagnostic.safeFallbacks.toString())
                DiagnosticRow("Kernel", diagnostic.kernelVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Kernel digest", diagnostic.kernelSha256?.take(12) ?: stringResource(R.string.not_verified))
                DiagnosticRow("Prompt", diagnostic.promptVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Tool manifest", diagnostic.toolManifestVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Skill manifest", diagnostic.skillManifestVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Skill digest", diagnostic.skillManifestSha256?.take(12) ?: stringResource(R.string.not_verified))
                DiagnosticRow("Capability", diagnostic.capabilityManifestVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Host Port", diagnostic.hostPortProtocolVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow("Model tools", diagnostic.modelToolSnapshotVersion ?: stringResource(R.string.not_verified))
                DiagnosticRow(stringResource(R.string.tools), diagnostic.availableTools.size.toString())
                DiagnosticRow(stringResource(R.string.skills), diagnostic.availableSkills.size.toString())
        }
        if (state.runtimeStatus != null || state.error != null || diagnostic.bindReason != null) {
            item {
                HorizontalDivider()
                Spacer(Modifier.height(14.dp))
                Text(stringResource(R.string.status_and_errors), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                state.runtimeStatus?.let { DiagnosticMessage(it, false) }
                diagnostic.bindReason?.let { DiagnosticMessage(it, false) }
                state.error?.let { DiagnosticMessage(it, true) }
            }
        }
        item {
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
                Text(stringResource(R.string.raw_oaep_events), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            if (state.oaepDiagnosticEvents.isEmpty()) {
                    Text(stringResource(R.string.waiting_first_oaep_event), style = MaterialTheme.typography.bodySmall)
            } else {
                state.oaepDiagnosticEvents.forEach { event ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Text(
                            "#${event.sequence}  ${event.type}",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (event.errorCode != null) MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            listOfNotNull(
                                event.runId?.let { "run=${it.takeLast(12)}" },
                                event.itemId?.let { "item=${it.takeLast(16)}" },
                                "source=${event.source}",
                            ).joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        event.errorCode?.let { code ->
                            Text(
                                listOf(code, event.errorMessage.orEmpty()).filter(String::isNotBlank).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DiagnosticRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Text(label, Modifier.width(88.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun DiagnosticMessage(message: String, error: Boolean) {
    Text(
        message,
        Modifier.fillMaxWidth().padding(top = 8.dp),
        style = MaterialTheme.typography.bodySmall,
        color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
internal fun NewTaskTargetDialog(
    remoteTargets: List<WorkbenchWorkspaceItem>,
    onDismiss: () -> Unit,
    onLocal: () -> Unit,
    onRemote: (WorkbenchWorkspaceItem) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.choose_runtime_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.runtime_pinned_notice), style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = onLocal, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.android_local_full_runtime))
                }
                remoteTargets.forEach { workspace ->
                    Button(onClick = { onRemote(workspace) }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.remote_runtime_label, workspace.displayName), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
internal fun FloatingHeader(
    onOpenDrawer: () -> Unit,
    onNewConversation: () -> Unit,
    newConversationEnabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val controlColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.60f)
        .compositeOver(MaterialTheme.colorScheme.background)
    Row(
        modifier = modifier.fillMaxWidth().height(52.dp).semantics { isTraversalGroup = true },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(52.dp),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            IconButton(onClick = onOpenDrawer) { Icon(Icons.Default.Menu, stringResource(R.string.open_navigation)) }
        }
        Spacer(Modifier.width(6.dp))
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Box(
                Modifier.height(52.dp).padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("OpenDrSai", Modifier.semantics { heading() }, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.weight(1f))
        Surface(
            modifier = Modifier.size(52.dp),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            IconButton(onClick = onNewConversation, enabled = newConversationEnabled) {
                Icon(Icons.Default.Add, stringResource(R.string.new_conversation))
            }
        }
    }
}

@Composable
internal fun WorkbenchSearchScreen(
    state: AppState,
    onBack: () -> Unit,
    onSearch: (String) -> Unit,
    onOpenSession: (WorkbenchSessionItem) -> Unit,
    onSelectAgent: (String) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val normalizedQuery = query.trim()
    val recentSessions = state.workbenchWorkspaces
        .flatMap { it.sessions }
        .distinctBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
        .sortedByDescending { it.updatedAt }
        .take(12)
    val matchingAgents = state.agents.filter {
        normalizedQuery.isEmpty() ||
            it.name.contains(normalizedQuery, ignoreCase = true) ||
            it.description.contains(normalizedQuery, ignoreCase = true)
    }.take(if (normalizedQuery.isEmpty()) 6 else 20)

    LaunchedEffect(Unit) {
        focusRequester.requestFocus()
        keyboardController?.show()
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back))
            }
            Column {
                Text(stringResource(R.string.search), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.search_scope),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider()

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().testTag("search-results"),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (normalizedQuery.isEmpty()) {
                item {
                    Text(
                    stringResource(R.string.search_empty_guidance),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                }
                if (recentSessions.isNotEmpty()) {
                item { SearchSectionTitle(stringResource(R.string.recent_sessions)) }
                    items(recentSessions, key = { "recent:${it.runtimeId}:${it.workspaceId}:${it.sessionId}" }) { session ->
                        SearchSessionRow(session, null, null) { onOpenSession(session) }
                    }
                }
                if (matchingAgents.isNotEmpty()) {
                item { SearchSectionTitle(stringResource(R.string.agent)) }
                    items(matchingAgents, key = { "agent:${it.id}" }) { agent ->
                        SearchAgentRow(agent, state.selectedAgent?.id == agent.id) { onSelectAgent(agent.id) }
                    }
                }
            } else {
                val resultCount = state.workbenchSearchResults.size + matchingAgents.size
                item {
                    Text(
                        if (resultCount == 0) stringResource(R.string.no_search_results) else pluralStringResource(R.plurals.search_result_count, resultCount, resultCount),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                if (state.workbenchSearchResults.isNotEmpty()) {
                    item { SearchSectionTitle(stringResource(R.string.chat)) }
                    items(
                        state.workbenchSearchResults,
                        key = { "result:${it.messageMatch}:${it.session.runtimeId}:${it.session.workspaceId}:${it.session.sessionId}:${it.snippet.hashCode()}" },
                    ) { result ->
                        SearchSessionRow(
                            session = result.session,
                            snippet = result.snippet,
                                resultType = stringResource(if (result.messageMatch) R.string.message else R.string.conversation),
                        ) { onOpenSession(result.session) }
                    }
                }
                if (matchingAgents.isNotEmpty()) {
                    item { SearchSectionTitle(stringResource(R.string.agent)) }
                    items(matchingAgents, key = { "matching-agent:${it.id}" }) { agent ->
                        SearchAgentRow(agent, state.selectedAgent?.id == agent.id) { onSelectAgent(agent.id) }
                    }
                }
            }
        }

        Surface(
            Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
            shadowElevation = 8.dp,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    val next = it.take(100)
                    query = next
                    onSearch(next)
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).focusRequester(focusRequester),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                trailingIcon = {
                    if (query.isNotEmpty()) {
                        IconButton(onClick = {
                            query = ""
                            onSearch("")
                        }) {
                        Icon(Icons.Default.Close, stringResource(R.string.clear_search))
                        }
                    }
                },
                    placeholder = { Text(stringResource(R.string.search_hint)) },
                shape = RoundedCornerShape(24.dp),
            )
        }
    }
}

@Composable
private fun SearchSectionTitle(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
    )
}

@Composable
private fun SearchSessionRow(
    session: WorkbenchSessionItem,
    snippet: String?,
    resultType: String?,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.History, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(session.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                snippet?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            resultType?.let {
                Spacer(Modifier.width(8.dp))
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun SearchAgentRow(agent: Agent, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Extension, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(agent.name, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
                Text(
                    agentStatus(agent),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
                    if (selected) Text(stringResource(R.string.current), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
internal fun NavigationDrawer(
    state: AppState,
    modal: Boolean = true,
    newConversationSelected: Boolean = false,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
    onOpenWorkbenchSession: (WorkbenchSessionItem) -> Unit = { if (it.local) onOpenConversation(it.sessionId) },
    onSelectAgent: (String) -> Unit,
    onRefreshAgents: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenSettings: () -> Unit = {},
    onOpenSearch: () -> Unit = {},
    onOpenRemoteWorkspaces: () -> Unit,
    onOpenScheduled: () -> Unit = {},
    onOpenResults: () -> Unit = {},
    onOpenAgentsAndSkills: () -> Unit = {},
    onOpenApprovals: () -> Unit = {},
    onOpenArchived: () -> Unit = {},
    onRenameSession: (String, String) -> Unit = { _, _ -> },
    onSetSessionPinned: (String, Boolean) -> Unit = { _, _ -> },
    onArchiveSession: (String) -> Unit = {},
    onDeleteSession: (String) -> Unit = {},
    onSetSessionUnread: (String, Boolean) -> Unit = { _, _ -> },
    onLoadMoreSessions: (String) -> Unit = {},
    onGrantLocalWorkspace: () -> Unit = {},
    onClearLocalWorkspace: () -> Unit = {},
) {
    var renameTarget by remember { mutableStateOf<WorkbenchSessionItem?>(null) }
    var deleteTarget by remember { mutableStateOf<WorkbenchSessionItem?>(null) }
    var renameText by remember { mutableStateOf("") }
    val visibleWorkspaces = state.workbenchWorkspaces
    val visibleSessions = visibleWorkspaces
        .flatMap { workspace -> workspace.sessions.map { session -> workspace.key to session } }
        .distinctBy { (_, session) -> Triple(session.runtimeId, session.workspaceId, session.sessionId) }
        .sortedWith(
            compareByDescending<Pair<String, WorkbenchSessionItem>> { (_, session) -> session.pinned }
                .thenByDescending { (_, session) -> session.updatedAt },
        )
    val drawerBackground = MaterialTheme.colorScheme.background
    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandLogo(32.dp)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("OpenDrSai", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.android), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onOpenSearch) {
                    Icon(Icons.Default.Search, stringResource(R.string.search))
                }
            }

            LazyColumn(
                Modifier.weight(1f).testTag("drawer-list"),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                item(key = "new-conversation") {
                    CompactDrawerItem(
                        icon = Icons.Default.Add,
                label = stringResource(R.string.new_chat),
                        selected = newConversationSelected,
                        enabled = !state.streaming && !state.recovering,
                        onClick = onNewConversation,
                    )
                }
                item(key = "scheduled") {
            CompactDrawerItem(Icons.Default.Schedule, stringResource(R.string.scheduled), onClick = onOpenScheduled)
                }
                item(key = "remote-workspaces") {
            CompactDrawerItem(Icons.Default.Computer, stringResource(R.string.remote_workspaces), onClick = onOpenRemoteWorkspaces)
                }
                item(key = "agents") {
            CompactDrawerItem(Icons.Default.SmartToy, stringResource(R.string.agent), onClick = onOpenAgentsAndSkills)
                }

                item(key = "sessions-heading") {
                    Text(
                stringResource(R.string.conversation),
                        modifier = Modifier.fillMaxWidth().padding(start = 10.dp, top = 16.dp, bottom = 8.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (visibleSessions.isEmpty()) {
                    item {
                        UserFriendlyEmptyStateCard(
                            ai.drsai.remote.runtime.readiness.UserFriendlyEmptyStatePolicy.present(
                                ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_SESSIONS,
                                state.selectedAgent?.capabilities.orEmpty().map(String::lowercase).toSet() + "chat",
                            ),
                            onNewConversation,
                        )
                    }
                }
                items(
                    visibleSessions,
                    key = { (workspaceKey, session) -> "session:$workspaceKey:${session.sessionId}" },
                ) { (_, session) ->
                    var menuOpen by remember(session.sessionId) { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        NavigationDrawerItem(
                            label = { Text(session.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                            badge = {
                                when {
                        session.runtimeStatus == "WAITING_APPROVAL" -> Text(stringResource(R.string.awaiting_approval), style = MaterialTheme.typography.labelSmall)
                        session.runtimeStatus == "RUNNING" || session.runtimeStatus == "QUEUED" -> Text(stringResource(R.string.running), style = MaterialTheme.typography.labelSmall)
                        session.runtimeStatus == "PAUSED" -> Text(stringResource(R.string.paused), style = MaterialTheme.typography.labelSmall)
                        session.unread -> Text(stringResource(R.string.unread), style = MaterialTheme.typography.labelSmall)
                        session.pinned -> Text(stringResource(R.string.pinned), style = MaterialTheme.typography.labelSmall)
                                }
                            },
                            selected = session.local && state.currentConversation?.id == session.sessionId,
                            onClick = { onOpenWorkbenchSession(session) },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            colors = NavigationDrawerItemDefaults.colors(
                                selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                            ),
                        )
                        if (session.local) Box {
                            IconButton(
                                onClick = { menuOpen = true },
                                modifier = Modifier.size(48.dp).testTag("session-action-${session.sessionId}"),
                            ) {
                            Icon(Icons.Default.MoreVert, stringResource(R.string.session_actions))
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = {
                                    menuOpen = false; renameTarget = session; renameText = session.title
                                })
                    DropdownMenuItem(text = { Text(stringResource(if (session.pinned) R.string.unpin else R.string.pinned)) }, onClick = {
                                    menuOpen = false; onSetSessionPinned(session.sessionId, !session.pinned)
                                })
                    DropdownMenuItem(text = { Text(stringResource(if (session.unread) R.string.mark_read else R.string.mark_unread)) }, onClick = {
                                    menuOpen = false; onSetSessionUnread(session.sessionId, !session.unread)
                                })
                    DropdownMenuItem(text = { Text(stringResource(R.string.archive)) }, onClick = {
                                    menuOpen = false; onArchiveSession(session.sessionId)
                                })
                    DropdownMenuItem(text = { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }, onClick = {
                                    menuOpen = false; deleteTarget = session
                                })
                            }
                        }
                    }
                }
                if (visibleWorkspaces.any(WorkbenchWorkspaceItem::sessionHasMore)) {
                    item(key = "more-sessions") {
                        TextButton(
                            onClick = {
                                visibleWorkspaces.filter(WorkbenchWorkspaceItem::sessionHasMore)
                                    .forEach { onLoadMoreSessions(it.key) }
                            },
                            modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.load_more_sessions)) }
                    }
                }
                item(key = "secondary-divider") {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                }
                item(key = "archived") {
                    CompactDrawerItem(
                        Icons.Default.History,
                stringResource(R.string.archived),
                        badge = state.archivedSessions.size.takeIf { it > 0 }?.toString(),
                        onClick = onOpenArchived,
                    )
                }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
              Surface(onClick = onOpenProfile, color = Color.Transparent, modifier = Modifier.weight(1f)) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    UserAvatar(state.user, Modifier.size(32.dp))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                    state.user?.name ?: stringResource(R.string.profile),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (state.selectedAgent?.source == "platform") state.selectedAgent.name
                else state.selectedModel?.name ?: stringResource(R.string.loading_hai_models),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
              }
              IconButton(onClick = onOpenSettings, modifier = Modifier.size(56.dp).testTag("open-settings")) {
                    Icon(Icons.Default.Settings, stringResource(R.string.settings))
              }
            }
        }
    }
    if (modal) {
        ModalDrawerSheet(
            Modifier.fillMaxHeight().widthIn(max = 320.dp),
            drawerContainerColor = drawerBackground,
        ) { content() }
    } else {
        Surface(
            Modifier.fillMaxHeight().width(320.dp),
            color = drawerBackground,
        ) { content() }
    }
    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.rename_session)) },
            text = { OutlinedTextField(renameText, { renameText = it.take(120) }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameSession(target.sessionId, renameText.trim())
                    renameTarget = null
                }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.delete_session_question)) },
            text = { Text(stringResource(R.string.delete_session_detail, target.title)) },
            confirmButton = {
                TextButton(onClick = { onDeleteSession(target.sessionId); deleteTarget = null }) {
                    Text(stringResource(R.string.confirm_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun CompactDrawerItem(
    icon: ImageVector,
    label: String,
    supportingText: String? = null,
    badge: String? = null,
    selected: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        enabled = enabled,
        shape = RoundedCornerShape(9.dp),
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = if (supportingText == null) 10.dp else 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                icon,
                null,
                Modifier.size(20.dp),
                tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                supportingText?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            badge?.let {
                Spacer(Modifier.width(8.dp))
                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun DrawerSectionHeader(
    title: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onToggle).padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            Modifier.weight(1f),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        action?.invoke()
        IconButton(onClick = onToggle) {
            Icon(
                if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                stringResource(R.string.expand_collapse, title),
                Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun agentStatus(agent: Agent): String = when {
        !agent.available -> stringResource(R.string.currently_unavailable)
        !agent.chatSupported -> stringResource(R.string.chat_unsupported)
        agent.source == "local" -> stringResource(R.string.runs_on_android)
        agent.mode == "ddf" -> stringResource(R.string.runs_on_hai)
        else -> stringResource(R.string.remote_agent)
}

@Composable
private fun ArchivedSessionsScreen(
    sessions: List<WorkbenchSessionItem>,
    onBack: () -> Unit,
    onRestore: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
        Text(stringResource(R.string.archived_sessions), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (sessions.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(stringResource(R.string.no_archived_sessions)) }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(sessions, key = { it.sessionId }) { session ->
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(session.title, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (session.local) TextButton(onClick = { onRestore(session.sessionId) }) { Text(stringResource(R.string.restore)) }
                        else Text(stringResource(R.string.restore_in_remote_workspace), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorkbenchInfoScreen(
    title: String,
    description: String,
    onBack: () -> Unit,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(28.dp))
        Text(description, style = MaterialTheme.typography.bodyLarge)
        actionLabel?.let {
            Spacer(Modifier.height(20.dp))
            Button(onClick = onAction) { Text(it) }
        }
    }
}

@Composable
internal fun WorkbenchResultsScreen(
    artifacts: List<WorkbenchArtifactItem>,
    onBack: () -> Unit,
    onOpen: (WorkbenchArtifactItem) -> Unit,
    onShare: (WorkbenchArtifactItem) -> Unit,
    onRegenerate: (WorkbenchArtifactItem) -> Unit = {},
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.results_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (artifacts.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                UserFriendlyEmptyStateCard(
                    ai.drsai.remote.runtime.readiness.UserFriendlyEmptyStatePolicy.present(
                        ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_RESULTS,
                    ),
                    onBack,
                )
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(artifacts, key = { "${it.source}:${it.id}" }) { artifact ->
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            Text(artifact.name, fontWeight = FontWeight.Medium)
                            val typeLabel = when {
                                artifact.mimeType.startsWith("text/") -> stringResource(R.string.text_file)
                                artifact.mimeType.startsWith("image/") -> stringResource(R.string.image_file)
                                artifact.mimeType == "application/pdf" -> "PDF"
                                else -> stringResource(R.string.binary_file)
                            }
                            val sourceLabel = stringResource(if (artifact.source == "tool") R.string.agent_tool_result else R.string.session_attachment)
                            Text(
                                stringResource(R.string.artifact_metadata, typeLabel, LocalizedFormatting.bytes(artifact.size, java.util.Locale.forLanguageTag(LocalConfiguration.current.locales[0].toLanguageTag())), sourceLabel, artifact.sessionId, artifact.runId?.let { " · Run $it" } ?: ""),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            val failure = ai.drsai.remote.data.ArtifactAccessFailurePolicy.from(artifact.failureCode, ai.drsai.remote.data.AndroidArtifactAccessStrings(androidx.compose.ui.platform.LocalContext.current))
                            if (failure != null) {
                                Text(failure.title, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Medium)
                                Text(failure.detail, style = MaterialTheme.typography.bodySmall)
                        if (failure.canRegenerate) TextButton(onClick = { onRegenerate(artifact) }) { Text(stringResource(R.string.regenerate)) }
                            } else {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { onOpen(artifact) }) { Text(stringResource(R.string.open)) }
                    TextButton(onClick = { onShare(artifact) }) { Text(stringResource(R.string.share)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentsAndSkillsScreen(
    agents: List<Agent>,
    skills: List<SkillUiItem>,
    connectors: List<ConnectorUiItem>,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onImportSkill: () -> Unit,
    onSetSkillEnabled: (String, Boolean) -> Unit,
    onRollbackSkill: (String) -> Unit,
    onDeleteSkill: (String) -> Unit,
    onConnectMcp: (String, String, String, Boolean, Long) -> Unit,
    onRevokeMcp: (String) -> Unit,
) {
    var showMcpDialog by remember { mutableStateOf(false) }
    var mcpId by remember { mutableStateOf("") }
    var mcpUrl by remember { mutableStateOf("") }
    var mcpToken by remember { mutableStateOf("") }
    var mcpAllowWrite by remember { mutableStateOf(false) }
    var mcpExpiryHours by remember { mutableStateOf("24") }
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.agents), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, stringResource(R.string.refresh_agents)) }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Skill", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                OutlinedButton(onClick = onImportSkill) { Text(stringResource(R.string.import_from_file)) }
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Streamable HTTP/SSE MCP", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                OutlinedButton(onClick = { showMcpDialog = true }) { Text(stringResource(R.string.connect_mcp)) }
                }
            }
            items(connectors, key = { "connector:${it.id}" }) { connector ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(connector.id, fontWeight = FontWeight.Medium)
                                Text(connector.url, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(stringResource(if (connector.enabled) R.string.authorized else R.string.revoked_or_expired), style = MaterialTheme.typography.labelMedium)
                        }
                        Text(
                            stringResource(R.string.connector_scope_expiry, connector.scopes.joinToString(), connector.expiresAtEpochMs?.toString() ?: stringResource(R.string.long_term)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (connector.enabled) {
                            TextButton(onClick = { onRevokeMcp(connector.id) }) { Text(stringResource(R.string.revoke_connector)) }
                        }
                    }
                }
            }
            items(skills, key = { "skill:${it.source}:${it.id}" }) { skill ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(skill.name, fontWeight = FontWeight.Medium)
                                Text("${skill.id} · v${skill.version} · ${skill.source}", style = MaterialTheme.typography.labelSmall)
                            }
                            if (skill.userManaged) {
                                Switch(
                                    checked = skill.enabled,
                                    onCheckedChange = { onSetSkillEnabled(skill.id, it) },
                                )
                            }
                        }
                        Text(
                            if (skill.enabled) skill.permissions else stringResource(R.string.disabled_skill_notice),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (skill.userManaged) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { onRollbackSkill(skill.id) }) { Text(stringResource(R.string.rollback)) }
                            TextButton(onClick = { onDeleteSkill(skill.id) }) { Text(stringResource(R.string.delete)) }
                            }
                        }
                    }
                }
            }
            item { Text(stringResource(R.string.agents), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            items(agents, key = Agent::id) { agent ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(agent.name, fontWeight = FontWeight.Medium)
                        Text(agentStatus(agent), style = MaterialTheme.typography.labelMedium)
                        Text(
                            stringResource(
                                R.string.agent_runtime_summary,
                                stringResource(if (agent.source == "local") R.string.android_built_in else R.string.hepai_platform),
                                if (agent.source == "local") (if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) "Full Local" else "Local Preview") else "Remote Platform",
                                stringResource(if (agent.available && agent.chatSupported) R.string.available else R.string.unavailable),
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (agent.capabilities.isNotEmpty()) {
                            Text(
                                agent.capabilities.sorted().joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        } else {
                            Text(
                                stringResource(if (agent.source == "local") R.string.local_agent_permissions else R.string.platform_agent_permissions),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
    if (showMcpDialog) {
        AlertDialog(
            onDismissRequest = { showMcpDialog = false; mcpToken = "" },
            title = { Text(stringResource(R.string.connect_https_mcp)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(mcpId, { mcpId = it }, label = { Text(stringResource(R.string.server_id)) }, singleLine = true)
                    OutlinedTextField(mcpUrl, { mcpUrl = it }, label = { Text("https://…/mcp") }, singleLine = true)
                    OutlinedTextField(
                        mcpToken, { mcpToken = it }, label = { Text(stringResource(R.string.bearer_token_optional)) }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.allow_mutating_tools), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Switch(checked = mcpAllowWrite, onCheckedChange = { mcpAllowWrite = it })
                    }
                    OutlinedTextField(
                        mcpExpiryHours,
                        { mcpExpiryHours = it.filter(Char::isDigit).take(4) },
                        label = { Text(stringResource(R.string.authorization_hours)) },
                        singleLine = true,
                    )
                    Text(stringResource(R.string.mcp_token_security_notice), style = MaterialTheme.typography.bodySmall)
                }
            },
            confirmButton = {
                Button(
                    enabled = mcpId.isNotBlank() && mcpUrl.isNotBlank() &&
                        (mcpExpiryHours.toLongOrNull() in 1L..2160L),
                    onClick = {
                        onConnectMcp(mcpId, mcpUrl, mcpToken, mcpAllowWrite, mcpExpiryHours.toLong())
                        mcpToken = ""
                        showMcpDialog = false
                    },
                ) { Text(stringResource(R.string.connect_and_discover_tools)) }
            },
            dismissButton = { TextButton(onClick = { showMcpDialog = false; mcpToken = "" }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
internal fun PendingApprovalCard(
    approval: ApprovalUiItem,
    count: Int,
    onOpenAll: () -> Unit,
    onDecision: (String, ApprovalDecision) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.tertiaryContainer,
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.PendingActions, null)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(approval.title, fontWeight = FontWeight.Medium)
                    Text(approval.reason, style = MaterialTheme.typography.bodySmall)
                Text(stringResource(R.string.approval_object_risk, approval.objectLabel, approval.riskSummary), style = MaterialTheme.typography.labelSmall)
                    Text(approval.changeSummary, style = MaterialTheme.typography.labelSmall, maxLines = 3)
                Text(pluralStringResource(R.plurals.pending_approval_count, count, approval.reversibleLabel, count), style = MaterialTheme.typography.labelSmall)
                }
            TextButton(onClick = onOpenAll) { Text(stringResource(R.string.all)) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { onDecision(approval.id, ApprovalDecision.DECLINE) }) { Text(stringResource(R.string.decline)) }
            Button(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_ONCE) }) { Text(stringResource(R.string.allow_once)) }
                if (approval.scope == "session") {
            OutlinedButton(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_SESSION) }) { Text(stringResource(R.string.allow_session)) }
                }
            }
        }
    }
}

@Composable
internal fun ApprovalsScreen(
    approvals: List<ApprovalUiItem>,
    onBack: () -> Unit,
    grants: List<ApprovalGrantUiItem> = emptyList(),
    onRevokeGrant: (String) -> Unit = {},
    onDecision: (String, ApprovalDecision) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
        Text(stringResource(R.string.awaiting_approval), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (approvals.isEmpty() && grants.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.no_pending_approvals), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(approvals, key = ApprovalUiItem::id) { approval ->
                    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            var showAdvanced by rememberSaveable(approval.id) { mutableStateOf(false) }
                            Text(approval.title, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.approval_reason, approval.reason), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.approval_object, approval.objectLabel), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.approval_change_summary, approval.changeSummary), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.approval_risk, approval.riskSummary), style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.approval_reversible, approval.reversibleLabel), style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { showAdvanced = !showAdvanced }) { Text(stringResource(if (showAdvanced) R.string.hide_advanced_details else R.string.advanced_details)) }
                            if (showAdvanced && approval.advancedDetail.isNotBlank()) {
                                Text(approval.advancedDetail, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { onDecision(approval.id, ApprovalDecision.DECLINE) }) { Text(stringResource(R.string.decline)) }
                        Button(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_ONCE) }) { Text(stringResource(R.string.allow_once)) }
                                if (approval.scope == "session") {
                        OutlinedButton(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_SESSION) }) { Text(stringResource(R.string.allow_session)) }
                                }
                            }
                        }
                    }
                }
                if (grants.isNotEmpty()) {
        item { Text(stringResource(R.string.session_grants), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
                    items(grants, key = ApprovalGrantUiItem::stableId) { grant ->
                        Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(grant.title, fontWeight = FontWeight.Medium)
                                Text(stringResource(R.string.grant_object, grant.objectLabel), style = MaterialTheme.typography.bodySmall)
                                }
                                TextButton(onClick = { onRevokeGrant(grant.stableId) }) { Text(stringResource(R.string.revoke_grant)) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun UserFriendlyEmptyStateCard(
    presentation: ai.drsai.remote.runtime.readiness.EmptyStatePresentation,
    onPrimaryAction: () -> Unit,
) {
    val localized = when (presentation.kind) {
        ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_SESSIONS -> Triple(R.string.empty_no_sessions_title, R.string.empty_no_sessions_detail, R.string.new_conversation)
        ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_RESULTS -> Triple(R.string.empty_no_results_title, R.string.empty_no_results_detail, R.string.empty_primary_new_task)
        ai.drsai.remote.runtime.readiness.EmptyStateKind.OFFLINE -> Triple(R.string.empty_offline_title, R.string.empty_offline_detail, R.string.empty_offline_action)
        ai.drsai.remote.runtime.readiness.EmptyStateKind.NO_MODEL -> Triple(R.string.empty_no_model_title, R.string.empty_no_model_detail, R.string.empty_no_model_action)
        ai.drsai.remote.runtime.readiness.EmptyStateKind.CAPABILITY_CHANGED -> Triple(R.string.empty_capability_title, R.string.empty_capability_detail, R.string.empty_capability_action)
    }
    Column(
        Modifier.fillMaxWidth().padding(16.dp).testTag("user-friendly-empty-state"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(stringResource(localized.first), fontWeight = FontWeight.SemiBold)
        Text(stringResource(localized.second), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        presentation.exampleIds.forEach { id ->
            val resource = when (id) { "web" -> R.string.example_web; "workspace" -> R.string.example_workspace; else -> R.string.example_chat }
            Text("• ${stringResource(resource)}", style = MaterialTheme.typography.labelMedium)
        }
        Button(onClick = onPrimaryAction) { Text(stringResource(localized.third)) }
    }
}

@Composable
internal fun RecoverySummaryCard(count: Int, onOpen: () -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.Refresh, null)
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(pluralStringResource(R.plurals.recoverable_task_count, count, count), fontWeight = FontWeight.SemiBold)
                Text(stringResource(R.string.recovery_summary_detail), style = MaterialTheme.typography.bodySmall)
            }
            TextButton(onClick = onOpen) { Text(stringResource(R.string.recovery_center)) }
        }
    }
}

@Composable
internal fun RecoveryCenterScreen(
    runs: List<ai.drsai.remote.runtime.reliability.RecoveryRunItem>,
    onBack: () -> Unit,
    onContinue: (String) -> Unit,
    onCancel: (String) -> Unit,
    onArchive: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Spacer(Modifier.width(8.dp))
        Text(stringResource(R.string.recovery_center), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (runs.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(stringResource(R.string.no_recoverable_tasks)) }
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(runs, key = ai.drsai.remote.runtime.reliability.RecoveryRunItem::runId) { run ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(run.title, fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.recovery_run_status, run.status, run.sessionId), style = MaterialTheme.typography.bodySmall)
                        run.failureCode?.let { Text(stringResource(R.string.reason_code, it), style = MaterialTheme.typography.labelSmall) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (run.canContinue) Button(onClick = { onContinue(run.runId) }) { Text(stringResource(R.string.continue_action)) }
                        if (run.canCancel) OutlinedButton(onClick = { onCancel(run.runId) }) { Text(stringResource(R.string.cancel)) }
                        TextButton(onClick = { onArchive(run.runId) }) { Text(stringResource(R.string.archive)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RuntimeBar(message: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(message, Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 9.dp))
    }
}

@Composable
internal fun Welcome(agent: Agent?, modifier: Modifier) {
    Box(modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(132.dp)
            Spacer(Modifier.height(20.dp))
            Text(stringResource(R.string.agent_greeting, agent?.name ?: "OpenDrSai"), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(agent?.description?.takeIf(String::isNotBlank) ?: stringResource(R.string.task_input_hint))
        }
    }
}

private data class SettingsEntry(val id: String, val label: String, val icon: ImageVector)

@Composable
private fun settingsGroups() = listOf(
        stringResource(R.string.general) to listOf(
            SettingsEntry("general", stringResource(R.string.general), Icons.Default.Settings),
            SettingsEntry("voice", stringResource(R.string.voice), Icons.Default.Mic),
    ),
        stringResource(R.string.agent) to listOf(
            SettingsEntry("defaults", stringResource(R.string.default_configuration), Icons.Default.SmartToy),
            SettingsEntry("tasks", stringResource(R.string.agent_tasks), Icons.Default.Schedule),
            SettingsEntry("approvals", stringResource(R.string.approval_center), Icons.Default.TaskAlt),
            SettingsEntry("analytics", stringResource(R.string.usage_analytics), Icons.Default.History),
    ),
        stringResource(R.string.integrations) to listOf(
            SettingsEntry("integrations", stringResource(R.string.integration_overview), Icons.Default.Extension),
            SettingsEntry("remote", stringResource(R.string.remote_workspaces), Icons.Default.Computer),
            SettingsEntry("channels", stringResource(R.string.channels), Icons.Default.Menu),
    ),
        stringResource(R.string.other) to listOf(
            SettingsEntry("system", stringResource(R.string.system_paths), Icons.Default.FolderOpen),
    ),
)

@Composable
internal fun SettingsScreen(state: AppState, onBack: () -> Unit, onOpenModels: () -> Unit) {
    var selectedId by rememberSaveable { mutableStateOf("defaults") }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 720.dp
        if (wide) {
            Row(Modifier.fillMaxSize()) {
                SettingsNavigation(
                    selectedId = selectedId,
                    onSelected = { selectedId = it },
                    onBack = onBack,
                    modifier = Modifier.width(240.dp).fillMaxHeight(),
                )
                HorizontalDivider(Modifier.fillMaxHeight().width(1.dp))
                SettingsDetail(
                    selectedId = selectedId,
                    state = state,
                    onOpenModels = onOpenModels,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
            }
        } else {
            SettingsNavigation(
                selectedId = selectedId,
                onSelected = { id -> if (id == "defaults") onOpenModels() else selectedId = id },
                onBack = onBack,
                modifier = Modifier.fillMaxSize(),
                compact = true,
            )
        }
    }
}

@Composable
private fun SettingsNavigation(
    selectedId: String,
    onSelected: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier,
    compact: Boolean = false,
) {
    val localizedSettingsGroups = settingsGroups()
    Column(modifier.testTag(if (compact) "settings-navigation-compact" else "settings-navigation-wide")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        Text(stringResource(R.string.settings), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)) {
            localizedSettingsGroups.forEach { (group, entries) ->
                item("settings-group:$group") {
                    Text(group, Modifier.padding(start = 10.dp, top = 16.dp, bottom = 6.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                }
                items(entries, key = { "settings-entry:${it.id}" }) { entry ->
                    NavigationDrawerItem(
                        icon = { Icon(entry.icon, null) },
                        label = { Text(entry.label) },
                        badge = if (compact) ({ Text("›") }) else null,
                        selected = !compact && selectedId == entry.id,
                        onClick = { onSelected(entry.id) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer),
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsDetail(selectedId: String, state: AppState, onOpenModels: () -> Unit, modifier: Modifier) {
    val entry = settingsGroups().flatMap { it.second }.firstOrNull { it.id == selectedId }
    Column(modifier.testTag("settings-detail").verticalScroll(rememberScrollState()).padding(28.dp)) {
        Text(entry?.label ?: stringResource(R.string.settings), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        if (selectedId == "defaults") {
                    Text(stringResource(R.string.settings_agent_model_detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(22.dp))
            Surface(shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp)) {
                SettingsValueRow(stringResource(R.string.default_agent), stringResource(R.string.default_agent_detail), state.selectedAgent?.name ?: "OpenDrSai") {}
                    HorizontalDivider()
                SettingsValueRow(stringResource(R.string.default_model), stringResource(R.string.default_model_detail), state.selectedModel?.name ?: stringResource(R.string.not_selected), onOpenModels)
                }
            }
        } else {
                    Text(stringResource(R.string.settings_desktop_parity_notice), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingsValueRow(title: String, description: String, value: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent) {
        Row(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold)
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.width(18.dp))
            Text(value, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(8.dp))
            Text("›", style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
internal fun ModelSettingsScreen(
    state: AppState,
    onBack: () -> Unit,
    onSelectModel: (String) -> Unit,
    onDeleteProvider: (String) -> Unit,
    onSaveProvider: (String?, String?, String, String, String, String, List<ModelInfo>, Long?) -> Unit,
    onDiscoverModels: (String?, String, String, String) -> Unit,
    onTestConnection: (String?, String, String, String, List<String>) -> Unit,
    onClearMessage: () -> Unit,
) {
    val context = LocalContext.current
    val presets = remember { AndroidModelProviderPresets.all(BuildConfig.MODEL_BASE_URL) }
    var choosingPreset by remember { mutableStateOf(false) }
    var editorOpen by remember { mutableStateOf(false) }
    var editingProviderId by remember { mutableStateOf<String?>(null) }
    var presetId by remember { mutableStateOf<String?>(null) }
    var expectedRevision by remember { mutableStateOf<Long?>(null) }
    var awaitingSave by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }
    var leaveConfirmation by remember { mutableStateOf(false) }
    var pendingDeletionId by remember { mutableStateOf<String?>(null) }
    var expandedProviderIds by remember {
        mutableStateOf(state.selectedModel?.providerId?.let(::setOf) ?: emptySet())
    }
    var name by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var wireApi by remember { mutableStateOf("openai") }
    var apiKey by remember { mutableStateOf("") }
    var draftModels by remember { mutableStateOf<List<ModelInfo>>(emptyList()) }
    var discoverySummary by remember { mutableStateOf<String?>(null) }

    fun clearCredentialDraftAndCloseEditor() {
        apiKey = ""
        editorOpen = false
        dirty = false
        discoverySummary = null
        onClearMessage()
    }

    SecureCredentialEntryEffect(enabled = editorOpen)

    fun openPreset(id: String) {
        val preset = presets.first { it.id == id }
        editingProviderId = null
        presetId = preset.id
        expectedRevision = null
        name = preset.label
        baseUrl = preset.baseUrl
        wireApi = preset.wireApi
        apiKey = ""
        draftModels = preset.suggestedModels.map {
            ModelInfo(
                "",
                it,
                tools = it in preset.toolCapableModels,
                upstreamId = it,
                source = "PRESET",
            )
        }
        choosingPreset = false
        editorOpen = true
        dirty = false
        onClearMessage()
    }

    fun editProvider(providerId: String) {
        val provider = state.modelProviders.first { it.id == providerId }
        editingProviderId = provider.id
        presetId = provider.presetId
        expectedRevision = provider.revision
        name = provider.name
        baseUrl = provider.baseUrl
        wireApi = provider.wireApi
        apiKey = ""
        draftModels = if (provider.id == "hepai") state.models.filter { it.providerId == provider.id }
            else state.configuredProviderModels.filter { it.providerId == provider.id }
        editorOpen = true
        dirty = false
        onClearMessage()
    }

    LaunchedEffect(state.discoveredProviderModels) {
        if (state.discoveredProviderModels.isNotEmpty()) {
            val merge = mergeDiscoveredModels(draftModels, state.discoveredProviderModels)
            draftModels = merge.models
            discoverySummary = context.getString(R.string.model_discovery_summary, merge.added, merge.retained, merge.missing)
            dirty = true
        }
    }
    LaunchedEffect(state.modelConfigurationMessage) {
        if (awaitingSave && state.modelConfigurationMessageKind == ModelConfigurationMessageKind.SUCCESS) {
            awaitingSave = false
            clearCredentialDraftAndCloseEditor()
        } else if (awaitingSave && !state.modelConfigurationBusy && state.modelConfigurationMessage != null) {
            awaitingSave = false
        }
    }

    if (editorOpen) {
        ModelProviderEditorScreen(
            providerId = editingProviderId,
            presetId = presetId,
            name = name,
            onNameChange = { name = it; dirty = true },
            baseUrl = baseUrl,
            onBaseUrlChange = { baseUrl = it; dirty = true },
            wireApi = wireApi,
            onWireApiChange = { wireApi = it; dirty = true },
            apiKey = apiKey,
            onApiKeyChange = { apiKey = it; dirty = true },
            models = draftModels,
            onModelsChange = { draftModels = it; dirty = true },
            busy = state.modelConfigurationBusy,
            message = discoverySummary ?: state.modelConfigurationMessage,
            messageIsError = discoverySummary == null && state.modelConfigurationMessageKind == ModelConfigurationMessageKind.ERROR,
            hasSavedKey = editingProviderId?.let { id -> state.modelProviders.firstOrNull { it.id == id }?.hasApiKey } == true,
            nameEditable = presetId == "custom" || presetId == null,
            baseUrlEditable = presets.firstOrNull { it.id == presetId }?.baseUrlEditable != false,
            selectedModelId = state.selectedModel?.id,
            onBack = { if (dirty) leaveConfirmation = true else clearCredentialDraftAndCloseEditor() },
            onDiscover = { onDiscoverModels(editingProviderId, baseUrl, wireApi, apiKey) },
            onTestConnection = { onTestConnection(
                editingProviderId, baseUrl, wireApi, apiKey,
                draftModels.filter(ModelInfo::enabled).map(ModelInfo::upstreamId),
            ) },
            onSave = {
                awaitingSave = true
                onSaveProvider(editingProviderId, presetId, name, baseUrl, wireApi, apiKey, draftModels, expectedRevision)
            },
        )
        if (leaveConfirmation) AlertDialog(
            onDismissRequest = { leaveConfirmation = false },
            title = { Text(stringResource(R.string.discard_unsaved_question)) },
            text = { Text(stringResource(R.string.discard_unsaved_detail)) },
            confirmButton = { TextButton(onClick = { leaveConfirmation = false; clearCredentialDraftAndCloseEditor() }) { Text(stringResource(R.string.discard_changes), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { leaveConfirmation = false }) { Text(stringResource(R.string.continue_editing)) } },
        )
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.testTag("model-settings-back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.model_settings), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            IconButton(onClick = { choosingPreset = true }, modifier = Modifier.testTag("add-model-provider")) { Icon(Icons.Default.Add, stringResource(R.string.add_provider)) }
        }
        state.modelConfigurationMessage?.let { message ->
            Surface(color = if (state.modelConfigurationMessageKind != ModelConfigurationMessageKind.ERROR) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer, modifier = Modifier.testTag("model-configuration-status")) {
                Text(message, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp))
            }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            items(state.modelProviders, key = { "provider:${it.id}" }) { provider ->
                Column {
                    val expanded = provider.id in expandedProviderIds
                    Surface(
                        onClick = {
                            expandedProviderIds = if (expanded) expandedProviderIds - provider.id else expandedProviderIds + provider.id
                        },
                        modifier = Modifier.testTag("model-provider-row-${provider.id}"),
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    ) {
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, stringResource(if (expanded) R.string.collapse else R.string.expand))
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(provider.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                Text(
                                pluralStringResource(R.plurals.provider_model_count, provider.modelIds.size, provider.modelIds.size, provider.baseUrl),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val statusLabel = when (provider.connectionStatus) {
                                "AVAILABLE" -> stringResource(R.string.connection_ok)
                                "FAILED" -> stringResource(R.string.connection_failed)
                                else -> stringResource(R.string.connection_not_checked)
                                }
                                val checkedAtLabel = provider.lastCheckedAt?.let {
                                    " · ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(it))}"
                                }.orEmpty()
                                Text(
                                stringResource(R.string.enabled_model_count, statusLabel, checkedAtLabel, state.configuredProviderModels.count { it.providerId == provider.id && it.enabled }),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (provider.connectionStatus == "FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { editProvider(provider.id) }, modifier = Modifier.testTag("edit-model-provider-${provider.id}")) { Icon(Icons.Default.Edit, stringResource(R.string.edit_provider)) }
                            if (!provider.builtIn) IconButton(onClick = { pendingDeletionId = provider.id }, modifier = Modifier.testTag("delete-model-provider-${provider.id}")) { Icon(Icons.Default.Delete, stringResource(R.string.delete_provider)) }
                        }
                    }
                    if (expanded) {
                        Spacer(Modifier.height(6.dp))
                        val providerModels = if (provider.id == "hepai") state.models.filter { it.providerId == provider.id }
                            else state.configuredProviderModels.filter { it.providerId == provider.id }
                        if (providerModels.isEmpty()) {
                Text(stringResource(R.string.no_models_configured), Modifier.padding(horizontal = 16.dp, vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        providerModels.forEach { model ->
                            Surface(onClick = { onSelectModel(model.id) }, color = if (state.selectedModel?.id == model.id) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent, shape = RoundedCornerShape(12.dp)) {
                                Row(Modifier.fillMaxWidth().padding(start = 50.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(model.name, Modifier.weight(1f))
                            if (!model.enabled) Text(stringResource(R.string.disabled), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                            if (state.selectedModel?.id == model.id) Text(stringResource(R.string.current), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (choosingPreset) AlertDialog(
        onDismissRequest = { choosingPreset = false },
            title = { Text(stringResource(R.string.choose_model_provider)) },
        text = {
            LazyColumn(Modifier.heightIn(max = 480.dp)) {
                items(presets, key = { "preset:${it.id}" }) { preset ->
                    Surface(onClick = { openPreset(preset.id) }, color = Color.Transparent) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
                            Text(preset.label, fontWeight = FontWeight.SemiBold)
                                Text(if (preset.id == "custom") stringResource(R.string.custom_provider_detail) else preset.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider()
                }
            }
        },
        confirmButton = {},
            dismissButton = { TextButton(onClick = { choosingPreset = false }) { Text(stringResource(R.string.cancel)) } },
    )
    pendingDeletionId?.let { id ->
        val provider = state.modelProviders.firstOrNull { it.id == id }
        val isDefault = state.selectedModel?.providerId == id
        AlertDialog(
            onDismissRequest = { pendingDeletionId = null },
            title = { Text(stringResource(R.string.delete_provider_question, provider?.name ?: stringResource(R.string.provider_fallback_name))) },
            text = { val count = provider?.modelIds?.size ?: 0; Text(pluralStringResource(R.plurals.delete_provider_detail, count, count, if (isDefault) stringResource(R.string.delete_default_provider_impact) else "")) },
            confirmButton = { TextButton(onClick = { onDeleteProvider(id); pendingDeletionId = null }) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { pendingDeletionId = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun SecureCredentialEntryEffect(enabled: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, enabled) {
        val activity = generateSequence(view.context as Context?) { context ->
            (context as? ContextWrapper)?.baseContext
        }.filterIsInstance<Activity>().firstOrNull()
        val window = activity?.window
        val wasSecure = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        if (enabled && !wasSecure) window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            if (enabled && !wasSecure) window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}

@Composable
internal fun ModelProviderEditorScreen(
    providerId: String?, presetId: String?, name: String, onNameChange: (String) -> Unit,
    baseUrl: String, onBaseUrlChange: (String) -> Unit, wireApi: String, onWireApiChange: (String) -> Unit,
    apiKey: String, onApiKeyChange: (String) -> Unit, models: List<ModelInfo>, onModelsChange: (List<ModelInfo>) -> Unit,
    busy: Boolean, message: String?, messageIsError: Boolean = false, hasSavedKey: Boolean, nameEditable: Boolean, baseUrlEditable: Boolean,
    selectedModelId: String?, onBack: () -> Unit, onDiscover: () -> Unit, onTestConnection: () -> Unit, onSave: () -> Unit,
) {
    var clearConfirmation by remember { mutableStateOf(false) }
    var saveImpactConfirmation by remember { mutableStateOf(false) }
    var apiKeyVisible by remember { mutableStateOf(false) }
    var modelQuery by remember { mutableStateOf("") }
    var modelFilter by remember { mutableStateOf("all") }
    var selectionMode by remember { mutableStateOf(false) }
    var selectedModelKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var undoModels by remember { mutableStateOf<List<ModelInfo>?>(null) }
    fun modelKey(index: Int, model: ModelInfo) = model.id.ifBlank { "${model.upstreamId}:$index" }
    val visibleModels = models.mapIndexed { index, model -> index to model }.filter { (_, model) ->
        (modelQuery.isBlank() || "${model.name} ${model.upstreamId}".contains(modelQuery.trim(), ignoreCase = true)) &&
            (modelFilter == "all" || (modelFilter == "enabled" && model.enabled) || (modelFilter == "disabled" && !model.enabled))
    }
    fun requestSave() {
        if (selectedModelId != null && models.any { it.id == selectedModelId && !it.enabled }) saveImpactConfirmation = true
        else onSave()
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.testTag("model-provider-editor-back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(if (providerId == null) R.string.add_provider else R.string.edit_provider), Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Button(onClick = ::requestSave, enabled = !busy, modifier = Modifier.testTag("model-provider-save")) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.save))
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let { value ->
            Surface(color = if (messageIsError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
                Text(value, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp))
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("model-provider-editor-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
        OutlinedTextField(name, onNameChange, Modifier.fillMaxWidth().testTag("provider-name"), label = { Text(stringResource(R.string.provider_name)) }, enabled = nameEditable, singleLine = true)
            }
            item {
                OutlinedTextField(
            apiKey, onApiKeyChange, Modifier.fillMaxWidth().testTag("provider-api-key"), label = { Text(stringResource(R.string.api_key)) },
            placeholder = { if (!hasSavedKey) Text(stringResource(R.string.enter_api_key)) },
            supportingText = { if (hasSavedKey) Text(stringResource(R.string.saved_key_unchanged)) },
                    visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(), singleLine = true,
            trailingIcon = { IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) { Icon(if (apiKeyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility, stringResource(if (apiKeyVisible) R.string.hide_key else R.string.show_key)) } },
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = onTestConnection, enabled = !busy && baseUrl.isNotBlank()) { Text(stringResource(R.string.test_connection)) }
                }
            }
            item {
        OutlinedTextField(baseUrl, onBaseUrlChange, Modifier.fillMaxWidth().testTag("provider-base-url"), label = { Text(stringResource(R.string.api_host)) }, enabled = baseUrlEditable, placeholder = { Text("https://api.example.com/v1") }, singleLine = true)
                if (baseUrl.isNotBlank()) Text("${baseUrl.trimEnd('/')}/${if (wireApi == "anthropic") "v1/messages" else "chat/completions"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (presetId == "custom" || presetId == null) item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onWireApiChange("openai") }, colors = ButtonDefaults.outlinedButtonColors(containerColor = if (wireApi == "openai") MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)) { Text("OpenAI Compatible") }
                    OutlinedButton(onClick = { onWireApiChange("anthropic") }, colors = ButtonDefaults.outlinedButtonColors(containerColor = if (wireApi == "anthropic") MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)) { Text("Anthropic") }
                }
            }
            item {
                Column {
        Text(stringResource(R.string.models_enabled_summary, models.count(ModelInfo::enabled), models.size), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { onModelsChange(models + ModelInfo("", "", upstreamId = "")) }) { Icon(Icons.Default.Add, null); Text(stringResource(R.string.new_item)) }
            TextButton(onClick = onDiscover, enabled = !busy && baseUrl.isNotBlank()) { Icon(Icons.Default.Refresh, null); Text(stringResource(R.string.fetch)) }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { onModelsChange(models.map { it.copy(enabled = true) }) }, enabled = models.any { !it.enabled }) { Text(stringResource(R.string.enable_all)) }
            TextButton(onClick = { onModelsChange(models.map { it.copy(enabled = false) }) }, enabled = models.any(ModelInfo::enabled)) { Text(stringResource(R.string.disable_all)) }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { selectionMode = !selectionMode; selectedModelKeys = emptySet() }, modifier = Modifier.testTag("toggle-model-selection")) { Text(stringResource(if (selectionMode) R.string.exit_multi_select else R.string.multi_select)) }
                TextButton(onClick = { clearConfirmation = true }, enabled = models.isNotEmpty(), modifier = Modifier.testTag("clear-all-models")) { Text(stringResource(R.string.clear), color = MaterialTheme.colorScheme.error) }
                    }
                        if (selectionMode) TextButton(
                            onClick = {
                                undoModels = models
                                onModelsChange(models.filterIndexed { index, model -> modelKey(index, model) !in selectedModelKeys })
                                selectedModelKeys = emptySet()
                            },
                            enabled = selectedModelKeys.isNotEmpty(),
                            modifier = Modifier.testTag("delete-selected-models"),
                ) { Text(stringResource(R.string.delete_selected, selectedModelKeys.size), color = MaterialTheme.colorScheme.error) }
                }
            }
            item {
        OutlinedTextField(modelQuery, { modelQuery = it }, Modifier.fillMaxWidth().testTag("model-search"), label = { Text(stringResource(R.string.search_models)) }, singleLine = true, leadingIcon = { Icon(Icons.Default.Search, null) })
                Row(Modifier.horizontalScroll(rememberScrollState())) {
        listOf("all" to stringResource(R.string.all_filter), "enabled" to stringResource(R.string.enabled_filter), "disabled" to stringResource(R.string.disabled_filter)).forEach { (id, label) ->
                        TextButton(onClick = { modelFilter = id }, colors = ButtonDefaults.textButtonColors(containerColor = if (modelFilter == id) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)) { Text(label) }
                    }
                }
            }
            items(visibleModels, key = { (index, model) -> "draft-model:${model.id}:${model.upstreamId}:$index" }) { (index, model) ->
                Surface(modifier = Modifier.testTag("model-card-$index"), shape = RoundedCornerShape(12.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (selectionMode) {
                                val key = modelKey(index, model)
                                Checkbox(
                                    checked = key in selectedModelKeys,
                                    onCheckedChange = { checked ->
                                        selectedModelKeys = if (checked) selectedModelKeys + key else selectedModelKeys - key
                                    },
                                    modifier = Modifier.testTag("select-model-$index"),
                                )
                            }
                            Text(stringResource(R.string.enabled), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            Switch(model.enabled, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(enabled = value) }) })
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(model.upstreamId, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(upstreamId = value, name = if (model.name == model.upstreamId) value else model.name) }) }, Modifier.weight(1f), label = { Text(stringResource(R.string.model_id)) }, singleLine = true)
                            IconButton(onClick = { onModelsChange(models.filterIndexed { i, _ -> i != index }) }) { Icon(Icons.Default.Delete, stringResource(R.string.delete_model)) }
                        }
                    OutlinedTextField(model.name, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(name = value) }) }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.display_name)) }, singleLine = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.vision)); Switch(model.vision, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(vision = value) }) })
                        Text(stringResource(R.string.tools)); Switch(model.tools, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(tools = value) }) })
                        Text(stringResource(R.string.reasoning)); Switch(model.reasoning, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(reasoning = value) }) })
                        }
                        Text(
                            stringResource(when (model.source) { "PRESET" -> R.string.source_preset; "DISCOVERED" -> R.string.source_discovered; else -> R.string.source_manual }),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item { Spacer(Modifier.height(28.dp)) }
        }
        undoModels?.let { previous ->
            Surface(color = MaterialTheme.colorScheme.inverseSurface) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.selected_models_removed), Modifier.weight(1f), color = MaterialTheme.colorScheme.inverseOnSurface)
                TextButton(onClick = { onModelsChange(previous); undoModels = null }) { Text(stringResource(R.string.undo)) }
                }
            }
        }
    }
    if (clearConfirmation) AlertDialog(
        modifier = Modifier.testTag("clear-models-confirmation"),
        onDismissRequest = { clearConfirmation = false },
            title = { Text(stringResource(R.string.clear_model_list_question)) },
            text = { Text(pluralStringResource(R.plurals.clear_model_list_detail, models.size, models.size)) },
            confirmButton = { TextButton(onClick = { onModelsChange(emptyList()); clearConfirmation = false }) { Text(stringResource(R.string.clear), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { clearConfirmation = false }) { Text(stringResource(R.string.cancel)) } },
    )
    if (saveImpactConfirmation) AlertDialog(
        onDismissRequest = { saveImpactConfirmation = false },
            title = { Text(stringResource(R.string.default_model_will_disable)) },
            text = { Text(stringResource(R.string.default_model_disable_detail)) },
            confirmButton = { TextButton(onClick = { saveImpactConfirmation = false; onSave() }) { Text(stringResource(R.string.continue_saving)) } },
            dismissButton = { TextButton(onClick = { saveImpactConfirmation = false }) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
internal fun OaepTimeline(
    entries: List<OaepTimelineEntry>,
    snapshotSequence: Long,
    composerExpanded: Boolean,
    modifier: Modifier,
    onRemedy: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
    var followLatest by rememberSaveable { mutableStateOf(true) }
    var programmaticScroll by remember { mutableStateOf(false) }
    var previousEntryCount by remember { mutableStateOf(entries.size) }
    val userScrollObserver = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput) followLatest = false
                return Offset.Zero
            }
        }
    }
    val lastText = entries.lastOrNull().let { entry ->
        (entry as? OaepTimelineEntry.AssistantTurn)?.results?.lastOrNull()?.text
    }
    LaunchedEffect(listState) {
        snapshotFlow {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            ai.drsai.remote.remote.model.TimelineScrollPolicy.isAtBottom(lastVisible, info.totalItemsCount)
        }.collect { atBottom ->
            if (!programmaticScroll) followLatest = atBottom
        }
    }
    LaunchedEffect(entries.size, lastText, snapshotSequence, imeBottom, followLatest) {
        if (entries.isNotEmpty() && ai.drsai.remote.remote.model.TimelineScrollPolicy.shouldFollowLatest(followLatest, imeBottom > 0)) {
            programmaticScroll = true
            try {
                kotlinx.coroutines.delay(32)
                if (imeBottom > 0 || entries.size == previousEntryCount) listState.scrollToItem(entries.lastIndex)
                else listState.animateScrollToItem(entries.lastIndex)
                followLatest = true
            } finally {
                programmaticScroll = false
                previousEntryCount = entries.size
            }
        } else {
            previousEntryCount = entries.size
        }
    }
    Box(modifier.fillMaxWidth()) {
        LazyColumn(
            modifier = Modifier.fillMaxWidth().nestedScroll(userScrollObserver).testTag("oaep-timeline-list"), state = listState,
            contentPadding = PaddingValues(start = 16.dp, top = 94.dp, end = 16.dp, bottom = if (composerExpanded) 190.dp else 104.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            itemsIndexed(entries, key = { _, entry -> entry.stableId }) { index, entry ->
                val outcomeLabel = (entry as? OaepTimelineEntry.AssistantTurn)?.let { userRunOutcomeLabel(it.outcome) }
                Box(Modifier.semantics {
                    traversalIndex = index.toFloat()
                    contentDescription = when (entry) {
                        is OaepTimelineEntry.UserMessage -> context.getString(R.string.a11y_user_message, entry.text.take(80))
                        is OaepTimelineEntry.AssistantTurn -> context.getString(R.string.a11y_agent_reply, outcomeLabel.orEmpty())
                    }
                }) {
                    when (entry) {
                        is OaepTimelineEntry.UserMessage -> OaepUserMessage(entry)
                        is OaepTimelineEntry.AssistantTurn -> OaepAssistantTurn(entry, onRemedy)
                    }
                }
            }
        }
        if (!followLatest && entries.isNotEmpty()) {
            Button(
                onClick = { followLatest = true },
                modifier = Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = if (composerExpanded) 198.dp else 112.dp)
                    .testTag("timeline-return-latest"),
                ) { Text(stringResource(R.string.back_to_latest)) }
        }
    }
}

@Composable
private fun OaepUserMessage(message: OaepTimelineEntry.UserMessage) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Text(stringResource(R.string.you), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(18.dp), modifier = Modifier.widthIn(max = 620.dp)) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (message.resources.isNotEmpty()) message.resources.forEach { resource ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(resource.label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (message.text.isNotBlank()) RemoteMarkdownContent(message.text)
            }
        }
    }
}

@Composable
private fun userRunOutcomeLabel(outcome: ai.drsai.remote.remote.model.UserRunOutcome): String = stringResource(
    when (outcome) {
        ai.drsai.remote.remote.model.UserRunOutcome.QUEUED -> R.string.run_outcome_queued
        ai.drsai.remote.remote.model.UserRunOutcome.RUNNING -> R.string.run_outcome_running
        ai.drsai.remote.remote.model.UserRunOutcome.RECOVERABLE -> R.string.run_outcome_recoverable
        ai.drsai.remote.remote.model.UserRunOutcome.COMPLETED -> R.string.run_outcome_completed
        ai.drsai.remote.remote.model.UserRunOutcome.PARTIAL -> R.string.run_outcome_partial
        ai.drsai.remote.remote.model.UserRunOutcome.FAILED -> R.string.run_outcome_failed
        ai.drsai.remote.remote.model.UserRunOutcome.CANCELLED -> R.string.run_outcome_cancelled
        ai.drsai.remote.remote.model.UserRunOutcome.PROCESSING -> R.string.run_outcome_processing
    },
)

@Composable
internal fun OaepAssistantTurn(turn: OaepTimelineEntry.AssistantTurn, onRemedy: (String) -> Unit = {}) {
    val active = !turn.outcome.terminal && !turn.outcome.recoverable
    val outcomeLabel = userRunOutcomeLabel(turn.outcome)
    var processOpen by rememberSaveable(turn.stableId) { mutableStateOf(false) }
    var advancedOpen by rememberSaveable(turn.stableId) { mutableStateOf(false) }
    val expandedDescription = stringResource(R.string.expanded)
    val collapsedDescription = stringResource(R.string.collapsed)
    Column(Modifier.fillMaxWidth().semantics {
        stateDescription = outcomeLabel
        if (active) liveRegion = LiveRegionMode.Polite
    }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BrandLogo(22.dp)
            Spacer(Modifier.width(8.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(
                outcomeLabel,
                modifier = Modifier.testTag("run-outcome-${turn.runId}"),
                style = MaterialTheme.typography.labelSmall,
                color = if (turn.outcome in setOf(ai.drsai.remote.remote.model.UserRunOutcome.FAILED, ai.drsai.remote.remote.model.UserRunOutcome.PARTIAL)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (active) {
                Spacer(Modifier.width(8.dp))
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            }
        }
        if (turn.process.isNotEmpty()) {
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { processOpen = !processOpen }
                            .semantics { role = Role.Button; stateDescription = if (processOpen) expandedDescription else collapsedDescription }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(stringResource(if (active) R.string.executing else R.string.execution_process), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    Text(pluralStringResource(R.plurals.process_item_count, turn.process.size, turn.process.size), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(if (processOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore, stringResource(if (processOpen) R.string.collapse else R.string.expand))
                    }
                    if (processOpen) {
                        HorizontalDivider()
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            turn.process.forEach { OaepProcessRow(it, advancedOpen, onRemedy) }
                            TextButton(
                                onClick = { advancedOpen = !advancedOpen },
                                modifier = Modifier.testTag("oaep-advanced-details"),
                            ) { Text(stringResource(if (advancedOpen) R.string.hide_advanced else R.string.advanced_details)) }
                        }
                    }
                }
            }
        }
        turn.interactions.forEach { interaction ->
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.tertiaryContainer, border = BorderStroke(1.dp, MaterialTheme.colorScheme.tertiary)) {
                Column(Modifier.padding(14.dp)) {
                Text(stringResource(R.string.action_required, interaction.title), fontWeight = FontWeight.Bold)
                    if (interaction.prompt.isNotBlank()) { Spacer(Modifier.height(6.dp)); RemoteMarkdownContent(interaction.prompt) }
                }
            }
        }
        turn.results.forEach { result ->
            if (result.kind == "markdown") {
                if (result.text.isNotBlank()) RemoteMarkdownContent(result.text)
                OaepSourceLinks(result.sources)
            } else {
                Surface(shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column(Modifier.padding(14.dp)) {
                        Text(result.title ?: stringResource(R.string.artifact), fontWeight = FontWeight.Bold)
                        if (result.text.isNotBlank()) { Spacer(Modifier.height(6.dp)); RemoteMarkdownContent(result.text) }
                        OaepSourceLinks(result.sources)
                    }
                }
            }
        }
        if (turn.results.isEmpty() && active && turn.process.isEmpty()) {
                Text(stringResource(R.string.thinking), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun OaepProcessRow(item: OaepProcessItem, advanced: Boolean, onRemedy: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        if (item.status in setOf("pending", "running", "waiting")) CircularProgressIndicator(Modifier.padding(top = 3.dp).size(14.dp), strokeWidth = 2.dp)
        else Icon(Icons.Default.TaskAlt, null, Modifier.padding(top = 1.dp).size(18.dp), tint = if (item.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                    item.purpose?.takeIf(String::isNotBlank)?.let { Text(stringResource(R.string.purpose, it), style = MaterialTheme.typography.bodySmall) }
                    item.inputSummary?.takeIf(String::isNotBlank)?.let { Text(stringResource(R.string.input_summary, it), style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                    item.durationMs?.let { Text(stringResource(R.string.duration_ms, it.toLong()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            item.taskProgress?.let { progress ->
                        Text(stringResource(R.string.task_goal, progress.goal), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                Text(
                    stringResource(R.string.task_progress_summary, progress.completed, progress.running, progress.waiting, progress.failed),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (progress.failed > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                        if (progress.partialFailure) Text(stringResource(R.string.partial_failure_notice), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
                progress.steps.take(12).forEach { step ->
                    Text("${taskStepMarker(step.status)} ${step.title}", style = MaterialTheme.typography.bodySmall)
                }
            }
            item.executionLocation?.takeIf(String::isNotBlank)?.let {
                            Text(stringResource(R.string.execution_location, it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (item.text.isNotBlank() && item.text != item.status) {
                Spacer(Modifier.height(4.dp))
                        Text(stringResource(R.string.result_text, item.text), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (item.kind == "reasoning") 8 else 4, overflow = TextOverflow.Ellipsis)
            }
            item.operationOutcome?.let { outcome ->
                        outcome.completed?.let { Text(stringResource(R.string.completed_summary, it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                        outcome.notExecuted?.let { Text(stringResource(R.string.not_executed_summary, it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                outcome.irreversibleNotice?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                if (outcome.remedyLabel != null && outcome.remedyPrompt != null) {
                    TextButton(onClick = { onRemedy(outcome.remedyPrompt) }, modifier = Modifier.testTag("tool-remedy-${item.id}")) {
                        Text(outcome.remedyLabel)
                    }
                }
            }
            OaepSourceLinks(item.sources)
            if (advanced) item.advancedDetail?.takeIf(String::isNotBlank)?.let {
                        Text(stringResource(R.string.internal_detail, it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

@Composable
private fun OaepSourceLinks(sources: List<OaepSourceLink>) {
    if (sources.isEmpty()) return
    val context = LocalContext.current
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.sources), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        sources.forEach { source ->
            val typeLabel = when (source.type) {
                ai.drsai.remote.remote.model.OaepSourceType.WEB -> stringResource(R.string.source_web)
                ai.drsai.remote.remote.model.OaepSourceType.LOCAL_DOCUMENT -> stringResource(R.string.source_local_document)
                ai.drsai.remote.remote.model.OaepSourceType.ARTIFACT -> stringResource(R.string.source_artifact)
            }
            val display = "$typeLabel · ${source.label}${if (source.verified) stringResource(R.string.verified_suffix) else ""}"
            Text(
                display,
                modifier = source.url?.let { url -> Modifier.clickable {
                    runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) }
                } } ?: Modifier,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun OaepMessages(
    entries: List<RemoteTranscriptMessage>,
    runStatus: String?,
    snapshotSequence: Long,
    composerExpanded: Boolean,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    val imeBottom = WindowInsets.ime.getBottom(density)
    LaunchedEffect(entries.size, entries.lastOrNull()?.text, snapshotSequence, imeBottom) {
        if (entries.isNotEmpty()) {
            if (imeBottom > 0) listState.scrollToItem(entries.lastIndex)
            else listState.animateScrollToItem(entries.lastIndex)
        }
    }
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        state = listState,
        contentPadding = PaddingValues(
            start = 16.dp, top = 94.dp, end = 16.dp,
            bottom = if (composerExpanded) 190.dp else 104.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        itemsIndexed(entries, key = { _, entry -> entry.id }) { index, entry ->
            if (index == 0 || entries[index - 1].runId != entry.runId) {
                Text(
                    "Run ${entry.runId?.takeLast(8).orEmpty()} · ${if (entry.runId == entries.lastOrNull()?.runId) runStatus.orEmpty() else ""}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OaepSemanticItem(
                entry.role, entry.text, entry.progress, entry.kind, entry.title,
                entry.detail, entry.phase, entry.resources,
            )
        }
    }
}

@Composable
private fun Messages(
    messages: List<ChatMessage>,
    assistantName: String,
    composerExpanded: Boolean,
    retryAttachment: (String, String) -> Unit,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    val density = LocalDensity.current
    val imeBottom = WindowInsets.ime.getBottom(density)
    LaunchedEffect(messages.size, messages.lastOrNull()?.text, imeBottom) {
        if (messages.isNotEmpty()) {
            if (imeBottom > 0) listState.scrollToItem(messages.lastIndex)
            else listState.animateScrollToItem(messages.lastIndex)
        }
    }
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        state = listState,
        contentPadding = PaddingValues(start = 16.dp, top = 94.dp, end = 16.dp, bottom = if (composerExpanded) 190.dp else 104.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        items(messages, key = { it.id }) { MessageBubble(it, assistantName, retryAttachment) }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, assistantName: String, retryAttachment: (String, String) -> Unit) {
    val isUser = message.role == "user"
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (isUser) Alignment.End else Alignment.Start) {
        Text(if (isUser) stringResource(R.string.you) else assistantName, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        val content: @Composable () -> Unit = {
            Column(Modifier.padding(if (isUser) 14.dp else 4.dp)) {
                if (message.attachments.isNotEmpty()) {
                    MessageAttachments(message.attachments) { attachmentId -> retryAttachment(message.id, attachmentId) }
                    if (message.text.isNotBlank()) Spacer(Modifier.height(8.dp))
                }
                if (message.text.isNotBlank()) {
                    RemoteMarkdownContent(message.text)
                } else if (message.attachments.isEmpty()) {
        Text(stringResource(R.string.thinking))
                }
                if (!isUser && message.text.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    IconButton(
                        onClick = {
                            val safeText = ClipboardAccessPolicy.sanitizeForWrite(message.text, userInitiated = true)
                            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                                .setPrimaryClip(ClipData.newPlainText("OpenDrSai", safeText))
                Toast.makeText(context, context.getString(R.string.copied_redacted), Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.size(48.dp),
        ) { Icon(Icons.Default.ContentCopy, stringResource(R.string.copy), Modifier.size(16.dp)) }
                }
                if (message.status != "complete" && message.status != "streaming") {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        when (message.status) {
        "paused" -> stringResource(R.string.paused)
        "stopped" -> stringResource(R.string.stopped)
        "failed" -> stringResource(R.string.generation_failed)
                            else -> message.status
                        },
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
        if (isUser) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.widthIn(max = 620.dp),
                content = content,
            )
        } else {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterStart) { content() }
        }
    }
}

@Composable
private fun MessageAttachments(attachments: List<ai.drsai.remote.data.MessageAttachment>, retry: (String) -> Unit) {
    val context = LocalContext.current
    var pendingSave by remember { mutableStateOf<File?>(null) }
    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val source = pendingSave
        pendingSave = null
        if (uri != null && source != null) {
            runCatching {
                context.contentResolver.openOutputStream(uri, "wt")!!.use { output -> source.inputStream().use { it.copyTo(output) } }
                    }.onFailure { Toast.makeText(context, context.getString(R.string.save_file_failed), Toast.LENGTH_SHORT).show() }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        attachments.forEach { attachment ->
            val localFile = attachment.localPath?.let(::File)?.takeIf(File::isFile)
            Row(
                modifier = if (localFile != null) Modifier.clickable {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", localFile)
                    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, attachment.mimeType)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    runCatching { context.startActivity(intent) }
                    .onFailure { Toast.makeText(context, context.getString(R.string.no_app_to_open_file), Toast.LENGTH_SHORT).show() }
                } else Modifier,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val bitmap = remember(attachment.thumbnailPath) {
                    attachment.thumbnailPath?.let(BitmapFactory::decodeFile)?.asImageBitmap()
                }
                if (bitmap != null) {
                    Image(bitmap, attachment.name, Modifier.size(52.dp), contentScale = ContentScale.Crop)
                } else {
                    Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.size(28.dp))
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(attachment.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (attachment.status == "download_failed") stringResource(R.string.download_failed) else LocalizedFormatting.bytes(attachment.size, java.util.Locale.forLanguageTag(LocalConfiguration.current.locales[0].toLanguageTag())),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (attachment.status == "download_failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (attachment.status == "download_failed") {
                TextButton(onClick = { retry(attachment.id) }) { Text(stringResource(R.string.retry)) }
                } else if (localFile != null) {
                    IconButton(onClick = {
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", localFile)
                        val intent = Intent(Intent.ACTION_SEND).setType(attachment.mimeType)
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            .apply { clipData = ClipData.newRawUri(attachment.name, uri) }
                    context.startActivity(Intent.createChooser(intent, context.getString(R.string.share_named_item, attachment.name)))
                }) { Icon(Icons.Default.Share, stringResource(R.string.share_attachment)) }
                    IconButton(onClick = {
                        pendingSave = localFile
                        saveLauncher.launch(attachment.name)
                }) { Icon(Icons.Default.Download, stringResource(R.string.save_attachment)) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun Composer(
    state: AppState,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    onAddAttachment: (Uri, String?) -> Unit = { _, _ -> },
    onRemoveAttachment: (String) -> Unit = {},
    onRetryAttachment: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val busy = state.streaming || state.recovering
    var text by rememberSaveable { mutableStateOf("") }
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    var awaitingAttachmentAcceptance by rememberSaveable { mutableStateOf(false) }
    var attachmentSheetOpen by remember { mutableStateOf(false) }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    var pendingCameraName by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val send = {
        if ((text.isNotBlank() || state.attachmentDrafts.isNotEmpty()) && state.selectedAgent?.chatSupported == true && !busy) {
            val includesAttachments = state.attachmentDrafts.isNotEmpty()
            onSend(text)
            if (includesAttachments) awaitingAttachmentAcceptance = true else text = ""
        }
    }
    LaunchedEffect(state.attachmentDrafts.isEmpty(), state.messages.size) {
        if (awaitingAttachmentAcceptance && state.attachmentDrafts.isEmpty()) {
            text = ""
            awaitingAttachmentAcceptance = false
        }
    }
    val speechLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text = it }
        }
    }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        if (saved) pendingCameraUri?.let { onAddAttachment(it, pendingCameraName) }
        pendingCameraUri = null
        pendingCameraName = null
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_ATTACHMENTS)) { uris ->
        uris.forEach { onAddAttachment(it, null) }
    }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { onAddAttachment(it, null) }
    }
    val startSpeechRecognition: () -> Unit = {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
            putExtra(RecognizerIntent.EXTRA_PROMPT, context.getString(R.string.voice_prompt))
        }
        runCatching { speechLauncher.launch(intent) }
            .onFailure { Toast.makeText(context, context.getString(R.string.voice_service_unavailable), Toast.LENGTH_SHORT).show() }
        Unit
    }

    if (attachmentSheetOpen) {
        ModalBottomSheet(onDismissRequest = { attachmentSheetOpen = false }) {
                AttachmentSourceButton(Icons.Default.CameraAlt, stringResource(R.string.take_photo)) {
                attachmentSheetOpen = false
                val directory = File(context.cacheDir, "attachments/camera").apply { mkdirs() }
                val file = File(directory, "camera-${UUID.randomUUID()}.jpg")
                pendingCameraName = file.name
                pendingCameraUri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                cameraLauncher.launch(pendingCameraUri!!)
            }
                AttachmentSourceButton(Icons.Default.Image, stringResource(R.string.choose_gallery)) {
                attachmentSheetOpen = false
                photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
                AttachmentSourceButton(Icons.Default.AttachFile, stringResource(R.string.choose_file)) {
                attachmentSheetOpen = false
                fileLauncher.launch(ai.drsai.remote.data.AttachmentPolicy.acceptedDocumentMimeTypes)
            }
            Spacer(Modifier.height(22.dp))
        }
    }

    Surface(
        modifier = modifier
            .padding(start = 12.dp, top = 10.dp, end = 12.dp, bottom = if (imeVisible) 0.dp else 12.dp)
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .heightIn(min = 60.dp),
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        // Desktop composer is a pure white card; elevation is shadow-only.
        tonalElevation = 0.dp,
        shadowElevation = 6.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.fillMaxWidth()) {
            if (state.attachmentDrafts.isNotEmpty()) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, top = 10.dp, end = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.attachmentDrafts.forEach { draft ->
                        AttachmentDraftCard(draft, { onRemoveAttachment(draft.id) }, { onRetryAttachment(draft.id) })
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                IconButton(onClick = { attachmentSheetOpen = true }, enabled = !busy, modifier = Modifier.requiredSize(48.dp)) {
                    Icon(Icons.Default.Add, stringResource(R.string.add_attachment))
                }
                BasicTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f).padding(vertical = 5.dp).testTag("runtime-composer-input").semantics {
            contentDescription = context.getString(R.string.message_to_agent, state.selectedAgent?.name ?: "OpenDrSai")
                    stateDescription = when {
                busy -> context.getString(R.string.run_busy_not_editable)
                state.selectedAgent?.chatSupported != true -> context.getString(R.string.agent_chat_unsupported)
                text.isBlank() -> context.getString(R.string.blank)
                else -> context.resources.getQuantityString(R.plurals.entered_character_count, text.length, text.length)
                    }
                },
                enabled = !busy && state.selectedAgent?.chatSupported == true,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                decorationBox = { innerTextField ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                        if (text.isEmpty()) Text(
                stringResource(R.string.send_to_agent, state.selectedAgent?.name ?: "OpenDrSai"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        innerTextField()
                    }
                },
                )
                when {
                    busy -> FilledIconButton(onClick = onStop, modifier = Modifier.requiredSize(48.dp).testTag("runtime-stop")) {
                        Icon(Icons.Default.Stop, stringResource(R.string.stop_run))
                    }
                    text.isNotBlank() || state.attachmentDrafts.isNotEmpty() -> FilledIconButton(
                        onClick = send,
                        modifier = Modifier.requiredSize(48.dp),
                        enabled = state.selectedAgent?.chatSupported == true && state.attachmentDrafts.none { it.status == AttachmentStatus.PREPARING },
                    ) { Icon(Icons.Default.ArrowUpward, stringResource(R.string.send_message)) }
                    else -> IconButton(onClick = startSpeechRecognition, enabled = state.selectedAgent?.chatSupported == true, modifier = Modifier.requiredSize(48.dp)) {
                        Icon(Icons.Default.Mic, stringResource(R.string.voice_input))
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentSourceButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 24.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null)
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun AttachmentDraftCard(draft: AttachmentDraft, remove: () -> Unit, retry: () -> Unit) {
    Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(Modifier.widthIn(min = 150.dp, max = 230.dp).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val bitmap = remember(draft.thumbnailPath) { draft.thumbnailPath?.let(BitmapFactory::decodeFile)?.asImageBitmap() }
            if (bitmap != null) Image(bitmap, draft.name, Modifier.size(42.dp), contentScale = ContentScale.Crop)
            else Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, Modifier.size(28.dp))
            Spacer(Modifier.width(7.dp))
            Column(Modifier.weight(1f)) {
                Text(draft.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
                Text(
                    when (draft.status) {
            AttachmentStatus.UPLOADING -> stringResource(R.string.uploading_progress, draft.progress)
            AttachmentStatus.FAILED -> draft.error ?: stringResource(R.string.upload_failed)
                        else -> LocalizedFormatting.bytes(draft.size, java.util.Locale.forLanguageTag(LocalConfiguration.current.locales[0].toLanguageTag()))
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (draft.status == AttachmentStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (draft.status == AttachmentStatus.FAILED) TextButton(
                onClick = retry, modifier = Modifier.testTag("attachment-retry-${draft.id}"),
        ) { Text(stringResource(R.string.retry)) }
            IconButton(
                onClick = remove, enabled = draft.status != AttachmentStatus.UPLOADING,
                modifier = Modifier.size(48.dp).testTag("attachment-remove-${draft.id}"),
            ) {
            Icon(Icons.Default.Close, stringResource(R.string.remove_attachment, draft.name), Modifier.size(17.dp))
            }
        }
    }
}

private fun formatBytes(size: Long): String = when {
    size >= 1024 * 1024 -> "%.1f MB".format(size / 1024.0 / 1024.0)
    size >= 1024 -> "%.1f KB".format(size / 1024.0)
    else -> "$size B"
}

@Composable
internal fun ErrorBar(
    message: String,
    diagnostic: ai.drsai.remote.data.RuntimeDiagnosticUi?,
    repair: ai.drsai.remote.runtime.errors.CapabilityRepair?,
    retryLabel: String? = null,
    retry: () -> Unit,
    onRepair: (ai.drsai.remote.runtime.errors.CapabilityRepairAction) -> Unit,
) {
    val context = LocalContext.current
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
                diagnostic?.let { Text(stringResource(R.string.error_code, it.code), style = MaterialTheme.typography.labelSmall) }
            }
            diagnostic?.let {
                TextButton(onClick = {
                    val safe = ClipboardAccessPolicy.sanitizeForWrite(it.exportText(), userInitiated = true)
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("OpenDrSai diagnostic", safe))
                    Toast.makeText(context, context.getString(R.string.diagnostic_copied), Toast.LENGTH_SHORT).show()
                }) { Text(stringResource(R.string.diagnostics)) }
            }
            if (repair != null) {
                TextButton(onClick = { onRepair(repair.action) }, modifier = Modifier.testTag("capability-repair-action")) {
                    Text(repair.actionLabel)
                }
            } else {
                TextButton(onClick = retry) { Text(retryLabel ?: stringResource(R.string.retry)) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProfileSheet(state: AppState, viewModel: AppViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val updateManager = remember { AndroidUpdateManager.get(context.applicationContext) }
    val updateState by updateManager.state.collectAsState()
    var modelMenuOpen by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = { viewModel.toggleProfile(false) }) {
        Column(Modifier.fillMaxWidth().padding(22.dp)) {
            Text(stringResource(R.string.profile), style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                UserAvatar(state.user, Modifier.size(52.dp))
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(state.user?.name.orEmpty(), fontWeight = FontWeight.Bold)
                    Text(state.user?.id.orEmpty())
                }
            }
            if (state.selectedAgent?.source == "local" && state.models.isNotEmpty()) {
                Box {
                    OutlinedButton(onClick = { modelMenuOpen = true }) {
                        Text(stringResource(R.string.switch_model, state.selectedModel?.name ?: stringResource(R.string.not_selected)))
                    }
                    DropdownMenu(expanded = modelMenuOpen, onDismissRequest = { modelMenuOpen = false }) {
                        state.models.forEach { model ->
                            DropdownMenuItem(
                                text = { Text("${model.name}${if (model.tools) " · Tools" else ""}") },
                                onClick = {
                                    viewModel.selectModel(model.id)
                                    modelMenuOpen = false
                                },
                            )
                        }
                    }
                }
            }
            state.selectedModel?.takeIf { state.selectedAgent?.source == "local" }
                ?.let { Text(stringResource(R.string.model_label, it.name), style = MaterialTheme.typography.bodySmall) }
            Text(
                stringResource(R.string.runtime_profile_summary, stringResource(if (state.selectedAgent?.source == "platform") R.string.hepai_platform else R.string.android_local)),
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(12.dp))
            ProfileVersionInfo(
                versionName = BuildConfig.VERSION_NAME,
                versionCode = BuildConfig.VERSION_CODE,
                buildType = BuildConfig.BUILD_TYPE,
            )
            if (state.setupJourney.status != ai.drsai.remote.runtime.setup.SetupStatus.COMPLETE) {
                OutlinedButton(
                    onClick = {
                        viewModel.resumeSetupJourney()
                        viewModel.toggleProfile(false)
                    },
                    modifier = Modifier.fillMaxWidth().testTag("profile-resume-setup"),
                ) { Text(stringResource(R.string.continue_agent_setup)) }
            }
            Spacer(Modifier.height(12.dp))
            FullRuntimeDiagnosticSection(
                diagnostic = state.fullRuntimeDiagnostic.copy(
                    activeRunId = state.oaepActiveRunId,
                    errorId = state.diagnostic?.requestId ?: state.diagnostic?.code,
                ),
                policy = state.runtimePolicyDiagnostic,
                onRetry = viewModel::retryFullRuntimeBinding,
                feedbackBundle = ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundleFactory.create(
                    ai.drsai.remote.runtime.reliability.DiagnosticFeedbackEnvironment(
                        BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, BuildConfig.BUILD_TYPE,
                        Build.MANUFACTURER, Build.MODEL, Build.VERSION.SDK_INT,
                    ),
                    stableCode = state.diagnostic?.code ?: state.fullRuntimeDiagnostic.health,
                    runId = state.oaepActiveRunId,
                    runStatus = state.oaepRunStatus,
                    events = state.oaepDiagnosticEvents,
                    runtime = state.fullRuntimeDiagnostic,
                ),
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.long_term_memory), fontWeight = FontWeight.Medium)
                    Text(stringResource(R.string.memory_account_notice), style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = state.memoryEnabled, onCheckedChange = viewModel::setMemoryEnabled)
            }
            if (state.memories.isNotEmpty()) {
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 160.dp)) {
                    items(state.memories, key = { "memory:${it.id}" }) { memory ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(memory.content, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            IconButton(onClick = { viewModel.deleteMemory(memory.id) }) {
                                Icon(Icons.Default.Delete, stringResource(R.string.delete_memory))
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            val updateLabel = when (val current = updateState) {
                AndroidUpdateState.Idle -> stringResource(R.string.check_and_update)
                AndroidUpdateState.Checking -> stringResource(R.string.checking_updates)
                is AndroidUpdateState.Available -> stringResource(R.string.update_found, current.update.version)
                is AndroidUpdateState.Downloading -> stringResource(R.string.cancel_download_progress, current.progress)
                is AndroidUpdateState.Verifying -> stringResource(R.string.verifying_package)
                is AndroidUpdateState.Ready -> stringResource(R.string.install_version_now, current.update.version)
                is AndroidUpdateState.PermissionRequired -> stringResource(R.string.allow_install_continue)
                is AndroidUpdateState.Installing -> stringResource(R.string.waiting_system_install)
                is AndroidUpdateState.Installed -> stringResource(R.string.updated_to_version, current.version)
                is AndroidUpdateState.Cancelled -> stringResource(R.string.check_updates_again)
                is AndroidUpdateState.Failed -> stringResource(R.string.retry_update)
            }
            val updateBusy = updateState is AndroidUpdateState.Checking ||
                updateState is AndroidUpdateState.Verifying ||
                updateState is AndroidUpdateState.Installing
            OutlinedButton(
                onClick = {
                    if (!updateBusy) {
                        scope.launch {
                            when (val current = updateState) {
                                is AndroidUpdateState.Downloading ->
                                    updateManager.cancelDownload()
                                is AndroidUpdateState.Ready ->
                                    updateManager.install(context, current)
                                is AndroidUpdateState.PermissionRequired ->
                                    updateManager.install(
                                        context,
                                        AndroidUpdateState.Ready(current.update, current.apk),
                                    )
                                else -> when (val checked = updateManager.check()) {
                                    is AndroidUpdateState.Available ->
                                        when (val downloaded = updateManager.download(checked.update)) {
                                            is AndroidUpdateState.Ready ->
                                                updateManager.install(context, downloaded)
                                            else -> Unit
                                        }
                                    else -> Unit
                                }
                            }
                        }
                    }
                },
                enabled = !updateBusy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(updateLabel) }
            when (val current = updateState) {
                is AndroidUpdateState.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                is AndroidUpdateState.Available -> Text(
                    stringResource(R.string.update_available_source, current.update.version, current.update.source.displayName()),
                    style = MaterialTheme.typography.bodySmall,
                )
                is AndroidUpdateState.Ready -> Text(
                    stringResource(R.string.package_verified_source, current.update.source.displayName()),
                    style = MaterialTheme.typography.bodySmall,
                )
                is AndroidUpdateState.PermissionRequired -> Text(
                    stringResource(R.string.allow_unknown_apps_notice),
                    style = MaterialTheme.typography.bodySmall,
                )
                else -> Unit
            }
            Spacer(Modifier.height(18.dp))
            TextButton(
                onClick = { viewModel.logout(); viewModel.toggleProfile(false) },
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) {
                Icon(Icons.AutoMirrored.Filled.Logout, null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.sign_out))
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun ProfileVersionInfo(versionName: String, versionCode: Int, buildType: String) {
    Column(Modifier.fillMaxWidth().testTag("profile-version-info")) {
        Text(stringResource(R.string.version_information), fontWeight = FontWeight.Medium)
        Text(
            "OpenDrSai $versionName ($versionCode)",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.build_channel_summary, buildType.toProfileChannelName()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun FullRuntimeDiagnosticSection(
    diagnostic: ai.drsai.remote.data.FullRuntimeDiagnosticUi,
    policy: ai.drsai.remote.data.RuntimePolicyDiagnosticUi?,
    onRetry: () -> Unit,
    feedbackBundle: ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundle =
        ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundleFactory.create(
            ai.drsai.remote.runtime.reliability.DiagnosticFeedbackEnvironment(
                BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, BuildConfig.BUILD_TYPE,
                Build.MANUFACTURER, Build.MODEL, Build.VERSION.SDK_INT,
            ),
            stableCode = diagnostic.errorId ?: diagnostic.health,
            runId = diagnostic.activeRunId,
            runStatus = diagnostic.health,
            events = emptyList(),
            runtime = diagnostic,
        ),
) {
    val context = LocalContext.current
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().testTag("full-runtime-diagnostic"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            stringResource(R.string.advanced_diagnostics),
            fontWeight = FontWeight.Medium,
        )
        Text(
            stringResource(R.string.diagnostic_route_binding_health, diagnostic.route, diagnostic.bindingState, diagnostic.health),
            style = MaterialTheme.typography.bodySmall,
        )
        TextButton(
            onClick = { expanded = !expanded },
            modifier = Modifier.testTag("toggle-full-runtime-diagnostic"),
        ) { Text(stringResource(if (expanded) R.string.hide_details else R.string.show_details)) }
        if (!expanded) return@Column
        Text(
            if (diagnostic.desktopParityComplete) "Android Full Agent Runtime · Desktop Parity"
            else "Android Agent Runtime Preview · Desktop parity incomplete",
            fontWeight = FontWeight.Medium,
        )
        Text(
            stringResource(R.string.diagnostic_build_process, diagnostic.buildEnabled, diagnostic.process),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.diagnostic_kernel, diagnostic.kernelVersion ?: stringResource(R.string.not_verified), diagnostic.kernelSha256?.take(12) ?: stringResource(R.string.no_digest)),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.diagnostic_prompt_tool, diagnostic.promptVersion ?: stringResource(R.string.not_verified), diagnostic.toolManifestVersion ?: stringResource(R.string.not_verified)),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.diagnostic_skill, diagnostic.skillManifestVersion ?: stringResource(R.string.not_verified), diagnostic.skillManifestSha256?.take(12) ?: stringResource(R.string.no_digest)),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.diagnostic_capability, diagnostic.capabilityManifestVersion ?: stringResource(R.string.not_verified), diagnostic.capabilityManifestSha256?.take(12) ?: stringResource(R.string.no_digest)),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.diagnostic_run_error, diagnostic.activeRunId ?: stringResource(R.string.none), diagnostic.errorId ?: stringResource(R.string.none)),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "starts=${diagnostic.starts} · binds=${diagnostic.bindSuccesses}/${diagnostic.bindAttempts} · fallbacks=${diagnostic.safeFallbacks}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "kotlin_fallback_available=${diagnostic.kotlinFallbackAvailable}",
            style = MaterialTheme.typography.bodySmall,
            color = if (diagnostic.kotlinFallbackAvailable) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag("kotlin-fallback-indicator"),
        )
        policy?.let {
            Text(
                listOfNotNull(
                    "Policy ${it.status}",
                    it.policyVersion,
                    it.rolloutPercent?.let { percent -> "$percent%" },
                    it.reason,
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("runtime-policy-diagnostic"),
            )
        }
        Text(stringResource(R.string.available_tools, diagnostic.availableTools.joinToString().ifBlank { stringResource(R.string.none) }), style = MaterialTheme.typography.bodySmall)
        Text(
            stringResource(R.string.permission_required_tools, diagnostic.permissionRequiredTools.joinToString().ifBlank { stringResource(R.string.none) }),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            stringResource(R.string.model_unsupported_tools, diagnostic.modelUnsupportedTools.joinToString().ifBlank { stringResource(R.string.none) }),
            style = MaterialTheme.typography.bodySmall,
        )
        Text(stringResource(R.string.available_skills, diagnostic.availableSkills.joinToString().ifBlank { stringResource(R.string.none) }), style = MaterialTheme.typography.bodySmall)
        Text(
            stringResource(R.string.permission_required_skills, diagnostic.permissionRequiredSkills.joinToString().ifBlank { stringResource(R.string.none) }),
            style = MaterialTheme.typography.bodySmall,
        )
        diagnostic.bindReason?.let {
            Text(stringResource(R.string.unavailable_reason, it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Row {
            if (diagnostic.health != "READY") {
                TextButton(onClick = onRetry) { Text(stringResource(R.string.retry_binding)) }
            }
            TextButton(onClick = {
                check(feedbackBundle.secretScanPassed) { "diagnostic_feedback_secret_scan_failed" }
                val safe = ClipboardAccessPolicy.sanitizeForWrite(feedbackBundle.text, userInitiated = true)
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("OpenDrSai diagnostic feedback", safe))
                Toast.makeText(context, context.getString(R.string.feedback_bundle_copied), Toast.LENGTH_SHORT).show()
            }, modifier = Modifier.testTag("copy-full-runtime-diagnostic")) { Text(stringResource(R.string.copy_diagnostics)) }
            TextButton(onClick = {
                check(feedbackBundle.secretScanPassed) { "diagnostic_feedback_secret_scan_failed" }
                context.startActivity(Intent.createChooser(
                    diagnosticFeedbackShareIntent(feedbackBundle), context.getString(R.string.share_feedback_bundle),
                ))
            }, modifier = Modifier.testTag("share-full-runtime-diagnostic")) { Text(stringResource(R.string.share_diagnostics)) }
        }
    }
}

private fun taskStepMarker(status: String): String = when (status) {
    "completed" -> "✓"
    "running" -> "●"
    "failed" -> "!"
    "cancelled" -> "×"
    else -> "○"
}

internal fun fullRuntimeDiagnosticShareIntent(
    diagnostic: ai.drsai.remote.data.FullRuntimeDiagnosticUi,
): Intent = diagnosticFeedbackShareIntent(
    ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundleFactory.create(
        ai.drsai.remote.runtime.reliability.DiagnosticFeedbackEnvironment(
            BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, BuildConfig.BUILD_TYPE,
            Build.MANUFACTURER, Build.MODEL, Build.VERSION.SDK_INT,
        ), diagnostic.errorId ?: diagnostic.health, diagnostic.activeRunId, diagnostic.health, emptyList(), diagnostic,
    ),
)

internal fun diagnosticFeedbackShareIntent(
    bundle: ai.drsai.remote.runtime.reliability.DiagnosticFeedbackBundle,
): Intent = Intent(Intent.ACTION_SEND).apply {
    check(bundle.secretScanPassed) { "diagnostic_feedback_secret_scan_failed" }
    type = "text/plain"
    putExtra(Intent.EXTRA_SUBJECT, "OpenDrSai Android diagnostic feedback")
    putExtra(Intent.EXTRA_TEXT, ClipboardAccessPolicy.sanitizeForWrite(bundle.text, userInitiated = true))
}

internal fun String.toProfileChannelName(): String = when (lowercase()) {
    "debug" -> "Debug"
    "acceptance" -> "Acceptance"
    "mvp" -> "MVP"
    "release" -> "Release"
    else -> ifBlank { "Unknown" }
}

@Composable
private fun AndroidUpdateSource.displayName(): String = when (this) {
    AndroidUpdateSource.CDN -> "OpenDrSai CDN"
    AndroidUpdateSource.GITHUB -> stringResource(R.string.github_fallback_source)
    AndroidUpdateSource.TEST -> stringResource(R.string.test_update_source)
}
