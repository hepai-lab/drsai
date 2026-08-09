package ai.drsai.remote.ui

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.speech.RecognizerIntent
import android.widget.Toast
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.rememberDrawerState
import ai.drsai.remote.AppViewModel
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.R
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.ApprovalUiItem
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

@Composable
private fun SplashScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandLogo(112.dp)
            Spacer(Modifier.height(18.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Text("你的智能 Agent")
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
            Text("登录后开始与智能 Agent 对话", style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(42.dp))
            Button(
                onClick = viewModel::login,
                enabled = !state.loading && !state.waitingForLogin,
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Login, null)
                Spacer(Modifier.width(8.dp))
                Text(if (state.waitingForLogin) "等待浏览器授权" else "使用 HepAI 继续")
            }
            if (state.waitingForLogin) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = viewModel::cancelLogin, modifier = Modifier.fillMaxWidth()) { Text("取消登录") }
                Spacer(Modifier.height(8.dp))
                Text("请在浏览器完成授权，然后返回 OpenDrSai", style = MaterialTheme.typography.bodySmall)
            }
            state.error?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(28.dp))
            Text("登录即表示同意《用户协议》和《隐私政策》", style = MaterialTheme.typography.bodySmall)
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
        uri?.let(viewModel::grantLocalWorkspace)
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
                viewModel.consumeRequestedRoute()
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
            title = { Text("交给 Desktop Runtime？") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(handoff.message)
                Text(
                    buildString {
                        append("目标：${handoff.targetName}\n执行位置：${handoff.executionLocation}")
                        handoff.transport?.let { append("\n传输：$it（Android 本地不执行）") }
                        handoff.resourceId?.let { append("\nMCP Server：$it") }
                        append("\n能力：${handoff.requiredCapabilities.joinToString(" / ")}")
                        if (handoff.transport == "stdio") append("\n确认仅创建 Handoff；远端工具调用仍需审批。")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } },
            confirmButton = { TextButton(onClick = { viewModel.decideDesktopHandoff(true) }) { Text("打开远程 Runtime") } },
            dismissButton = { TextButton(onClick = { viewModel.decideDesktopHandoff(false) }) { Text("取消") } },
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
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onDecision = viewModel::decideApproval,
                    )
                } else if (mainRoute == AppRoute.Archived) {
                    ArchivedSessionsScreen(
                        sessions = state.archivedSessions,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onRestore = { viewModel.setSessionArchived(it, false) },
                    )
                } else if (mainRoute == AppRoute.Scheduled) {
                    WorkbenchInfoScreen(
                        title = "定时任务",
                        description = "定时任务需要支持后台运行的远程 Runtime。连接工作区后，可在对应 Runtime 中创建和管理任务。",
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        actionLabel = if (remoteTargets.isEmpty()) "连接远程 Runtime" else "选择远程工作区",
                        onAction = { mainRoutePath = AppRoute.RemoteHome.path },
                    )
                } else if (mainRoute == AppRoute.Results) {
                    WorkbenchResultsScreen(
                        artifacts = state.workbenchArtifacts,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onOpen = { viewModel.openWorkbenchArtifact(it.id, it.source) },
                        onShare = { viewModel.openWorkbenchArtifact(it.id, it.source, share = true) },
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
                    val notificationPermission = rememberLauncherForActivityResult(
                        ActivityResultContracts.RequestPermission(),
                    ) { remoteViewModel.refreshNotificationReadiness() }
                    LaunchedEffect(remoteState.computers) {
                        viewModel.projectRemoteWorkspaces(remoteState.computers.flatMap { computer ->
                            computer.workspaces.map { computer.displayName to it }
                        })
                    }
                    RemoteHomeScreen(
                        state = remoteState,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onAssociate = {
                            com.google.mlkit.common.MlKit.initialize(context)
                            GmsBarcodeScanning.getClient(context).startScan()
                                .addOnSuccessListener { barcode ->
                                    barcode.rawValue?.let(remoteViewModel::associate)
                                        ?: Toast.makeText(context, "二维码内容为空", Toast.LENGTH_SHORT).show()
                                }
                                .addOnFailureListener { failure ->
                                    Toast.makeText(context, failure.message ?: "无法启动扫码", Toast.LENGTH_SHORT).show()
                                }
                        },
                        onRefresh = { remoteViewModel.refresh() },
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
                    RemoteChatScreen(
                        state = remoteChatState,
                        onBack = { mainRoutePath = AppRoute.WorkspaceSessions(route.runtimeId, route.workspaceId).path },
                        onSend = sessionViewModel::send,
                        onDraftChange = sessionViewModel::updateDraft,
                        onCancelRun = sessionViewModel::cancel,
                        onRetryRun = sessionViewModel::retry,
                        onApproval = sessionViewModel::decide,
                        onOpenArtifact = sessionViewModel::openArtifact,
                        onConfirmArtifact = sessionViewModel::confirmArtifactDownload,
                        onLoadOlderHistory = sessionViewModel::loadOlderHistory,
                        focusItemId = remoteFocusItemId,
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
                        state.error?.let { ErrorBar(it, state.diagnostic, viewModel::retry) }
                        state.runtimeStatus?.let { RuntimeBar(it) }
                        if (state.toolDowngraded) RuntimeBar("当前模型以纯对话模式运行，本地工具暂不可用")
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
}

internal fun usesPermanentWorkbenchDrawer(width: androidx.compose.ui.unit.Dp): Boolean = width >= 840.dp

internal fun shouldShowChatRightSidebar(wide: Boolean, isLandscape: Boolean): Boolean = wide && isLandscape

@Composable
private fun ChatRightSidebar(state: AppState) {
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf("诊断")
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
            Text("当前会话", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            DiagnosticRow("执行路由", diagnostic.route)
            DiagnosticRow("智能体", state.selectedAgent?.name ?: "未选择")
            DiagnosticRow("模型", state.selectedModel?.name ?: "未选择")
            DiagnosticRow("会话", state.currentConversation?.title ?: "新会话")
            DiagnosticRow("Run", state.oaepActiveRunId?.takeLast(12) ?: "无")
            DiagnosticRow("Run 状态", state.oaepRunStatus ?: if (state.streaming) "running" else "idle")
            DiagnosticRow("OAEP 序列", state.oaepSnapshotSequence.toString())
        }
        item {
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
            Text("Runtime", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            DiagnosticRow("绑定", diagnostic.bindingState)
            DiagnosticRow("健康状态", diagnostic.health)
            DiagnosticRow("进程", diagnostic.process)
            DiagnosticRow("绑定尝试", "${diagnostic.bindSuccesses}/${diagnostic.bindAttempts}")
            DiagnosticRow("安全降级", diagnostic.safeFallbacks.toString())
            DiagnosticRow("Kernel", diagnostic.kernelVersion ?: "未验证")
            DiagnosticRow("Kernel digest", diagnostic.kernelSha256?.take(12) ?: "未验证")
            DiagnosticRow("Prompt", diagnostic.promptVersion ?: "未验证")
            DiagnosticRow("Tool manifest", diagnostic.toolManifestVersion ?: "未验证")
            DiagnosticRow("Skill manifest", diagnostic.skillManifestVersion ?: "未验证")
            DiagnosticRow("Skill digest", diagnostic.skillManifestSha256?.take(12) ?: "未验证")
            DiagnosticRow("Capability", diagnostic.capabilityManifestVersion ?: "未验证")
            DiagnosticRow("Host Port", diagnostic.hostPortProtocolVersion ?: "未验证")
            DiagnosticRow("Model tools", diagnostic.modelToolSnapshotVersion ?: "未验证")
            DiagnosticRow("工具", diagnostic.availableTools.size.toString())
            DiagnosticRow("技能", diagnostic.availableSkills.size.toString())
        }
        if (state.runtimeStatus != null || state.error != null || diagnostic.bindReason != null) {
            item {
                HorizontalDivider()
                Spacer(Modifier.height(14.dp))
                Text("状态与错误", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                state.runtimeStatus?.let { DiagnosticMessage(it, false) }
                diagnostic.bindReason?.let { DiagnosticMessage(it, false) }
                state.error?.let { DiagnosticMessage(it, true) }
            }
        }
        item {
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
            Text("OAEP 原始事件", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            if (state.oaepDiagnosticEvents.isEmpty()) {
                Text("等待当前 Run 的第一个 OAEP 事件。", style = MaterialTheme.typography.bodySmall)
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
        title = { Text("选择任务运行位置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Run 创建后会固定到所选 Runtime，不会静默切换。", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = onLocal, modifier = Modifier.fillMaxWidth()) {
                    Text("Android 本地 · Full Agent Runtime")
                }
                remoteTargets.forEach { workspace ->
                    Button(onClick = { onRemote(workspace) }, modifier = Modifier.fillMaxWidth()) {
                        Text("${workspace.displayName} · 远程 Runtime", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
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
        modifier = modifier.fillMaxWidth().height(52.dp),
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
            IconButton(onClick = onOpenDrawer) { Icon(Icons.Default.Menu, "展开侧栏") }
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
                Text("OpenDrSai", fontWeight = FontWeight.SemiBold)
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
                Icon(Icons.Default.Add, "新对话")
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
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回")
            }
            Column {
                Text("搜索", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "会话、消息和智能体",
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
                        "输入关键词查找历史会话、消息内容或智能体。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                }
                if (recentSessions.isNotEmpty()) {
                    item { SearchSectionTitle("最近会话") }
                    items(recentSessions, key = { "recent:${it.runtimeId}:${it.workspaceId}:${it.sessionId}" }) { session ->
                        SearchSessionRow(session, null, null) { onOpenSession(session) }
                    }
                }
                if (matchingAgents.isNotEmpty()) {
                    item { SearchSectionTitle("智能体") }
                    items(matchingAgents, key = { "agent:${it.id}" }) { agent ->
                        SearchAgentRow(agent, state.selectedAgent?.id == agent.id) { onSelectAgent(agent.id) }
                    }
                }
            } else {
                val resultCount = state.workbenchSearchResults.size + matchingAgents.size
                item {
                    Text(
                        if (resultCount == 0) "没有匹配结果" else "找到 $resultCount 项相关内容",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                }
                if (state.workbenchSearchResults.isNotEmpty()) {
                    item { SearchSectionTitle("聊天") }
                    items(
                        state.workbenchSearchResults,
                        key = { "result:${it.messageMatch}:${it.session.runtimeId}:${it.session.workspaceId}:${it.session.sessionId}:${it.snippet.hashCode()}" },
                    ) { result ->
                        SearchSessionRow(
                            session = result.session,
                            snippet = result.snippet,
                            resultType = if (result.messageMatch) "消息" else "会话",
                        ) { onOpenSession(result.session) }
                    }
                }
                if (matchingAgents.isNotEmpty()) {
                    item { SearchSectionTitle("智能体") }
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
                            Icon(Icons.Default.Close, "清除搜索")
                        }
                    }
                },
                placeholder = { Text("搜索会话、消息和智能体") },
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
            if (selected) Text("当前", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
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
    onSetSessionUnread: (String, Boolean) -> Unit = { _, _ -> },
    onLoadMoreSessions: (String) -> Unit = {},
    onGrantLocalWorkspace: () -> Unit = {},
    onClearLocalWorkspace: () -> Unit = {},
) {
    var renameTarget by remember { mutableStateOf<WorkbenchSessionItem?>(null) }
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
                    Text("Android", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = onOpenSearch) {
                    Icon(Icons.Default.Search, "搜索")
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
                        label = "新对话",
                        selected = newConversationSelected,
                        enabled = !state.streaming && !state.recovering,
                        onClick = onNewConversation,
                    )
                }
                item(key = "scheduled") {
                    CompactDrawerItem(Icons.Default.Schedule, "已安排", onClick = onOpenScheduled)
                }
                item(key = "remote-workspaces") {
                    CompactDrawerItem(Icons.Default.Computer, "远程工作区", onClick = onOpenRemoteWorkspaces)
                }
                item(key = "agents") {
                    CompactDrawerItem(Icons.Default.SmartToy, "智能体", onClick = onOpenAgentsAndSkills)
                }

                item(key = "sessions-heading") {
                    Text(
                        "会话",
                        modifier = Modifier.fillMaxWidth().padding(start = 10.dp, top = 16.dp, bottom = 8.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (visibleSessions.isEmpty()) {
                    item { Text("还没有会话", Modifier.padding(horizontal = 10.dp, vertical = 8.dp), style = MaterialTheme.typography.bodyMedium) }
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
                                    session.runtimeStatus == "WAITING_APPROVAL" -> Text("待审批", style = MaterialTheme.typography.labelSmall)
                                    session.runtimeStatus == "RUNNING" || session.runtimeStatus == "QUEUED" -> Text("运行中", style = MaterialTheme.typography.labelSmall)
                                    session.runtimeStatus == "PAUSED" -> Text("已暂停", style = MaterialTheme.typography.labelSmall)
                                    session.unread -> Text("未读", style = MaterialTheme.typography.labelSmall)
                                    session.pinned -> Text("置顶", style = MaterialTheme.typography.labelSmall)
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
                                Icon(Icons.Default.MoreVert, "会话操作")
                            }
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(text = { Text("重命名") }, onClick = {
                                    menuOpen = false; renameTarget = session; renameText = session.title
                                })
                                DropdownMenuItem(text = { Text(if (session.pinned) "取消置顶" else "置顶") }, onClick = {
                                    menuOpen = false; onSetSessionPinned(session.sessionId, !session.pinned)
                                })
                                DropdownMenuItem(text = { Text(if (session.unread) "标为已读" else "标为未读") }, onClick = {
                                    menuOpen = false; onSetSessionUnread(session.sessionId, !session.unread)
                                })
                                DropdownMenuItem(text = { Text("归档") }, onClick = {
                                    menuOpen = false; onArchiveSession(session.sessionId)
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
                        ) { Text("加载更多会话") }
                    }
                }
                item(key = "secondary-divider") {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                }
                item(key = "archived") {
                    CompactDrawerItem(
                        Icons.Default.History,
                        "已归档",
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
                            state.user?.name ?: "个人中心",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (state.selectedAgent?.source == "platform") state.selectedAgent.name
                            else state.selectedModel?.name ?: "正在加载 HAI 模型",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
              }
              IconButton(onClick = onOpenSettings, modifier = Modifier.size(56.dp).testTag("open-settings")) {
                  Icon(Icons.Default.Settings, "设置")
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
            title = { Text("重命名会话") },
            text = { OutlinedTextField(renameText, { renameText = it.take(120) }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    if (renameText.isNotBlank()) onRenameSession(target.sessionId, renameText.trim())
                    renameTarget = null
                }) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("取消") } },
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
                "展开或收起$title",
                Modifier.size(20.dp),
            )
        }
    }
}

private fun agentStatus(agent: Agent): String = when {
    !agent.available -> "当前不可用"
    !agent.chatSupported -> "暂不支持对话"
    agent.source == "local" -> "Android 本机运行"
    agent.mode == "ddf" -> "HAI 平台运行"
    else -> "远程智能体"
}

@Composable
private fun ArchivedSessionsScreen(
    sessions: List<WorkbenchSessionItem>,
    onBack: () -> Unit,
    onRestore: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Spacer(Modifier.width(8.dp))
            Text("已归档会话", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (sessions.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("没有已归档会话") }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(sessions, key = { it.sessionId }) { session ->
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(session.title, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (session.local) TextButton(onClick = { onRestore(session.sessionId) }) { Text("恢复") }
                            else Text("在远程工作区恢复", style = MaterialTheme.typography.labelSmall)
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
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
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
private fun WorkbenchResultsScreen(
    artifacts: List<WorkbenchArtifactItem>,
    onBack: () -> Unit,
    onOpen: (WorkbenchArtifactItem) -> Unit,
    onShare: (WorkbenchArtifactItem) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Spacer(Modifier.width(8.dp))
            Text("结果", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (artifacts.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("还没有附件或工具结果", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(artifacts, key = { "${it.source}:${it.id}" }) { artifact ->
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            Text(artifact.name, fontWeight = FontWeight.Medium)
                            Text(
                                "${artifact.mimeType} · ${artifact.size} B · 会话 ${artifact.sessionId}" +
                                    (artifact.runId?.let { " · Run $it" } ?: ""),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { onOpen(artifact) }) { Text("预览") }
                                TextButton(onClick = { onShare(artifact) }) { Text("分享") }
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
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Spacer(Modifier.width(8.dp))
            Text("智能体", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "刷新智能体") }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Skill", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedButton(onClick = onImportSkill) { Text("从文件导入") }
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Streamable HTTP/SSE MCP", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    OutlinedButton(onClick = { showMcpDialog = true }) { Text("连接 MCP") }
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
                            Text(if (connector.enabled) "已授权" else "已撤销或过期", style = MaterialTheme.typography.labelMedium)
                        }
                        Text(
                            "Scope: ${connector.scopes.joinToString()} · 到期时间戳: ${connector.expiresAtEpochMs ?: "长期"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (connector.enabled) {
                            TextButton(onClick = { onRevokeMcp(connector.id) }) { Text("撤销 Connector") }
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
                            if (skill.enabled) skill.permissions else "已禁用；不会进入新任务，启用需要用户明确操作",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (skill.userManaged) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { onRollbackSkill(skill.id) }) { Text("回滚") }
                                TextButton(onClick = { onDeleteSkill(skill.id) }) { Text("删除") }
                            }
                        }
                    }
                }
            }
            item { Text("智能体", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            items(agents, key = Agent::id) { agent ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(agent.name, fontWeight = FontWeight.Medium)
                        Text(agentStatus(agent), style = MaterialTheme.typography.labelMedium)
                        Text(
                            "来源：${if (agent.source == "local") "Android 内置" else "HepAI 平台"} · " +
                                "运行位置：${if (agent.source == "local") (if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) "Full Local" else "Local Preview") else "Remote Platform"} · " +
                                if (agent.available && agent.chatSupported) "可用" else "不可用",
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
                                if (agent.source == "local") "权限：安全设备信息、经授权的 SAF 文件与本地记忆" else "权限：由平台目录声明",
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
            title = { Text("连接 HTTPS MCP") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(mcpId, { mcpId = it }, label = { Text("服务器 ID") }, singleLine = true)
                    OutlinedTextField(mcpUrl, { mcpUrl = it }, label = { Text("https://…/mcp") }, singleLine = true)
                    OutlinedTextField(
                        mcpToken, { mcpToken = it }, label = { Text("Bearer Token（可选）") }, singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("允许可能修改外部数据的工具", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        Switch(checked = mcpAllowWrite, onCheckedChange = { mcpAllowWrite = it })
                    }
                    OutlinedTextField(
                        mcpExpiryHours,
                        { mcpExpiryHours = it.filter(Char::isDigit).take(4) },
                        label = { Text("授权有效期（小时，1–2160）") },
                        singleLine = true,
                    )
                    Text("Token 仅保存在 Android 加密安全层，不会进入 Python、模型上下文或 OAEP。MCP 工具调用前需要审批。", style = MaterialTheme.typography.bodySmall)
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
                ) { Text("连接并发现工具") }
            },
            dismissButton = { TextButton(onClick = { showMcpDialog = false; mcpToken = "" }) { Text("取消") } },
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
                    Text(approval.operation, fontWeight = FontWeight.Medium)
                    Text("${approval.scope} · $count 项待审批", style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = onOpenAll) { Text("全部") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { onDecision(approval.id, ApprovalDecision.DECLINE) }) { Text("拒绝") }
                OutlinedButton(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_ONCE) }) { Text("允许一次") }
                if (approval.scope == "session") {
                    Button(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_SESSION) }) { Text("本会话允许") }
                }
            }
        }
    }
}

@Composable
internal fun ApprovalsScreen(
    approvals: List<ApprovalUiItem>,
    onBack: () -> Unit,
    onDecision: (String, ApprovalDecision) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Spacer(Modifier.width(8.dp))
            Text("待审批", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        }
        if (approvals.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("没有等待审批的操作", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(approvals, key = ApprovalUiItem::id) { approval ->
                    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                        Column(Modifier.fillMaxWidth().padding(14.dp)) {
                            Text(approval.operation, fontWeight = FontWeight.SemiBold)
                            Text(
                                "Runtime: ${approval.runtimeId} · 范围: ${approval.scope}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { onDecision(approval.id, ApprovalDecision.DECLINE) }) { Text("拒绝") }
                                OutlinedButton(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_ONCE) }) { Text("允许一次") }
                                if (approval.scope == "session") {
                                    Button(onClick = { onDecision(approval.id, ApprovalDecision.ALLOW_SESSION) }) { Text("本会话允许") }
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
            Text("你好，我是 ${agent?.name ?: "OpenDrSai"}", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(agent?.description?.takeIf(String::isNotBlank) ?: "在下方输入你想完成的事情")
        }
    }
}

private data class SettingsEntry(val id: String, val label: String, val icon: ImageVector)

private val settingsGroups = listOf(
    "常规" to listOf(
        SettingsEntry("general", "常规", Icons.Default.Settings),
        SettingsEntry("voice", "语音", Icons.Default.Mic),
    ),
    "智能体" to listOf(
        SettingsEntry("defaults", "默认配置", Icons.Default.SmartToy),
        SettingsEntry("tasks", "智能体任务", Icons.Default.Schedule),
        SettingsEntry("approvals", "审批中心", Icons.Default.TaskAlt),
        SettingsEntry("analytics", "使用分析", Icons.Default.History),
    ),
    "集成" to listOf(
        SettingsEntry("integrations", "集成概览", Icons.Default.Extension),
        SettingsEntry("remote", "远程工作区", Icons.Default.Computer),
        SettingsEntry("channels", "频道", Icons.Default.Menu),
    ),
    "其他" to listOf(
        SettingsEntry("system", "系统与路径", Icons.Default.FolderOpen),
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
    Column(modifier.testTag(if (compact) "settings-navigation-compact" else "settings-navigation-wide")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Text("设置", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)) {
            settingsGroups.forEach { (group, entries) ->
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
    val entry = settingsGroups.flatMap { it.second }.firstOrNull { it.id == selectedId }
    Column(modifier.testTag("settings-detail").verticalScroll(rememberScrollState()).padding(28.dp)) {
        Text(entry?.label ?: "设置", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        if (selectedId == "defaults") {
            Text("设置新会话默认使用的智能体和模型。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(22.dp))
            Surface(shape = RoundedCornerShape(14.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp)) {
                    SettingsValueRow("默认智能体", "会同步应用到聊天输入区。", state.selectedAgent?.name ?: "OpenDrSai") {}
                    HorizontalDivider()
                    SettingsValueRow("默认模型", "选择模型提供方和新会话使用的模型。", state.selectedModel?.name ?: "未选择", onOpenModels)
                }
            }
        } else {
            Text("此设置项将在 Android 端逐步与 Windows 版本保持一致。", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    onTestConnection: (String?, String, String, String) -> Unit,
    onClearMessage: () -> Unit,
) {
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
            discoverySummary = "发现结果：新增 ${merge.added}，保留 ${merge.retained}，服务端未返回 ${merge.missing}（未自动删除）"
            dirty = true
        }
    }
    LaunchedEffect(state.modelConfigurationMessage) {
        if (awaitingSave && state.modelConfigurationMessage == "模型提供方已保存") {
            awaitingSave = false
            editorOpen = false
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
            hasSavedKey = editingProviderId?.let { id -> state.modelProviders.firstOrNull { it.id == id }?.hasApiKey } == true,
            nameEditable = presetId == "custom" || presetId == null,
            baseUrlEditable = presets.firstOrNull { it.id == presetId }?.baseUrlEditable != false,
            selectedModelId = state.selectedModel?.id,
            onBack = { if (dirty) leaveConfirmation = true else { editorOpen = false; onClearMessage() } },
            onDiscover = { onDiscoverModels(editingProviderId, baseUrl, wireApi, apiKey) },
            onTestConnection = { onTestConnection(editingProviderId, baseUrl, wireApi, apiKey) },
            onSave = {
                awaitingSave = true
                onSaveProvider(editingProviderId, presetId, name, baseUrl, wireApi, apiKey, draftModels, expectedRevision)
            },
        )
        if (leaveConfirmation) AlertDialog(
            onDismissRequest = { leaveConfirmation = false },
            title = { Text("放弃未保存的修改？") },
            text = { Text("提供方或模型配置已发生变化，返回后这些草稿会丢失。") },
            confirmButton = { TextButton(onClick = { leaveConfirmation = false; editorOpen = false; dirty = false; onClearMessage() }) { Text("放弃修改", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { leaveConfirmation = false }) { Text("继续编辑") } },
        )
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.testTag("model-settings-back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Text("模型设置", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            IconButton(onClick = { choosingPreset = true }, modifier = Modifier.testTag("add-model-provider")) { Icon(Icons.Default.Add, "添加提供方") }
        }
        state.modelConfigurationMessage?.let { message ->
            Surface(color = if (message.contains("已保存")) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer, modifier = Modifier.testTag("model-configuration-status")) {
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
                            Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, if (expanded) "收起" else "展开")
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(provider.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "${provider.modelIds.size} 个模型 · ${provider.baseUrl}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val statusLabel = when (provider.connectionStatus) {
                                    "AVAILABLE" -> "连接正常"
                                    "FAILED" -> "连接失败"
                                    else -> "未检查连接"
                                }
                                val checkedAtLabel = provider.lastCheckedAt?.let {
                                    " · ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(it))}"
                                }.orEmpty()
                                Text(
                                    "$statusLabel$checkedAtLabel · 已启用 ${state.configuredProviderModels.count { it.providerId == provider.id && it.enabled }}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (provider.connectionStatus == "FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { editProvider(provider.id) }, modifier = Modifier.testTag("edit-model-provider-${provider.id}")) { Icon(Icons.Default.Edit, "编辑提供方") }
                            if (!provider.builtIn) IconButton(onClick = { pendingDeletionId = provider.id }, modifier = Modifier.testTag("delete-model-provider-${provider.id}")) { Icon(Icons.Default.Delete, "删除提供方") }
                        }
                    }
                    if (expanded) {
                        Spacer(Modifier.height(6.dp))
                        val providerModels = if (provider.id == "hepai") state.models.filter { it.providerId == provider.id }
                            else state.configuredProviderModels.filter { it.providerId == provider.id }
                        if (providerModels.isEmpty()) {
                            Text("还没有配置模型", Modifier.padding(horizontal = 16.dp, vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        providerModels.forEach { model ->
                            Surface(onClick = { onSelectModel(model.id) }, color = if (state.selectedModel?.id == model.id) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent, shape = RoundedCornerShape(12.dp)) {
                                Row(Modifier.fillMaxWidth().padding(start = 50.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(model.name, Modifier.weight(1f))
                                    if (!model.enabled) Text("已停用", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                                    if (state.selectedModel?.id == model.id) Text("当前", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
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
        title = { Text("选择模型提供方") },
        text = {
            LazyColumn(Modifier.heightIn(max = 480.dp)) {
                items(presets, key = { "preset:${it.id}" }) { preset ->
                    Surface(onClick = { openPreset(preset.id) }, color = Color.Transparent) {
                        Column(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
                            Text(preset.label, fontWeight = FontWeight.SemiBold)
                            Text(if (preset.id == "custom") "自定义名称、主机和协议" else preset.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider()
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = { choosingPreset = false }) { Text("取消") } },
    )
    pendingDeletionId?.let { id ->
        val provider = state.modelProviders.firstOrNull { it.id == id }
        val isDefault = state.selectedModel?.providerId == id
        AlertDialog(
            onDismissRequest = { pendingDeletionId = null },
            title = { Text("删除 ${provider?.name ?: "提供方"}？") },
            text = { Text("将删除 ${provider?.modelIds?.size ?: 0} 个模型及其安全凭据。${if (isDefault) "当前默认模型属于此提供方，删除后会自动切换到其他可用模型。" else ""}") },
            confirmButton = { TextButton(onClick = { onDeleteProvider(id); pendingDeletionId = null }) { Text("删除", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { pendingDeletionId = null }) { Text("取消") } },
        )
    }
}

@Composable
internal fun ModelProviderEditorScreen(
    providerId: String?, presetId: String?, name: String, onNameChange: (String) -> Unit,
    baseUrl: String, onBaseUrlChange: (String) -> Unit, wireApi: String, onWireApiChange: (String) -> Unit,
    apiKey: String, onApiKeyChange: (String) -> Unit, models: List<ModelInfo>, onModelsChange: (List<ModelInfo>) -> Unit,
    busy: Boolean, message: String?, hasSavedKey: Boolean, nameEditable: Boolean, baseUrlEditable: Boolean,
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
            IconButton(onClick = onBack, modifier = Modifier.testTag("model-provider-editor-back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Text(if (providerId == null) "添加提供方" else "编辑提供方", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Button(onClick = ::requestSave, enabled = !busy, modifier = Modifier.testTag("model-provider-save")) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("保存")
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        message?.let { value ->
            Surface(color = if (value.contains("失败") || value.contains("不能为空") || value.contains("conflict") || value.contains("无效")) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer) {
                Text(value, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp))
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("model-provider-editor-list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                OutlinedTextField(name, onNameChange, Modifier.fillMaxWidth(), label = { Text("提供方名称") }, enabled = nameEditable, singleLine = true)
            }
            item {
                OutlinedTextField(
                    apiKey, onApiKeyChange, Modifier.fillMaxWidth(), label = { Text("API 密钥") },
                    placeholder = { if (!hasSavedKey) Text("请输入 API Key") },
                    supportingText = { if (hasSavedKey) Text("已安全保存；留空表示不修改") },
                    visualTransformation = if (apiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(), singleLine = true,
                    trailingIcon = { IconButton(onClick = { apiKeyVisible = !apiKeyVisible }) { Icon(if (apiKeyVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility, if (apiKeyVisible) "隐藏密钥" else "显示密钥") } },
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onTestConnection, enabled = !busy && baseUrl.isNotBlank()) { Text("检查连接") }
                }
            }
            item {
                OutlinedTextField(baseUrl, onBaseUrlChange, Modifier.fillMaxWidth(), label = { Text("API 主机") }, enabled = baseUrlEditable, placeholder = { Text("https://api.example.com/v1") }, singleLine = true)
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
                    Text("模型（启用 ${models.count(ModelInfo::enabled)} / 共 ${models.size}）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { onModelsChange(models + ModelInfo("", "", upstreamId = "")) }) { Icon(Icons.Default.Add, null); Text("新建") }
                        TextButton(onClick = onDiscover, enabled = !busy && baseUrl.isNotBlank()) { Icon(Icons.Default.Refresh, null); Text("获取") }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { onModelsChange(models.map { it.copy(enabled = true) }) }, enabled = models.any { !it.enabled }) { Text("全部启用") }
                        TextButton(onClick = { onModelsChange(models.map { it.copy(enabled = false) }) }, enabled = models.any(ModelInfo::enabled)) { Text("全部停用") }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { selectionMode = !selectionMode; selectedModelKeys = emptySet() }, modifier = Modifier.testTag("toggle-model-selection")) { Text(if (selectionMode) "退出多选" else "多选") }
                        TextButton(onClick = { clearConfirmation = true }, enabled = models.isNotEmpty(), modifier = Modifier.testTag("clear-all-models")) { Text("清空", color = MaterialTheme.colorScheme.error) }
                    }
                        if (selectionMode) TextButton(
                            onClick = {
                                undoModels = models
                                onModelsChange(models.filterIndexed { index, model -> modelKey(index, model) !in selectedModelKeys })
                                selectedModelKeys = emptySet()
                            },
                            enabled = selectedModelKeys.isNotEmpty(),
                            modifier = Modifier.testTag("delete-selected-models"),
                        ) { Text("删除已选(${selectedModelKeys.size})", color = MaterialTheme.colorScheme.error) }
                }
            }
            item {
                OutlinedTextField(modelQuery, { modelQuery = it }, Modifier.fillMaxWidth().testTag("model-search"), label = { Text("搜索模型") }, singleLine = true, leadingIcon = { Icon(Icons.Default.Search, null) })
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    listOf("all" to "全部", "enabled" to "已启用", "disabled" to "已停用").forEach { (id, label) ->
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
                            Text("启用", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            Switch(model.enabled, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(enabled = value) }) })
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(model.upstreamId, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(upstreamId = value, name = if (model.name == model.upstreamId) value else model.name) }) }, Modifier.weight(1f), label = { Text("模型 ID") }, singleLine = true)
                            IconButton(onClick = { onModelsChange(models.filterIndexed { i, _ -> i != index }) }) { Icon(Icons.Default.Delete, "删除模型") }
                        }
                        OutlinedTextField(model.name, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(name = value) }) }, Modifier.fillMaxWidth(), label = { Text("显示名称") }, singleLine = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("视觉"); Switch(model.vision, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(vision = value) }) })
                            Text("工具"); Switch(model.tools, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(tools = value) }) })
                            Text("推理"); Switch(model.reasoning, { value -> onModelsChange(models.toMutableList().also { it[index] = model.copy(reasoning = value) }) })
                        }
                        Text(
                            when (model.source) { "PRESET" -> "来源：预设"; "DISCOVERED" -> "来源：服务端发现"; else -> "来源：手动" },
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
                    Text("已从草稿删除所选模型", Modifier.weight(1f), color = MaterialTheme.colorScheme.inverseOnSurface)
                    TextButton(onClick = { onModelsChange(previous); undoModels = null }) { Text("撤销") }
                }
            }
        }
    }
    if (clearConfirmation) AlertDialog(
        modifier = Modifier.testTag("clear-models-confirmation"),
        onDismissRequest = { clearConfirmation = false },
        title = { Text("清空模型列表？") },
        text = { Text("将从当前草稿一次性移除 ${models.size} 个模型。只有点击保存后才会真正写入。") },
        confirmButton = { TextButton(onClick = { onModelsChange(emptyList()); clearConfirmation = false }) { Text("清空", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { clearConfirmation = false }) { Text("取消") } },
    )
    if (saveImpactConfirmation) AlertDialog(
        onDismissRequest = { saveImpactConfirmation = false },
        title = { Text("当前默认模型将被停用") },
        text = { Text("保存后，默认模型会自动切换到其他已启用模型。现有会话仍保留原模型引用。") },
        confirmButton = { TextButton(onClick = { saveImpactConfirmation = false; onSave() }) { Text("继续保存") } },
        dismissButton = { TextButton(onClick = { saveImpactConfirmation = false }) { Text("取消") } },
    )
}

@Composable
private fun OaepTimeline(
    entries: List<OaepTimelineEntry>,
    snapshotSequence: Long,
    composerExpanded: Boolean,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    val imeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
    val lastText = entries.lastOrNull().let { entry ->
        (entry as? OaepTimelineEntry.AssistantTurn)?.results?.lastOrNull()?.text
    }
    LaunchedEffect(entries.size, lastText, snapshotSequence, imeBottom) {
        if (entries.isNotEmpty()) {
            if (imeBottom > 0) listState.scrollToItem(entries.lastIndex)
            else listState.animateScrollToItem(entries.lastIndex)
        }
    }
    LazyColumn(
        modifier = modifier.fillMaxWidth(), state = listState,
        contentPadding = PaddingValues(start = 16.dp, top = 94.dp, end = 16.dp, bottom = if (composerExpanded) 190.dp else 104.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items(entries, key = OaepTimelineEntry::stableId) { entry ->
            when (entry) {
                is OaepTimelineEntry.UserMessage -> OaepUserMessage(entry)
                is OaepTimelineEntry.AssistantTurn -> OaepAssistantTurn(entry)
            }
        }
    }
}

@Composable
private fun OaepUserMessage(message: OaepTimelineEntry.UserMessage) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Text("你", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
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
internal fun OaepAssistantTurn(turn: OaepTimelineEntry.AssistantTurn) {
    val active = turn.status in setOf("queued", "running", "waiting")
    var processOpen by rememberSaveable(turn.stableId) { mutableStateOf(active) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BrandLogo(22.dp)
            Spacer(Modifier.width(8.dp))
            Text("OpenDrSai", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(turnStatusLabel(turn.status), style = MaterialTheme.typography.labelSmall, color = if (turn.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            if (active) {
                Spacer(Modifier.width(8.dp))
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
            }
        }
        if (turn.process.isNotEmpty()) {
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Column {
                    Row(
                        Modifier.fillMaxWidth().clickable { processOpen = !processOpen }.padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(if (active) "正在执行" else "执行过程", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                        Text("${turn.process.size} 项", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Icon(if (processOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore, if (processOpen) "收起" else "展开")
                    }
                    if (processOpen) {
                        HorizontalDivider()
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            turn.process.forEach { OaepProcessRow(it) }
                        }
                    }
                }
            }
        }
        turn.interactions.forEach { interaction ->
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.tertiaryContainer, border = BorderStroke(1.dp, MaterialTheme.colorScheme.tertiary)) {
                Column(Modifier.padding(14.dp)) {
                    Text("需要你的操作 · ${interaction.title}", fontWeight = FontWeight.Bold)
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
                        Text(result.title ?: "产物", fontWeight = FontWeight.Bold)
                        if (result.text.isNotBlank()) { Spacer(Modifier.height(6.dp)); RemoteMarkdownContent(result.text) }
                        OaepSourceLinks(result.sources)
                    }
                }
            }
        }
        if (turn.results.isEmpty() && active && turn.process.isEmpty()) {
            Text("正在思考…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun OaepProcessRow(item: OaepProcessItem) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        if (item.status in setOf("pending", "running", "waiting")) CircularProgressIndicator(Modifier.padding(top = 3.dp).size(14.dp), strokeWidth = 2.dp)
        else Icon(Icons.Default.TaskAlt, null, Modifier.padding(top = 1.dp).size(18.dp), tint = if (item.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            item.detail?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
            item.executionLocation?.takeIf(String::isNotBlank)?.let {
                Text("执行位置：$it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            if (item.text.isNotBlank() && item.text != item.status) {
                Spacer(Modifier.height(4.dp))
                Text(item.text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (item.kind == "reasoning") 8 else 4, overflow = TextOverflow.Ellipsis)
            }
            OaepSourceLinks(item.sources)
        }
    }
}

@Composable
private fun OaepSourceLinks(sources: List<OaepSourceLink>) {
    if (sources.isEmpty()) return
    val context = LocalContext.current
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("来源", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        sources.forEach { source ->
            Text(
                source.label,
                modifier = Modifier.clickable {
                    runCatching { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(source.url)) }
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun turnStatusLabel(status: String): String = when (status) {
    "queued" -> "等待中"
    "running" -> "执行中"
    "waiting" -> "等待操作"
    "completed" -> "已完成"
    "failed" -> "执行失败"
    "cancelled" -> "已取消"
    else -> status
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
        Text(if (isUser) "你" else assistantName, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
        val content: @Composable () -> Unit = {
            Column(Modifier.padding(if (isUser) 14.dp else 4.dp)) {
                if (message.attachments.isNotEmpty()) {
                    MessageAttachments(message.attachments) { attachmentId -> retryAttachment(message.id, attachmentId) }
                    if (message.text.isNotBlank()) Spacer(Modifier.height(8.dp))
                }
                if (message.text.isNotBlank()) {
                    RemoteMarkdownContent(message.text)
                } else if (message.attachments.isEmpty()) {
                    Text("正在思考…")
                }
                if (!isUser && message.text.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    IconButton(
                        onClick = {
                            val safeText = ClipboardAccessPolicy.sanitizeForWrite(message.text, userInitiated = true)
                            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                                .setPrimaryClip(ClipData.newPlainText("OpenDrSai", safeText))
                            Toast.makeText(context, "已复制（敏感信息已隐藏）", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.size(48.dp),
                    ) { Icon(Icons.Default.ContentCopy, "复制", Modifier.size(16.dp)) }
                }
                if (message.status != "complete" && message.status != "streaming") {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        when (message.status) {
                            "paused" -> "已暂停"
                            "stopped" -> "已停止"
                            "failed" -> "生成失败"
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
            }.onFailure { Toast.makeText(context, "保存文件失败", Toast.LENGTH_SHORT).show() }
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
                        .onFailure { Toast.makeText(context, "没有可打开此文件的应用", Toast.LENGTH_SHORT).show() }
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
                        if (attachment.status == "download_failed") "下载失败" else formatBytes(attachment.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (attachment.status == "download_failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (attachment.status == "download_failed") {
                    TextButton(onClick = { retry(attachment.id) }) { Text("重试") }
                } else if (localFile != null) {
                    IconButton(onClick = {
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", localFile)
                        val intent = Intent(Intent.ACTION_SEND).setType(attachment.mimeType)
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            .apply { clipData = ClipData.newRawUri(attachment.name, uri) }
                        context.startActivity(Intent.createChooser(intent, "分享 ${attachment.name}"))
                    }) { Icon(Icons.Default.Share, "分享附件") }
                    IconButton(onClick = {
                        pendingSave = localFile
                        saveLauncher.launch(attachment.name)
                    }) { Icon(Icons.Default.Download, "保存附件") }
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
            putExtra(RecognizerIntent.EXTRA_PROMPT, "请说出要发送给 OpenDrSai 的内容")
        }
        runCatching { speechLauncher.launch(intent) }
            .onFailure { Toast.makeText(context, "当前设备没有可用的语音识别服务", Toast.LENGTH_SHORT).show() }
        Unit
    }

    if (attachmentSheetOpen) {
        ModalBottomSheet(onDismissRequest = { attachmentSheetOpen = false }) {
            AttachmentSourceButton(Icons.Default.CameraAlt, "拍照") {
                attachmentSheetOpen = false
                val directory = File(context.cacheDir, "attachments/camera").apply { mkdirs() }
                val file = File(directory, "camera-${UUID.randomUUID()}.jpg")
                pendingCameraName = file.name
                pendingCameraUri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                cameraLauncher.launch(pendingCameraUri!!)
            }
            AttachmentSourceButton(Icons.Default.Image, "从相册选择") {
                attachmentSheetOpen = false
                photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            AttachmentSourceButton(Icons.Default.AttachFile, "选择文件") {
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
                IconButton(onClick = { attachmentSheetOpen = true }, enabled = !busy) {
                    Icon(Icons.Default.Add, "添加附件")
                }
                BasicTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f).padding(vertical = 5.dp).testTag("runtime-composer-input"),
                enabled = !busy && state.selectedAgent?.chatSupported == true,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                decorationBox = { innerTextField ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                        if (text.isEmpty()) Text(
                            "给 ${state.selectedAgent?.name ?: "OpenDrSai"} 发消息",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        innerTextField()
                    }
                },
                )
                when {
                    busy -> FilledIconButton(onClick = onStop, modifier = Modifier.testTag("runtime-stop")) {
                        Icon(Icons.Default.Stop, "停止")
                    }
                    text.isNotBlank() || state.attachmentDrafts.isNotEmpty() -> FilledIconButton(
                        onClick = send,
                        enabled = state.selectedAgent?.chatSupported == true && state.attachmentDrafts.none { it.status == AttachmentStatus.PREPARING },
                    ) { Icon(Icons.Default.ArrowUpward, "发送") }
                    else -> IconButton(onClick = startSpeechRecognition, enabled = state.selectedAgent?.chatSupported == true) {
                        Icon(Icons.Default.Mic, "语音输入")
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
                        AttachmentStatus.UPLOADING -> "上传中 ${draft.progress}%"
                        AttachmentStatus.FAILED -> draft.error ?: "上传失败"
                        else -> formatBytes(draft.size)
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (draft.status == AttachmentStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (draft.status == AttachmentStatus.FAILED) TextButton(onClick = retry) { Text("重试") }
            else IconButton(onClick = remove, enabled = draft.status != AttachmentStatus.UPLOADING, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Default.Close, "移除附件", Modifier.size(17.dp))
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
private fun ErrorBar(message: String, diagnostic: ai.drsai.remote.data.RuntimeDiagnosticUi?, retry: () -> Unit) {
    val context = LocalContext.current
    Surface(color = MaterialTheme.colorScheme.errorContainer) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(message, color = MaterialTheme.colorScheme.onErrorContainer)
                diagnostic?.let { Text("错误码：${it.code}", style = MaterialTheme.typography.labelSmall) }
            }
            diagnostic?.let {
                TextButton(onClick = {
                    val safe = ClipboardAccessPolicy.sanitizeForWrite(it.exportText(), userInitiated = true)
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("OpenDrSai diagnostic", safe))
                    Toast.makeText(context, "脱敏诊断已复制", Toast.LENGTH_SHORT).show()
                }) { Text("诊断") }
            }
            TextButton(onClick = retry) { Text("重试") }
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
            Text("个人中心", style = MaterialTheme.typography.headlineSmall)
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
                        Text("切换模型：${state.selectedModel?.name ?: "未选择"}")
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
                ?.let { Text("模型：${it.name}", style = MaterialTheme.typography.bodySmall) }
            Text(
                "Runtime：${if (state.selectedAgent?.source == "platform") "HAI 平台" else "Android 本机"}",
                style = MaterialTheme.typography.bodySmall,
            )
            Spacer(Modifier.height(12.dp))
            ProfileVersionInfo(
                versionName = BuildConfig.VERSION_NAME,
                versionCode = BuildConfig.VERSION_CODE,
                buildType = BuildConfig.BUILD_TYPE,
            )
            Spacer(Modifier.height(12.dp))
            FullRuntimeDiagnosticSection(
                diagnostic = state.fullRuntimeDiagnostic,
                policy = state.runtimePolicyDiagnostic,
                onRetry = viewModel::retryFullRuntimeBinding,
            )
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("长期记忆", fontWeight = FontWeight.Medium)
                    Text("按当前 HAI 账号隔离，可随时关闭或删除", style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = state.memoryEnabled, onCheckedChange = viewModel::setMemoryEnabled)
            }
            if (state.memories.isNotEmpty()) {
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 160.dp)) {
                    items(state.memories, key = { "memory:${it.id}" }) { memory ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(memory.content, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            IconButton(onClick = { viewModel.deleteMemory(memory.id) }) {
                                Icon(Icons.Default.Delete, "删除记忆")
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            val updateLabel = when (val current = updateState) {
                AndroidUpdateState.Idle -> "检查并更新"
                AndroidUpdateState.Checking -> "正在检查…"
                is AndroidUpdateState.Available -> "发现 ${current.update.version}，下载并安装"
                is AndroidUpdateState.Downloading -> "取消下载 ${current.progress}%"
                is AndroidUpdateState.Verifying -> "正在校验安装包…"
                is AndroidUpdateState.Ready -> "立即安装 ${current.update.version}"
                is AndroidUpdateState.PermissionRequired -> "允许安装后继续"
                is AndroidUpdateState.Installing -> "正在等待系统安装…"
                is AndroidUpdateState.Installed -> "已更新到 ${current.version}"
                is AndroidUpdateState.Cancelled -> "重新检查更新"
                is AndroidUpdateState.Failed -> "重试更新"
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
                    "可更新到 ${current.update.version} · ${current.update.source.displayName()}",
                    style = MaterialTheme.typography.bodySmall,
                )
                is AndroidUpdateState.Ready -> Text(
                    "安装包已通过完整性与签名校验 · ${current.update.source.displayName()}",
                    style = MaterialTheme.typography.bodySmall,
                )
                is AndroidUpdateState.PermissionRequired -> Text(
                    "请在系统设置中允许 OpenDrSai 安装未知应用，返回后将自动继续",
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
                Text("退出登录")
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
fun ProfileVersionInfo(versionName: String, versionCode: Int, buildType: String) {
    Column(Modifier.fillMaxWidth().testTag("profile-version-info")) {
        Text("版本信息", fontWeight = FontWeight.Medium)
        Text(
            "OpenDrSai $versionName ($versionCode)",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "构建渠道：${buildType.toProfileChannelName()} · Android Agent Runtime · OAEP 1.0",
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
) {
    val context = LocalContext.current
    Column(
        Modifier.fillMaxWidth().testTag("full-runtime-diagnostic"),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            if (diagnostic.desktopParityComplete) "Android Full Agent Runtime · Desktop Parity"
            else "Android Agent Runtime Preview · Desktop parity incomplete",
            fontWeight = FontWeight.Medium,
        )
        Text(
            "路由 ${diagnostic.route} · 绑定 ${diagnostic.bindingState} · 健康 ${diagnostic.health}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "Build enabled=${diagnostic.buildEnabled} · 进程 ${diagnostic.process}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "Kernel ${diagnostic.kernelVersion ?: "未验证"} · ${diagnostic.kernelSha256?.take(12) ?: "无 digest"}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "Prompt ${diagnostic.promptVersion ?: "未验证"} · Tool ${diagnostic.toolManifestVersion ?: "未验证"}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "Skill ${diagnostic.skillManifestVersion ?: "未验证"} · ${diagnostic.skillManifestSha256?.take(12) ?: "无 digest"}",
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
        Text("可用工具：${diagnostic.availableTools.joinToString().ifBlank { "无" }}", style = MaterialTheme.typography.bodySmall)
        Text(
            "缺权限工具：${diagnostic.permissionRequiredTools.joinToString().ifBlank { "无" }}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            "模型不支持工具：${diagnostic.modelUnsupportedTools.joinToString().ifBlank { "无" }}",
            style = MaterialTheme.typography.bodySmall,
        )
        Text("可用 Skill：${diagnostic.availableSkills.joinToString().ifBlank { "无" }}", style = MaterialTheme.typography.bodySmall)
        Text(
            "缺权限 Skill：${diagnostic.permissionRequiredSkills.joinToString().ifBlank { "无" }}",
            style = MaterialTheme.typography.bodySmall,
        )
        diagnostic.bindReason?.let {
            Text("不可用原因：$it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Row {
            if (diagnostic.health != "READY") {
                TextButton(onClick = onRetry) { Text("重试绑定") }
            }
            TextButton(onClick = {
                val safe = ClipboardAccessPolicy.sanitizeForWrite(diagnostic.exportText(), userInitiated = true)
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("OpenDrSai Full Runtime diagnostic", safe))
                Toast.makeText(context, "Full Runtime 脱敏诊断已复制", Toast.LENGTH_SHORT).show()
            }) { Text("导出诊断") }
        }
    }
}

internal fun String.toProfileChannelName(): String = when (lowercase()) {
    "debug" -> "Debug"
    "acceptance" -> "Acceptance"
    "mvp" -> "MVP"
    "release" -> "Release"
    else -> ifBlank { "Unknown" }
}

private fun AndroidUpdateSource.displayName(): String = when (this) {
    AndroidUpdateSource.CDN -> "OpenDrSai CDN"
    AndroidUpdateSource.GITHUB -> "GitHub 备用源"
    AndroidUpdateSource.TEST -> "测试更新源"
}
