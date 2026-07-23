package ai.drsai.remote.ui

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.PickVisualMediaRequest
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountCircle
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
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.material3.rememberDrawerState
import ai.drsai.remote.AppViewModel
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
import ai.drsai.remote.data.SkillUiItem
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.AndroidUpdateManager
import ai.drsai.remote.data.AndroidUpdateState
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
import ai.drsai.remote.remote.ui.RemoteSessionViewModel
import ai.drsai.remote.remote.ui.WorkspaceFilesScreen
import ai.drsai.remote.remote.ui.WorkspaceFilesViewModel
import ai.drsai.remote.remote.ui.WorkspaceGitScreen
import ai.drsai.remote.remote.ui.WorkspaceGitViewModel
import java.io.File
import java.util.UUID
import kotlinx.coroutines.launch
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

private val OpenDrSaiGreen = Color(0xFF25634A)
private val OpenDrSaiLime = Color(0xFFD8F58A)
private val OpenDrSaiInk = Color(0xFF18211D)

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
    MaterialTheme(
        colorScheme = if (dark) darkColorScheme(primary = OpenDrSaiLime) else lightColorScheme(primary = OpenDrSaiGreen),
    ) {
        Surface(Modifier.fillMaxSize()) {
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
    val mainRoute = AppRoute.parse(mainRoutePath) ?: AppRoute.Chat
    LaunchedEffect(state.requestedRoutePath) {
        state.requestedRoutePath?.let { requested ->
            if (AppRoute.parse(requested) != null) mainRoutePath = requested
            viewModel.consumeRequestedRoute()
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

    val drawerContent: @Composable (Boolean) -> Unit = { modal ->
            NavigationDrawer(
                state = state,
                modal = modal,
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
                onWorkbenchSearch = viewModel::searchWorkbench,
                onLoadMoreSessions = viewModel::loadMoreWorkbenchSessions,
                onGrantLocalWorkspace = { localWorkspaceLauncher.launch(null) },
                onClearLocalWorkspace = viewModel::clearLocalWorkspace,
            )
    }
    val screenContent: @Composable (Boolean) -> Unit = { wide ->
        Scaffold { systemPadding ->
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(systemPadding)
                    .imePadding(),
            ) {
                if (mainRoute == AppRoute.Approvals) {
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
                    )
                } else if (mainRoute == AppRoute.AgentsAndSkills) {
                    AgentsAndSkillsScreen(
                        agents = state.agents,
                        skills = state.skills,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onRefresh = viewModel::refreshAgents,
                    )
                } else if (mainRoute == AppRoute.RemoteHome) {
                    val remoteViewModel: RemoteHomeViewModel = viewModel(key = "remote-home")
                    val remoteState by remoteViewModel.state.collectAsState()
                    LaunchedEffect(remoteState.computers) {
                        viewModel.projectRemoteWorkspaces(remoteState.computers.flatMap { computer ->
                            computer.workspaces.map { computer.displayName to it }
                        })
                    }
                    RemoteHomeScreen(
                        state = remoteState,
                        onBack = { mainRoutePath = AppRoute.Chat.path },
                        onAssociate = {
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
                        onQueryChange = remoteViewModel::updateQuery,
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
                        onCancelRun = sessionViewModel::cancel,
                        onApproval = sessionViewModel::decide,
                        onOpenArtifact = sessionViewModel::openArtifact,
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
                    if (state.messages.isEmpty()) {
                        Welcome(state.selectedAgent, Modifier.fillMaxSize().padding(top = 82.dp, bottom = 92.dp))
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
                            newConversationEnabled = !state.streaming,
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
                    Text("Android 本地 · Lite Runtime")
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
    val controlColor = Color.White.copy(alpha = 0.60f)
    Row(
        modifier = modifier.fillMaxWidth().height(52.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(52.dp),
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = OpenDrSaiInk,
            tonalElevation = 2.dp,
            shadowElevation = 5.dp,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            IconButton(onClick = onOpenDrawer) { Icon(Icons.Default.Menu, "展开侧栏") }
        }
        Spacer(Modifier.width(6.dp))
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = controlColor,
            contentColor = OpenDrSaiInk,
            tonalElevation = 2.dp,
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
            contentColor = OpenDrSaiInk,
            tonalElevation = 2.dp,
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
internal fun NavigationDrawer(
    state: AppState,
    modal: Boolean = true,
    onNewConversation: () -> Unit,
    onOpenConversation: (String) -> Unit,
    onOpenWorkbenchSession: (WorkbenchSessionItem) -> Unit = { if (it.local) onOpenConversation(it.sessionId) },
    onSelectAgent: (String) -> Unit,
    onRefreshAgents: () -> Unit,
    onOpenProfile: () -> Unit,
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
    onWorkbenchSearch: (String) -> Unit = {},
    onLoadMoreSessions: (String) -> Unit = {},
    onGrantLocalWorkspace: () -> Unit = {},
    onClearLocalWorkspace: () -> Unit = {},
) {
    var query by rememberSaveable { mutableStateOf("") }
    var agentsExpanded by rememberSaveable { mutableStateOf(true) }
    var collapsedWorkspaceKeys by rememberSaveable { mutableStateOf("") }
    var renameTarget by remember { mutableStateOf<WorkbenchSessionItem?>(null) }
    var renameText by remember { mutableStateOf("") }
    val normalizedQuery = query.trim()
    val visibleAgents = state.agents.filter {
        normalizedQuery.isEmpty() || it.name.contains(normalizedQuery, ignoreCase = true) ||
            it.description.contains(normalizedQuery, ignoreCase = true)
    }
    val collapsed = collapsedWorkspaceKeys.split('|').filter(String::isNotBlank).toSet()
    val visibleWorkspaces = state.workbenchWorkspaces.mapNotNull { workspace ->
        val workspaceMatches = normalizedQuery.isEmpty() || workspace.displayName.contains(normalizedQuery, ignoreCase = true)
        val sessions = if (workspaceMatches) workspace.sessions else workspace.sessions.filter {
            it.title.contains(normalizedQuery, ignoreCase = true)
        }
        workspace.copy(sessions = sessions).takeIf { workspaceMatches || sessions.isNotEmpty() }
    }
    val content: @Composable () -> Unit = {
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 18.dp)) {
            Column(Modifier.fillMaxWidth().weight(0.55f).verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BrandLogo(38.dp)
                Spacer(Modifier.width(10.dp))
                Text("OpenDrSai", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(18.dp))
            Button(onClick = onNewConversation, modifier = Modifier.fillMaxWidth(), enabled = !state.streaming) {
                Icon(Icons.Default.Add, null)
                Spacer(Modifier.width(8.dp))
                Text("新对话")
            }
            Spacer(Modifier.height(18.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(100); onWorkbenchSearch(query) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                placeholder = { Text("搜索会话和智能体") },
            )
            Spacer(Modifier.height(10.dp))
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.Computer, null) },
                label = { Text("远程工作区") },
                selected = false,
                onClick = onOpenRemoteWorkspaces,
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.FolderOpen, null) },
                label = { Text("本地工作区") },
                badge = { if (state.localWorkspaceGranted) Text("已授权") },
                selected = false,
                onClick = onGrantLocalWorkspace,
            )
            if (state.localWorkspaceGranted) {
                TextButton(onClick = onClearLocalWorkspace, modifier = Modifier.padding(start = 40.dp)) {
                    Text("移除本地工作区授权")
                }
            }
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.Schedule, null) },
                label = { Text("定时任务") },
                selected = false,
                onClick = onOpenScheduled,
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.TaskAlt, null) },
                label = { Text("结果") },
                selected = false,
                onClick = onOpenResults,
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.Extension, null) },
                label = { Text("智能体与技能") },
                selected = false,
                onClick = onOpenAgentsAndSkills,
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.PendingActions, null) },
                label = { Text("待审批") },
                badge = { if (state.pendingApprovals.isNotEmpty()) Text(state.pendingApprovals.size.toString()) },
                selected = false,
                onClick = onOpenApprovals,
            )
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.History, null) },
                label = { Text("已归档") },
                badge = { if (state.archivedSessions.isNotEmpty()) Text(state.archivedSessions.size.toString()) },
                selected = false,
                onClick = onOpenArchived,
            )
            Spacer(Modifier.height(8.dp))
            }
            LazyColumn(Modifier.weight(0.45f).testTag("drawer-list"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("智能体", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                        IconButton(
                            onClick = onRefreshAgents,
                            enabled = state.agentCatalogStatus.state != "loading" && !state.streaming,
                            modifier = Modifier.size(48.dp),
                        ) {
                            if (state.agentCatalogStatus.state == "loading") {
                                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Refresh, "刷新智能体", Modifier.size(19.dp))
                            }
                        }
                        IconButton(onClick = { agentsExpanded = !agentsExpanded }, modifier = Modifier.size(48.dp)) {
                            Icon(if (agentsExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, "展开或收起智能体")
                        }
                    }
                }
                if (agentsExpanded) items(visibleAgents, key = { "agent:${it.id}" }) { agent ->
                    NavigationDrawerItem(
                        label = {
                            Column {
                                Text(agent.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    agentStatus(agent),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        },
                        badge = { if (agent.isDefault) Text("默认", style = MaterialTheme.typography.labelSmall) },
                        selected = state.selectedAgent?.id == agent.id,
                        onClick = { if (!state.streaming) onSelectAgent(agent.id) },
                    )
                }
                item {
                    state.agentCatalogStatus.message?.let { message ->
                        Text(
                            message,
                            Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (state.agentCatalogStatus.state == "error") {
                                MaterialTheme.colorScheme.error
                            } else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    HorizontalDivider(Modifier.padding(vertical = 10.dp))
                    Text("工作区与会话", style = MaterialTheme.typography.labelLarge)
                    Spacer(Modifier.height(8.dp))
                }
                if (visibleWorkspaces.isEmpty()) {
                    item { Text("还没有会话", Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium) }
                }
                if (normalizedQuery.isNotEmpty() && state.workbenchSearchResults.isNotEmpty()) {
                    item { Text("全局搜索结果", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(8.dp)) }
                    items(state.workbenchSearchResults, key = { "search:${it.messageMatch}:${it.session.sessionId}:${it.snippet.hashCode()}" }) { result ->
                        NavigationDrawerItem(
                            label = {
                                Column {
                                    Text(result.session.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(result.snippet, style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            },
                            badge = { if (result.messageMatch) Text("消息") else Text("会话") },
                            selected = false,
                            onClick = { onOpenWorkbenchSession(result.session) },
                        )
                    }
                }
                visibleWorkspaces.forEach { workspace ->
                    item(key = "workspace:${workspace.key}") {
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                val next = if (workspace.key in collapsed) collapsed - workspace.key else collapsed + workspace.key
                                collapsedWorkspaceKeys = next.sorted().joinToString("|")
                            }.padding(horizontal = 8.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(if (workspace.local) Icons.Default.FolderOpen else Icons.Default.Computer, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(workspace.displayName, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (!workspace.local) {
                                Text(
                                    if (workspace.connectionStatus == "online") "在线" else "过期",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (workspace.connectionStatus == "online") MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.error,
                                )
                                Spacer(Modifier.width(6.dp))
                            }
                            Icon(if (workspace.key in collapsed) Icons.Default.ExpandMore else Icons.Default.ExpandLess, "展开或收起工作区")
                        }
                    }
                    if (workspace.key !in collapsed) items(workspace.sessions, key = { "session:${workspace.key}:${it.sessionId}" }) { session ->
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
                                modifier = Modifier.weight(1f),
                            )
                            if (session.local) Box {
                                IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(48.dp)) {
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
                    if (workspace.key !in collapsed && workspace.sessionHasMore) {
                        item(key = "more:${workspace.key}:${workspace.sessions.size}") {
                            TextButton(
                                onClick = { onLoadMoreSessions(workspace.key) },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("加载更多会话") }
                        }
                    }
                }
            }
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Text(if (state.selectedAgent?.source == "platform") "当前智能体" else "当前模型", style = MaterialTheme.typography.labelMedium)
            Text(
                if (state.selectedAgent?.source == "platform") state.selectedAgent.name
                else state.selectedModel?.name ?: "正在加载 HAI 模型",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(8.dp))
            NavigationDrawerItem(
                icon = { Icon(Icons.Default.AccountCircle, null) },
                label = { Text(state.user?.name ?: "个人中心", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                selected = false,
                onClick = onOpenProfile,
            )
        }
    }
    if (modal) {
        ModalDrawerSheet(Modifier.fillMaxHeight().widthIn(max = 320.dp)) { content() }
    } else {
        Surface(
            Modifier.fillMaxHeight().width(320.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp,
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
private fun WorkbenchResultsScreen(artifacts: List<WorkbenchArtifactItem>, onBack: () -> Unit) {
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
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回") }
            Spacer(Modifier.width(8.dp))
            Text("智能体与技能", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "刷新智能体") }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("智能体", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            items(agents, key = Agent::id) { agent ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(agent.name, fontWeight = FontWeight.Medium)
                        Text(agentStatus(agent), style = MaterialTheme.typography.labelMedium)
                        Text(
                            "来源：${if (agent.source == "local") "Android 内置" else "HepAI 平台"} · " +
                                "运行位置：${if (agent.source == "local") "Lite Runtime" else "远程 Runtime"} · " +
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
            item { Text("技能", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
            items(skills, key = { "${it.source}:${it.id}" }) { skill ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Text(skill.name, fontWeight = FontWeight.Medium)
                        Text("${skill.source} · v${skill.version} · ${if (skill.available) "可用" else "不可用"}", style = MaterialTheme.typography.labelMedium)
                        Text(skill.permissions, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
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
                if (message.text.contains("```")) CodeAwareText(message.text)
                else if (message.text.isNotBlank() || message.attachments.isEmpty()) Text(message.text.ifBlank { "正在思考…" })
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

@Composable
private fun CodeAwareText(text: String) {
    val parts = text.split("```")
    Column {
        parts.forEachIndexed { index, part ->
            if (index % 2 == 1) {
                Surface(color = MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(8.dp)) {
                    Text(
                        part.trim().substringAfter('\n', part.trim()),
                        Modifier.fillMaxWidth().padding(12.dp),
                        fontFamily = FontFamily.Monospace,
                    )
                }
            } else if (part.isNotBlank()) Text(part.trim())
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
    var text by rememberSaveable { mutableStateOf("") }
    var awaitingAttachmentAcceptance by rememberSaveable { mutableStateOf(false) }
    var attachmentSheetOpen by remember { mutableStateOf(false) }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    var pendingCameraName by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val send = {
        if ((text.isNotBlank() || state.attachmentDrafts.isNotEmpty()) && state.selectedAgent?.chatSupported == true && !state.streaming) {
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
            .padding(start = 12.dp, top = 10.dp, end = 12.dp)
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .heightIn(min = 60.dp),
        shape = RoundedCornerShape(28.dp),
        color = Color.White,
        contentColor = OpenDrSaiInk,
        tonalElevation = 2.dp,
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
                IconButton(onClick = { attachmentSheetOpen = true }, enabled = !state.streaming) {
                    Icon(Icons.Default.Add, "添加附件")
                }
                BasicTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f).padding(vertical = 5.dp),
                enabled = !state.streaming && state.selectedAgent?.chatSupported == true,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = OpenDrSaiInk),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }),
                decorationBox = { innerTextField ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                        if (text.isEmpty()) Text(
                            "给 ${state.selectedAgent?.name ?: "OpenDrSai"} 发消息",
                            color = OpenDrSaiInk.copy(alpha = 0.60f),
                        )
                        innerTextField()
                    }
                },
                )
                when {
                    state.streaming -> FilledIconButton(onClick = onStop) { Icon(Icons.Default.Stop, "停止") }
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
    ModalBottomSheet(onDismissRequest = { viewModel.toggleProfile(false) }) {
        Column(Modifier.fillMaxWidth().padding(22.dp)) {
            Text("个人中心", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(16.dp))
            Text(state.user?.name.orEmpty(), fontWeight = FontWeight.Bold)
            Text(state.user?.id.orEmpty())
            state.selectedModel?.takeIf { state.selectedAgent?.source == "local" }
                ?.let { Text("模型：${it.name}", style = MaterialTheme.typography.bodySmall) }
            Text(
                "Runtime：${if (state.selectedAgent?.source == "platform") "HAI 平台" else "Android 本机"}",
                style = MaterialTheme.typography.bodySmall,
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
                is AndroidUpdateState.Downloading -> "正在下载 ${current.progress}%"
                is AndroidUpdateState.Ready -> "正在打开安装器…"
                is AndroidUpdateState.Failed -> "重试更新"
            }
            OutlinedButton(
                onClick = {
                    if (updateState !is AndroidUpdateState.Checking && updateState !is AndroidUpdateState.Downloading) {
                        scope.launch {
                            when (val checked = updateManager.check()) {
                                is AndroidUpdateState.Available -> when (val downloaded = updateManager.download(checked.update)) {
                                    is AndroidUpdateState.Ready -> updateManager.install(context, downloaded)
                                    else -> Unit
                                }
                                else -> Unit
                            }
                        }
                    }
                },
                enabled = updateState !is AndroidUpdateState.Checking && updateState !is AndroidUpdateState.Downloading,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(updateLabel) }
            when (val current = updateState) {
                is AndroidUpdateState.Failed -> Text(current.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                is AndroidUpdateState.Available -> Text("可更新到 ${current.update.version}", style = MaterialTheme.typography.bodySmall)
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
