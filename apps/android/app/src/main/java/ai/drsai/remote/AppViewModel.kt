package ai.drsai.remote

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import androidx.work.WorkManager
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.AssociationState
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.AgentRepository
import ai.drsai.remote.data.ApprovalUiItem
import ai.drsai.remote.data.AttachmentDraft
import ai.drsai.remote.data.AttachmentProcessor
import ai.drsai.remote.data.AttachmentRepository
import ai.drsai.remote.data.AttachmentStatus
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.LocalAgentRuntime
import ai.drsai.remote.data.MemorySettingsStore
import ai.drsai.remote.data.MemoryUiItem
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.workbench.data.WorkbenchProjectionRepository
import ai.drsai.remote.workbench.data.UnifiedWorkbenchRepository
import ai.drsai.remote.workbench.data.SessionMutationResult
import ai.drsai.remote.data.WorkbenchSessionItem
import ai.drsai.remote.data.WorkbenchWorkspaceItem
import ai.drsai.remote.data.WorkbenchSearchItem
import ai.drsai.remote.data.WorkbenchArtifactItem
import ai.drsai.remote.data.SkillUiItem
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.MAX_ATTACHMENT_TOTAL_BYTES
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.OidcLoginSession
import ai.drsai.remote.data.OidcTransactionStore
import ai.drsai.remote.data.OIDC_LEGACY_CLIENT_ID
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeDiagnosticUi
import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.data.PlatformAgentClient
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.sanitizeLegacyAssistantText
import ai.drsai.remote.data.localAgentFor
import ai.drsai.remote.data.selectLocalModelForAttachments
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteSubscriptionRegistry
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.AssociationDeepLinkDecision
import ai.drsai.remote.remote.data.AssociationDeepLinkGate
import ai.drsai.remote.remote.navigation.WorkbenchDeepLinkParser
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.coordinator.ChatExecutionRouter
import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import ai.drsai.remote.runtime.coordinator.JournaledChatExecutionCoordinator
import ai.drsai.remote.runtime.security.ApprovalBinding
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.security.ApprovalRepository
import ai.drsai.remote.runtime.security.CreateApprovalCommand
import ai.drsai.remote.runtime.security.RoomToolApprovalGateway
import ai.drsai.remote.runtime.device.SafeDeviceInfoProvider
import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.SafWorkspaceStore
import ai.drsai.remote.runtime.device.registerAndroidDeviceTools
import ai.drsai.remote.runtime.device.LocalRunNotificationController
import ai.drsai.remote.runtime.reliability.RunRecoveryScheduler
import ai.drsai.remote.runtime.reliability.ResourceRecord
import ai.drsai.remote.runtime.reliability.ResourceRetentionPolicy
import ai.drsai.remote.runtime.reliability.RuntimeFailureCatalog
import ai.drsai.remote.runtime.reliability.DiagnosticBundleFactory
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.runtime.tools.RoomToolOutputArtifactSink
import ai.drsai.remote.runtime.tools.RoomToolAuditSink
import ai.drsai.remote.runtime.tools.SkillCatalog
import ai.drsai.remote.runtime.tools.SkillDefinition
import ai.drsai.remote.runtime.tools.SkillSource
import ai.drsai.remote.workbench.data.WorkbenchApprovalEntity
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.UUID
import java.io.File
import java.io.IOException

private const val WORKBENCH_SESSION_PAGE_SIZE = 40
private const val WORKBENCH_SESSION_MAX_VISIBLE = 1_000

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val tokenStore by lazy { SecureTokenStore(app) }
    private val oidcTransactions by lazy { OidcTransactionStore(app) }
    private val database by lazy {
        Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
            .build()
    }
    private val oidcClient by lazy { OidcClient(refreshClientId = { tokenStore.oidcClientId }) }
    private val modelClient by lazy {
        HaiModelClient(tokenStore, oidcClient, availableToolNames = {
            buildSet {
                addAll(setOf("get_current_time", "get_device_info", "save_memory", "search_memory"))
                val subject = tokenStore.userId
                if (subject != null && safWorkspaceStore.uri(subject) != null) {
                    addAll(setOf("workspace.list", "workspace.read", "workspace.search", "workspace.write"))
                }
            }
        })
    }
    private val tokenCoordinator by lazy { AccessTokenCoordinator(tokenStore, oidcClient) }
    private val relayDeviceProof by lazy { androidRelayDeviceProof(app) }
    private val relayDiscovery by lazy {
        HttpRelayDiscoveryService(
            BuildConfig.RELAY_BASE_URL,
            tokenCoordinator::current,
            tokenCoordinator::refreshAfter,
            deviceProof = relayDeviceProof,
        )
    }
    private val associationIssuer by lazy {
        java.net.URI(BuildConfig.RELAY_BASE_URL).let { "${it.scheme}://${it.host}" }
    }
    private val associationGate by lazy { AssociationDeepLinkGate(associationIssuer) }
    private val platformClient by lazy { PlatformAgentClient(tokenCoordinator) }
    private val agentRepository by lazy { AgentRepository(platformClient, database.dao()) }
    private val platformRuntime by lazy { PlatformAgentRuntime(tokenCoordinator, database.dao()) }
    private val attachmentProcessor by lazy { AttachmentProcessor(app) }
    private val attachmentRepository by lazy { AttachmentRepository(tokenCoordinator) }
    private val safWorkspaceStore by lazy { SafWorkspaceStore(app) }
    private val memorySettings by lazy { MemorySettingsStore(app) }
    private val safWorkspaceGateway by lazy { SafWorkspaceGateway(app, safWorkspaceStore) }
    private val runNotifications by lazy { LocalRunNotificationController(app) }
    private val runRecoveryScheduler by lazy { RunRecoveryScheduler(WorkManager.getInstance(app)) }
    private val runtime by lazy {
        val registry = defaultLocalToolRegistry(
            database.dao(),
            RoomToolOutputArtifactSink(database.dao()),
            RoomToolAuditSink(database.workbenchDao()),
        ).also {
            registerAndroidDeviceTools(it, SafeDeviceInfoProvider(app), safWorkspaceGateway)
        }
        val tools = ai.drsai.remote.data.LocalToolRegistry(
            database.dao(),
            registry,
            capabilities = { subject ->
                buildSet {
                    add(ai.drsai.remote.workbench.model.RuntimeCapability.CHAT)
                    add(ai.drsai.remote.workbench.model.RuntimeCapability.LOCAL_MEMORY)
                    add(ai.drsai.remote.workbench.model.RuntimeCapability.SAFE_DEVICE_INFO)
                    if (safWorkspaceStore.uri(subject) != null) {
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_READ)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_WRITE)
                    }
                }
            },
            approvals = RoomToolApprovalGateway(database, approvalRepository),
        )
        LocalAgentRuntime(
            modelClient, database.dao(), tools, attachmentRepository,
            projectInstructions = { subject -> safWorkspaceGateway.projectInstructions(subject) },
            memoryEnabled = memorySettings::enabled,
        )
    }
    private val workbenchProjection by lazy { WorkbenchProjectionRepository(database.workbenchDao()) }
    private val unifiedWorkbench by lazy { UnifiedWorkbenchRepository(database) }
    private val runtimeV2Recorder by lazy { RuntimeV2EventRecorder(RoomRunJournal(database)) }
    private val chatExecution by lazy { ChatExecutionRouter(runtime, platformRuntime) }
    private val journaledChatExecution by lazy { JournaledChatExecutionCoordinator(chatExecution, runtimeV2Recorder) }
    private val skillCatalog = SkillCatalog()
    private val approvalRepository by lazy { ApprovalRepository(database) }
    private val mutableState = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutableState.asStateFlow()

    private var loginJob: Job? = null
    private var pendingAssociationCode: String? = null
    private var associationJob: Job? = null
    private var oidcSession: OidcLoginSession? = null
    private var runJob: Job? = null
    private var approvalJob: Job? = null
    private var workbenchSearchJob: Job? = null
    private var workbenchSearchGeneration: Long = 0
    private var activeRunId: String? = null
    private var activeRunAuthority: RuntimeAuthority = RuntimeAuthority.LOCAL_DEVICE
    private var streamText = ""
    private var recoverableRun: RunCheckpoint? = null
    private var pendingApprovalEntities: Map<String, WorkbenchApprovalEntity> = emptyMap()
    private val databaseFailureHandler = CoroutineExceptionHandler { _, error ->
        val diagnostic = ai.drsai.remote.runtime.security.SensitiveDataRedactor.redact(
            error.message ?: error::class.java.simpleName,
        ).take(400)
        update {
            it.copy(
                loading = false,
                streaming = false,
                runtimeStatus = null,
                error = "本地数据升级失败，OpenDrSai 未删除或重建原数据库。请保留当前安装并导出诊断，或安装兼容版本。[$diagnostic]",
            )
        }
    }

    init {
        viewModelScope.launch(Dispatchers.IO) { attachmentProcessor.cleanupOrphans() }
        bootstrap()
    }

    private fun update(transform: (AppState) -> AppState) {
        mutableState.update { previous ->
            val next = transform(previous)
            if (next.error != previous.error && next.diagnostic == previous.diagnostic) {
                next.copy(diagnostic = null)
            } else next
        }
    }

    fun bootstrap() = viewModelScope.launch(Dispatchers.IO) {
        update { it.copy(destination = AppDestination.Splash, error = null) }
        val user = tokenStore.user()
        if (tokenStore.accessToken.isNullOrBlank() || user == null) {
            update { it.copy(destination = AppDestination.Login) }
            return@launch
        }
        // Tokens created by versions before native redirect support always used the desktop client.
        if (tokenStore.oidcClientId.isNullOrBlank()) tokenStore.oidcClientId = OIDC_LEGACY_CLIENT_ID
        loadWorkspace(user)
    }

    fun login() {
        if (loginJob?.isActive == true) return
        loginJob = viewModelScope.launch {
            update { it.copy(loading = true, waitingForLogin = false, loginUrl = null, error = null) }
            runCatching { oidcClient.startLogin() }
                .onSuccess { session ->
                    oidcSession = session
                    if (session.usesNativeRedirect) oidcTransactions.save(session.transaction)
                    update { it.copy(loading = false, waitingForLogin = true, loginUrl = session.authorizationUrl) }
                    if (!session.usesNativeRedirect) completeOidcLogin(session)
                }
                .onFailure { error -> update { it.copy(loading = false, waitingForLogin = false, error = error.message) } }
        }
    }

    fun loginUrlOpened() = update { it.copy(loginUrl = null) }

    fun handleOidcRedirect(uri: Uri?) {
        if (uri == null || !uri.scheme.equals("ai.drsai.remote", ignoreCase = true) || uri.path != "/oauth2redirect") return
        val transaction = oidcTransactions.load()
        if (transaction == null) {
            if (mutableState.value.user != null) return
            update {
                it.copy(
                    destination = AppDestination.Login,
                    loading = false,
                    waitingForLogin = false,
                    error = "登录状态已丢失或已使用，请重新登录",
                )
            }
            return
        }
        loginJob?.cancel()
        loginJob = viewModelScope.launch {
            update { it.copy(destination = AppDestination.Login, loading = true, waitingForLogin = true, error = null) }
            val session = oidcSession?.takeIf { it.transaction == transaction }
                ?: oidcClient.restoreSession(transaction)
            completeOidcLogin(session, uri)
        }
    }

    private suspend fun completeOidcLogin(session: OidcLoginSession, redirect: Uri? = null) {
        runCatching { oidcClient.finishLogin(session, redirect) }
            .onSuccess { auth ->
                oidcTransactions.clear()
                oidcSession = null
                tokenStore.save(auth)
                tokenStore.oidcClientId = session.transaction.clientId
                loadWorkspace(auth.user)
                consumePendingAssociation()
            }
            .onFailure { error ->
                oidcTransactions.clear()
                oidcSession = null
                update { it.copy(loading = false, waitingForLogin = false, loginUrl = null, error = error.message) }
            }
    }

    fun cancelLogin() {
        oidcClient.cancel(oidcSession)
        oidcTransactions.clear()
        loginJob?.cancel()
        loginJob = null
        oidcSession = null
        update { it.copy(loading = false, waitingForLogin = false, loginUrl = null, error = "登录已取消") }
    }

    private fun loadWorkspace(user: ai.drsai.remote.data.User) = viewModelScope.launch(Dispatchers.IO + databaseFailureHandler) {
        update { it.copy(destination = AppDestination.Chat, user = user, loading = true, waitingForLogin = false, error = null) }
        val modelResult = runCatching { modelClient.listModels() }
        val catalog = agentRepository.load(user.id)
        val models = modelResult.getOrDefault(emptyList())
        val selected = tokenStore.selectedModelId?.let { saved -> models.firstOrNull { it.id == saved } }
            ?: runCatching { modelClient.selectModel(models) }.getOrNull()
        selected?.let { tokenStore.selectedModelId = it.id }
        val localAgent = configuredLocalAgent(user.id, models)
        val agents = listOf(localAgent) + catalog.agents
        val entities = database.dao().conversationSnapshot(user.id)
        workbenchProjection.projectLocalConversations(user.id, entities)
        val workbenchTree = loadWorkbenchTree(user.id)
        refreshSkillCatalog(agents, hasRemoteWorkspace = workbenchTree.any { !it.local })
        val archivedSessions = loadArchivedSessions(user.id)
        val memories = database.dao().memorySnapshot(user.id).map { MemoryUiItem(it.id, it.content) }
        val artifacts = loadWorkbenchArtifacts(user.id)
        val conversations = entities.map(::toConversation)
        val current = conversations.firstOrNull()
        val messages = current?.let { loadMessages(it.id) }.orEmpty()
        val recoveredRuns = runtimeV2Recorder.recover(user.id)
        recoveredRuns.forEach { runRecoveryScheduler.schedule(user.id, it.command.runId) }
        pruneRuntimeCaches(user.id, recoveredRuns.map { it.command.runId.value }.toSet())
        recoverableRun = current?.let { selected ->
            recoveredRuns.lastOrNull { it.command.sessionId.value == selected.id }
        }
        val approvals = approvalRepository.pending(user.id)
        pendingApprovalEntities = approvals.associateBy(WorkbenchApprovalEntity::approvalId)
        approvalJob?.cancel()
        approvalJob = viewModelScope.launch(Dispatchers.IO) {
            database.workbenchDao().pendingApprovalsFlow(user.id).collect { pending ->
                pendingApprovalEntities = pending.associateBy(WorkbenchApprovalEntity::approvalId)
                update { state -> state.copy(pendingApprovals = pending.map { it.toApprovalUiItem() }) }
            }
        }
        val selectedAgent = current?.let { conversation ->
            agents.firstOrNull { it.id == conversation.agentId } ?: Agent(
                id = conversation.agentId,
                name = conversation.agentName,
                source = conversation.agentSource,
                mode = conversation.agentSource,
                available = false,
                chatSupported = false,
                description = "该会话使用的智能体当前不在目录中",
            )
        }
            ?: tokenStore.selectedAgentId?.let { saved -> agents.firstOrNull { it.id == saved } }
            ?: agents.firstOrNull { it.isDefault && it.chatSupported }
            ?: localAgent
        tokenStore.selectedAgentId = selectedAgent.id
        val modelError = if (selected == null && selectedAgent.source == "local") {
            modelResult.exceptionOrNull()?.message ?: "当前 HAI 账号没有可用模型，本地 OpenDrSai 暂不可用"
        } else null
        update {
            it.copy(
                agents = agents,
                selectedAgent = selectedAgent,
                models = models,
                selectedModel = selected,
                conversations = conversations,
                currentConversation = current,
                messages = messages,
                agentCatalogStatus = catalog.status,
                loading = false,
                error = modelError,
                runtimeStatus = recoverableRun?.let { "发现暂停的任务，可点击重试继续" },
                pendingApprovals = approvals.map { it.toApprovalUiItem() },
                localWorkspaceGranted = safWorkspaceStore.uri(user.id) != null,
                workbenchWorkspaces = workbenchTree,
                memories = memories,
                memoryEnabled = memorySettings.enabled(user.id),
                archivedSessions = archivedSessions,
                workbenchArtifacts = artifacts,
                skills = skillCatalog.snapshot().map(::toSkillUiItem),
            )
        }
    }

    fun handleDeepLink(uri: Uri?) {
        val route = uri?.toString()?.let(WorkbenchDeepLinkParser::route) ?: return
        update { it.copy(requestedRoutePath = route.path) }
    }

    fun handleAssociationDeepLink(uri: Uri?) {
        if (uri == null || uri.scheme != "opendrsai" || uri.host != "associate") return
        val code = when (val decision = associationGate.evaluate(uri.toString())) {
            is AssociationDeepLinkDecision.Accept -> decision.code
            AssociationDeepLinkDecision.Duplicate -> return
            AssociationDeepLinkDecision.Reject -> {
                update { state ->
                    state.copy(
                        associationState = AssociationState.FAILED,
                        error = "关联二维码无效，请在电脑端刷新后重试",
                    )
                }
                return
            }
        }
        pendingAssociationCode = code
        if (tokenStore.user() == null || tokenStore.accessToken.isNullOrBlank()) {
            update {
                it.copy(
                    destination = AppDestination.Login,
                    associationState = AssociationState.PENDING_LOGIN,
                )
            }
            return
        }
        consumePendingAssociation()
    }

    private fun consumePendingAssociation() {
        val code = pendingAssociationCode ?: return
        if (associationJob?.isActive == true) return
        associationJob = viewModelScope.launch(Dispatchers.IO) {
            update { it.copy(associationState = AssociationState.ASSOCIATING, error = null) }
            runCatching { relayDiscovery.associate(code) }
                .onSuccess {
                    pendingAssociationCode = null
                    update {
                        it.copy(
                            associationState = AssociationState.ASSOCIATED,
                            requestedRoutePath = ai.drsai.remote.remote.navigation.AppRoute.RemoteHome.path,
                        )
                    }
                }
                .onFailure { failure ->
                    if (failure is RelayHttpException && failure.status == 401) {
                        update {
                            it.copy(
                                destination = AppDestination.Login,
                                associationState = AssociationState.AUTH_REQUIRED,
                                error = "HepAI 登录已过期，请重新登录",
                            )
                        }
                    } else {
                        pendingAssociationCode = null
                        update {
                            it.copy(
                                associationState = AssociationState.FAILED,
                                error = "远程工作区关联失败，请刷新二维码后重试",
                            )
                        }
                    }
                }
        }
    }

    fun consumeRequestedRoute() = update { it.copy(requestedRoutePath = null) }

    fun send(text: String) = sendMessage(text)

    fun decideApproval(id: String, decision: ApprovalDecision) {
        val user = mutableState.value.user ?: return
        val entity = pendingApprovalEntities[id] ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val binding = ApprovalBinding(
                WorkbenchId(entity.runId), entity.toolCallId, entity.operation,
                entity.argumentsDigest, entity.scope,
            )
            val command = CreateApprovalCommand(
                user.id, entity.organization, WorkbenchId(entity.runtimeId), WorkbenchId(entity.sessionId),
                WorkbenchId(entity.approvalId), binding, entity.expiresAt.toLongOrNull() ?: Long.MAX_VALUE,
            )
            runCatching { approvalRepository.decide(command, decision, System.currentTimeMillis()) }
                .onFailure { error -> update { it.copy(error = error.message ?: "审批失败") } }
            refreshApprovals(user.id)
        }
    }

    fun grantLocalWorkspace(uri: Uri) {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { safWorkspaceStore.grant(user.id, uri) }
                .onSuccess {
                    val local = configuredLocalAgent(user.id, mutableState.value.models)
                    update { state ->
                        state.copy(
                            agents = state.agents.map { if (it.source == "local") local else it },
                            selectedAgent = if (state.selectedAgent?.source == "local") local else state.selectedAgent,
                            localWorkspaceGranted = true,
                            error = null,
                        )
                    }
                }
                .onFailure { error -> update { it.copy(error = error.message ?: "无法授权本地工作区") } }
        }
    }

    fun clearLocalWorkspace() {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            safWorkspaceStore.clear(user.id)
            val local = configuredLocalAgent(user.id, mutableState.value.models)
            update { state ->
                state.copy(
                    agents = state.agents.map { if (it.source == "local") local else it },
                    selectedAgent = if (state.selectedAgent?.source == "local") local else state.selectedAgent,
                    localWorkspaceGranted = false,
                )
            }
        }
    }

    fun addAttachment(uri: Uri, fallbackName: String? = null) {
        val snapshot = mutableState.value
        if (snapshot.streaming) return
        if (snapshot.attachmentDrafts.size >= MAX_ATTACHMENTS) {
            update { it.copy(error = "一次最多添加 5 个附件") }
            return
        }
        viewModelScope.launch {
            runCatching { attachmentProcessor.prepare(uri, fallbackName) }
                .onSuccess { draft ->
                    val current = mutableState.value.attachmentDrafts
                    if (current.sumOf(AttachmentDraft::size) + draft.size > MAX_ATTACHMENT_TOTAL_BYTES) {
                        attachmentProcessor.delete(draft)
                        update { it.copy(error = "一次发送的附件总大小不能超过 25 MB") }
                    } else if (current.any { it.sha256 == draft.sha256 }) {
                        attachmentProcessor.delete(draft)
                        update { it.copy(error = "该附件已经添加") }
                    } else {
                        update { it.copy(attachmentDrafts = it.attachmentDrafts + draft, error = null) }
                    }
                }
                .onFailure { error -> update { it.copy(error = error.message ?: "无法读取附件") } }
        }
    }

    fun removeAttachment(id: String) {
        val draft = mutableState.value.attachmentDrafts.firstOrNull { it.id == id } ?: return
        update { it.copy(attachmentDrafts = it.attachmentDrafts.filterNot { item -> item.id == id }) }
        attachmentProcessor.delete(draft)
        draft.remoteId?.let { remote -> viewModelScope.launch { runCatching { attachmentRepository.delete(remote) } } }
    }

    fun retryAttachment(id: String) = update { state ->
        state.copy(
            attachmentDrafts = state.attachmentDrafts.map {
                if (it.id == id) it.copy(status = AttachmentStatus.READY, progress = 0, error = null, remoteId = null) else it
            },
            error = null,
        )
    }

    private fun sendMessage(
        text: String,
        resumeCheckpoint: RunCheckpoint? = null,
        resumedAttachments: List<MessageAttachment> = emptyList(),
    ) {
        val clean = text.trim()
        val snapshot = mutableState.value
        val user = snapshot.user ?: return
        val agent = snapshot.selectedAgent ?: return
        val drafts = snapshot.attachmentDrafts
        val hasImages = drafts.any { it.kind == "image" } || resumedAttachments.any { it.kind == "image" }
        val model = when {
            agent.source != "local" -> snapshot.selectedModel
            else -> selectLocalModelForAttachments(
                snapshot.models,
                snapshot.selectedModel,
                snapshot.currentConversation?.modelId,
                hasImages,
            )
        }
        if ((clean.isEmpty() && drafts.isEmpty() && resumedAttachments.isEmpty()) || snapshot.streaming) return
        if (!agent.available || !agent.chatSupported) {
            update { it.copy(error = "${agent.name} 暂不支持 Android 对话") }
            return
        }
        if (agent.source == "local" && model == null) {
            val message = if (hasImages) "当前 HAI 账号没有可用的视觉模型，无法处理图片" else "当前 HAI 账号没有可用模型，本地 OpenDrSai 暂不可用"
            update { it.copy(error = message) }
            return
        }
        if (clean.length > 16_000) {
            update { it.copy(error = "单条消息不能超过 16,000 字符") }
            return
        }
        if (drafts.isNotEmpty() && agent.source == "platform" && "attachment-upload" !in snapshot.agentCatalogStatus.capabilities) {
            update { it.copy(error = "当前 HAI 平台尚未启用附件上传") }
            return
        }
        if ((drafts.any { it.kind == "image" } || resumedAttachments.any { it.kind == "image" }) && "image-input" !in agent.capabilities) {
            update { it.copy(error = "${agent.name} 暂不支持图片输入") }
            return
        }
        if ((drafts.any { it.kind != "image" } || resumedAttachments.any { it.kind != "image" }) && "document-input" !in agent.capabilities) {
            update { it.copy(error = "${agent.name} 暂不支持文档输入") }
            return
        }
        if (agent.source == "local" && model != snapshot.selectedModel) {
            tokenStore.selectedModelId = model?.id
            update { it.copy(selectedModel = model) }
        }
        runJob = viewModelScope.launch {
            var attemptedRunId: String? = resumeCheckpoint?.command?.runId?.value
            try {
                update { it.copy(streaming = true, runtimeStatus = if (drafts.isNotEmpty()) "正在上传附件…" else null, error = null) }
                var conversation = snapshot.currentConversation
                if (conversation == null) {
                    val now = System.currentTimeMillis()
                    val title = clean.ifBlank { drafts.first().name }.replace('\n', ' ').take(32)
                    conversation = Conversation(
                        id = UUID.randomUUID().toString(), title = title, agentId = agent.id, agentName = agent.name,
                        agentSource = agent.source, modelId = if (agent.source == "local") model?.id.orEmpty() else "", updatedAt = now,
                    )
                    val entity = toEntity(conversation, user.id, now)
                    database.dao().saveConversation(entity)
                    workbenchProjection.projectLocalConversation(entity)
                    val tree = loadWorkbenchTree(user.id)
                    update { it.copy(currentConversation = conversation, conversations = listOf(conversation) + it.conversations, workbenchWorkspaces = tree) }
                } else if (agent.source == "local" && model != null && conversation.modelId != model.id) {
                    val now = System.currentTimeMillis()
                    val switched = conversation.copy(modelId = model.id, updatedAt = now)
                    conversation = switched
                    val entity = toEntity(switched, user.id, now)
                    database.dao().saveConversation(entity)
                    workbenchProjection.projectLocalConversation(entity)
                    update { state ->
                        state.copy(
                            currentConversation = switched,
                            selectedModel = model,
                            conversations = state.conversations.map { item -> if (item.id == switched.id) switched else item },
                        )
                    }
                }
                val activeConversation = conversation ?: return@launch
                require(resumeCheckpoint == null || resumeCheckpoint.command.sessionId.value == activeConversation.id) {
                    "resume_session_mismatch"
                }
                val runId = resumeCheckpoint?.command?.runId?.value ?: UUID.randomUUID().toString()
                attemptedRunId = runId
                val userMessageId = resumeCheckpoint?.command?.idempotencyKey ?: UUID.randomUUID().toString()
                val semaphore = Semaphore(2)
                val uploaded = coroutineScope {
                    drafts.map { draft ->
                        async {
                            semaphore.withPermit {
                                draft.remoteId?.let { remote ->
                                    return@withPermit draft.copy(remoteId = remote, status = AttachmentStatus.UPLOADED, progress = 100)
                                }
                                updateDraft(draft.id) { it.copy(status = AttachmentStatus.UPLOADING, progress = 0, error = null) }
                                try {
                                    val remote = attachmentRepository.upload(draft, activeConversation.id, runId, draft.id) { progress ->
                                        updateDraft(draft.id) { it.copy(status = AttachmentStatus.UPLOADING, progress = progress) }
                                    }
                                    draft.copy(remoteId = remote.id, status = AttachmentStatus.UPLOADED, progress = 100)
                                        .also { complete -> updateDraft(draft.id) { complete } }
                                } catch (error: Throwable) {
                                    updateDraft(draft.id) { it.copy(status = AttachmentStatus.FAILED, error = error.message, progress = 0) }
                                    throw error
                                }
                            }
                        }
                    }.awaitAll()
                }
                val messageText = clean.ifBlank { "请分析这些附件" }
                val messageAttachments = if (resumeCheckpoint != null) resumedAttachments else uploaded.map { draft ->
                    MessageAttachment(
                        id = draft.id, messageId = userMessageId, conversationId = activeConversation.id,
                        remoteId = draft.remoteId, name = draft.name, mimeType = draft.mimeType, size = draft.size,
                        kind = draft.kind, localPath = draft.localPath, thumbnailPath = draft.thumbnailPath,
                        sha256 = draft.sha256, status = "sent",
                    )
                }
                val optimisticUser = ChatMessage(userMessageId, activeConversation.id, "user", clean, attachments = messageAttachments)
                val assistantMessageId = UUID.randomUUID().toString()
                val optimisticAssistant = ChatMessage(assistantMessageId, activeConversation.id, "assistant", "", status = "streaming")
                streamText = ""
                update {
                    it.copy(
                        messages = it.messages + if (resumeCheckpoint == null) {
                            listOf(optimisticUser, optimisticAssistant)
                        } else listOf(optimisticAssistant),
                        attachmentDrafts = emptyList(),
                        runtimeStatus = null,
                    )
                }
                activeRunAuthority = if (activeConversation.agentSource == "platform") {
                    RuntimeAuthority.REMOTE_RUNTIME
                } else RuntimeAuthority.LOCAL_DEVICE
                val runtimeBinding = if (activeConversation.agentSource == "platform") {
                    RuntimeBinding(WorkbenchId("hai-platform"), RuntimeAuthority.REMOTE_RUNTIME)
                } else RuntimeBinding.AndroidLocal
                val runtimeCapabilities = if (activeConversation.agentSource == "platform") {
                    setOf(
                        ai.drsai.remote.workbench.model.RuntimeCapability.CHAT,
                        ai.drsai.remote.workbench.model.RuntimeCapability.STREAMING,
                    )
                } else {
                    buildSet {
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.CHAT)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.ATTACHMENT_INPUT)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.LOCAL_MEMORY)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.SAFE_DEVICE_INFO)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.APPROVALS)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.ARTIFACTS)
                        add(ai.drsai.remote.workbench.model.RuntimeCapability.BACKGROUND_RUNS)
                        if (safWorkspaceStore.uri(user.id) != null) {
                            add(ai.drsai.remote.workbench.model.RuntimeCapability.PROJECT_FILES)
                            add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_READ)
                            add(ai.drsai.remote.workbench.model.RuntimeCapability.SAF_WRITE)
                        }
                    }
                }
                val pinnedSkills = skillCatalog.pin(runId, runtimeCapabilities)
                val runCommand = resumeCheckpoint?.command ?: RunCommand(
                        accountSubject = user.id,
                        organization = "",
                        binding = runtimeBinding,
                        workspaceId = WorkbenchId(if (activeConversation.agentSource == "platform") "platform" else "local"),
                        sessionId = WorkbenchId(activeConversation.id),
                        runId = WorkbenchId(runId),
                        backendId = if (activeConversation.agentSource == "platform") "hai-agent" else "opendrsai",
                        idempotencyKey = userMessageId,
                        input = messageText.ifBlank { "[attachment]" },
                        skillVersions = pinnedSkills.skills.associate { it.id to it.version },
                    )
                val events = journaledChatExecution.execute(
                    runCommand,
                    ChatRunRequest(
                        accountSubject = user.id,
                        authority = activeRunAuthority,
                        conversation = activeConversation,
                        input = messageText,
                        attachments = messageAttachments,
                        runId = runId,
                        userMessageId = userMessageId,
                        assistantMessageId = assistantMessageId,
                    ),
                )
                events.collect { journaled ->
                    val event = journaled.event
                    val checkpoint = journaled.checkpoint
                    when (event) {
                        is RuntimeEvent.Started -> { activeRunId = event.runId; runNotifications.show(event.runId, "正在思考…") }
                        is RuntimeEvent.TextDelta -> { streamText += event.text; replaceLast(streamText); update { it.copy(runtimeStatus = null) } }
                        is RuntimeEvent.ToolStarted -> { runNotifications.show(runId, toolLabel(event.name)); update { it.copy(runtimeStatus = toolLabel(event.name)) } }
                        is RuntimeEvent.ToolFinished -> update { it.copy(runtimeStatus = "正在整理工具结果…") }
                        is RuntimeEvent.ToolFailed -> reportRuntimeFailure(
                            IllegalStateException(event.code), runId, activeRunAuthority,
                            displayMessage = "工具 ${event.name} 执行失败：${event.code}",
                            failureCode = event.code,
                        )
                        is RuntimeEvent.ToolDowngraded -> update { it.copy(toolDowngraded = true, runtimeStatus = event.reason) }
                        is RuntimeEvent.Artifact -> receiveArtifact(activeConversation.id, assistantMessageId, event.attachment)
                        RuntimeEvent.Completed -> { skillCatalog.release(runId); runNotifications.dismiss(runId); runRecoveryScheduler.cancel(user.id, WorkbenchId(runId)); recoverableRun = null; finishRun(activeConversation.id) }
                        RuntimeEvent.Cancelled -> { skillCatalog.release(runId); runNotifications.dismiss(runId); runRecoveryScheduler.cancel(user.id, WorkbenchId(runId)); recoverableRun = null; reloadMessages(activeConversation.id); update { it.copy(streaming = false, runtimeStatus = null, error = null) } }
                        RuntimeEvent.Paused -> { runNotifications.dismiss(runId); recoverableRun = checkpoint; reloadMessages(activeConversation.id); update { it.copy(streaming = false, runtimeStatus = "任务已暂停", error = "可点击重试继续") } }
                        is RuntimeEvent.Failed -> {
                            skillCatalog.release(runId)
                            runNotifications.dismiss(runId)
                            reloadMessages(activeConversation.id)
                            reportRuntimeFailure(
                                IllegalStateException(event.message), runId, activeRunAuthority,
                                displayMessage = event.message,
                                httpStatusOverride = if (event.retryable) 503 else 422,
                            )
                        }
                    }
                }
            } catch (error: kotlinx.coroutines.CancellationException) {
                update { it.copy(streaming = false, runtimeStatus = null) }
            } catch (error: Throwable) {
                attemptedRunId?.let(skillCatalog::release)
                reportRuntimeFailure(error, attemptedRunId, activeRunAuthority)
            } finally {
                activeRunId = null
                activeRunAuthority = RuntimeAuthority.LOCAL_DEVICE
            }
        }
    }

    private fun updateDraft(id: String, transform: (AttachmentDraft) -> AttachmentDraft) = update { state ->
        state.copy(attachmentDrafts = state.attachmentDrafts.map { if (it.id == id) transform(it) else it })
    }

    private fun reportRuntimeFailure(
        error: Throwable,
        runId: String?,
        authority: RuntimeAuthority,
        displayMessage: String = error.message ?: "运行失败",
        failureCode: String? = null,
        httpStatusOverride: Int? = null,
    ) {
        val classified = RuntimeFailureCatalog.classify(
            httpStatus = httpStatusOverride ?: (error as? ApiException)?.status ?: if (error is IOException) 0 else null,
            code = failureCode,
        )
        val bundle = DiagnosticBundleFactory.create(
            classified,
            requestId = extractRequestId(error.message),
            runId = runId?.let(::WorkbenchId),
            authority = authority,
            rawDetails = error.stackTraceToString(),
        )
        update {
            it.copy(
                streaming = false,
                runtimeStatus = null,
                error = "$displayMessage · ${classified.userAction}",
                diagnostic = RuntimeDiagnosticUi(
                    bundle.errorCode,
                    classified.userAction,
                    bundle.runId?.value,
                    bundle.requestId,
                    bundle.details,
                ),
            )
        }
    }

    private fun extractRequestId(value: String?): String? = value?.let {
        Regex("(?i)(?:request[_ -]?id|trace[_ -]?id)[:=\\s]+([A-Za-z0-9._:-]{4,100})")
            .find(it)?.groupValues?.getOrNull(1)
    }

    private suspend fun receiveArtifact(
        conversationId: String,
        messageId: String,
        remote: ai.drsai.remote.data.RemoteAttachment,
    ) {
        val safeName = ai.drsai.remote.data.AttachmentPolicy.sanitizeName(remote.name)
        val target = File(getApplication<Application>().cacheDir, "attachments/results/${remote.id}-$safeName")
        val attachment = runCatching { attachmentRepository.download(remote.id, target) }.fold(
            onSuccess = { file ->
                MessageAttachment(
                    remote.id, messageId, conversationId, remote.id, remote.name, remote.mimeType,
                    remote.size, remote.kind, file.absolutePath, null, remote.sha256, "downloaded",
                )
            },
            onFailure = {
                MessageAttachment(
                    remote.id, messageId, conversationId, remote.id, remote.name, remote.mimeType,
                    remote.size, remote.kind, null, null, remote.sha256, "download_failed",
                )
            },
        )
        database.dao().saveAttachments(listOf(ai.drsai.remote.data.MessageAttachmentEntity(
            attachment.id, attachment.messageId, attachment.conversationId, attachment.remoteId,
            attachment.name, attachment.mimeType, attachment.size, attachment.kind, attachment.localPath,
            attachment.thumbnailPath, attachment.sha256, attachment.status, attachment.createdAt,
        )))
        val artifacts = mutableState.value.user?.id?.let { loadWorkbenchArtifacts(it) }.orEmpty()
        update { state ->
            state.copy(messages = state.messages.map { message ->
                if (message.id == messageId) {
                    message.copy(attachments = message.attachments.filterNot { it.id == attachment.id } + attachment)
                } else message
            }, workbenchArtifacts = artifacts)
        }
    }

    fun retryResultAttachment(messageId: String, attachmentId: String) {
        val message = mutableState.value.messages.firstOrNull { it.id == messageId } ?: return
        val attachment = message.attachments.firstOrNull { it.id == attachmentId } ?: return
        val remoteId = attachment.remoteId ?: return
        viewModelScope.launch {
            receiveArtifact(
                message.conversationId,
                messageId,
                ai.drsai.remote.data.RemoteAttachment(
                    remoteId, attachment.name, attachment.kind, attachment.mimeType, attachment.size,
                    attachment.sha256, "ready",
                ),
            )
        }
    }

    private fun replaceLast(text: String) = update {
        val messages = it.messages.toMutableList()
        val last = messages.indexOfLast { message -> message.role == "assistant" }
        if (last >= 0) messages[last] = messages[last].copy(text = text)
        it.copy(messages = messages)
    }

    private suspend fun finishRun(conversationId: String) {
        reloadMessages(conversationId)
        val artifacts = mutableState.value.user?.id?.let { loadWorkbenchArtifacts(it) }.orEmpty()
        update { it.copy(streaming = false, runtimeStatus = null, workbenchArtifacts = artifacts) }
    }

    private suspend fun loadWorkbenchArtifacts(subject: String): List<WorkbenchArtifactItem> {
        val attachments = database.dao().allAttachmentsForUser(subject).map { item ->
            WorkbenchArtifactItem(
                item.id, item.name, item.mimeType, item.size, item.conversationId,
                source = "attachment",
            )
        }
        val toolOutputs = database.dao().allToolArtifacts(subject).map { item ->
            WorkbenchArtifactItem(
                item.id, "${item.toolId}-output.txt", "text/plain", item.content.encodeToByteArray().size.toLong(),
                item.sessionId, item.runId, "tool",
            )
        }
        return attachments + toolOutputs
    }

    private suspend fun pruneRuntimeCaches(subject: String, activeRunIds: Set<String>) {
        val rows = database.dao().allToolArtifacts(subject)
        val evictions = ResourceRetentionPolicy.evictions(
            rows.map { row ->
                ResourceRecord(
                    row.id,
                    row.content.encodeToByteArray().size.toLong(),
                    row.createdAt,
                    active = row.runId in activeRunIds,
                )
            },
            maxBytes = 16L * 1024 * 1024,
            maxItems = 200,
        )
        if (evictions.isNotEmpty()) database.dao().deleteToolArtifacts(subject, evictions.map { it.id })
    }

    private fun refreshSkillCatalog(agents: List<Agent>, hasRemoteWorkspace: Boolean) {
        skillCatalog.replace(
            SkillSource.BUILT_IN,
            listOf(
                SkillDefinition(
                    "device.info", 1, "安全设备信息", SkillSource.BUILT_IN,
                    setOf(ai.drsai.remote.workbench.model.RuntimeCapability.SAFE_DEVICE_INFO),
                ),
                SkillDefinition(
                    "memory.local", 1, "本地记忆", SkillSource.BUILT_IN,
                    setOf(ai.drsai.remote.workbench.model.RuntimeCapability.LOCAL_MEMORY),
                ),
                SkillDefinition(
                    "attachments", 1, "附件处理", SkillSource.BUILT_IN,
                    setOf(ai.drsai.remote.workbench.model.RuntimeCapability.ATTACHMENT_INPUT),
                ),
                SkillDefinition(
                    "workspace.saf", 1, "SAF 工作区", SkillSource.BUILT_IN,
                    setOf(
                        ai.drsai.remote.workbench.model.RuntimeCapability.SAF_READ,
                        ai.drsai.remote.workbench.model.RuntimeCapability.SAF_WRITE,
                    ),
                ),
            ),
        )
        skillCatalog.replace(
            SkillSource.PLATFORM,
            agents.filter { it.source == "platform" }.map { agent ->
                SkillDefinition(
                    stableSkillId("platform", agent.id), 1, agent.name, SkillSource.PLATFORM,
                    executableOnAndroid = false,
                )
            },
        )
        skillCatalog.replace(
            SkillSource.REMOTE_READ_ONLY,
            if (hasRemoteWorkspace) listOf(
                SkillDefinition(
                    "remote.workspace", 1, "远程工作区能力", SkillSource.REMOTE_READ_ONLY,
                    executableOnAndroid = false,
                ),
            ) else emptyList(),
        )
    }

    private fun stableSkillId(prefix: String, value: String): String {
        val normalized = value.lowercase().replace(Regex("[^a-z0-9._-]+"), "-").trim('-').take(70)
        return "$prefix.${normalized.ifBlank { value.hashCode().toUInt().toString(16) }}"
    }

    private fun toSkillUiItem(skill: SkillDefinition) = SkillUiItem(
        skill.id,
        skill.displayName,
        skill.version,
        when (skill.source) {
            SkillSource.BUILT_IN -> "Android 内置"
            SkillSource.PLATFORM -> "HepAI 平台"
            SkillSource.REMOTE_READ_ONLY -> "远程只读"
        },
        available = true,
        permissions = skill.requiredCapabilities.joinToString { it.name }.ifBlank {
            if (skill.executableOnAndroid) "受 Android 权限与审批策略约束" else "仅展示声明，不在 Android 执行脚本"
        },
    )

    private suspend fun reloadMessages(conversationId: String) {
        val messages = loadMessages(conversationId)
        update { it.copy(messages = messages) }
    }

    fun stop() {
        val runId = activeRunId
        runId?.let {
            chatExecution.stop(activeRunAuthority, it)
        }
        runJob?.cancel()
        if (runId != null) viewModelScope.launch(Dispatchers.IO) {
            runCatching { runtimeV2Recorder.cancel(WorkbenchId(runId)) }
            skillCatalog.release(runId)
            runNotifications.dismiss(runId)
            mutableState.value.user?.id?.let { runRecoveryScheduler.cancel(it, WorkbenchId(runId)) }
            recoverableRun = null
        }
        update { it.copy(runtimeStatus = "正在停止…") }
    }

    fun pauseForBackground() {
        if (!mutableState.value.streaming) return
        val runId = activeRunId ?: return
        // A user-visible foreground service owns the execution while the UI is
        // backgrounded. If Android kills the process, the durable checkpoint is
        // discovered by bootstrap and offered for explicit, idempotent resume.
        if (runNotifications.isActive(runId)) return
        chatExecution.pause(activeRunAuthority, runId)
        runJob?.cancel()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { runtimeV2Recorder.pause(WorkbenchId(runId)) }
                .onSuccess { checkpoint ->
                    recoverableRun = checkpoint
                    mutableState.value.user?.id?.let { runRecoveryScheduler.schedule(it, checkpoint.command.runId) }
                    update { it.copy(streaming = false, runtimeStatus = "任务已暂停", error = "可点击重试继续") }
                }
        }
    }

    fun retry() {
        val paused = recoverableRun
        val current = mutableState.value.currentConversation
        if (paused != null && current?.id == paused.command.sessionId.value) {
            viewModelScope.launch(Dispatchers.IO) {
                val attachments = database.dao().attachmentSnapshot(current.id)
                    .filter { it.messageId == paused.command.idempotencyKey }
                    .map { it.toMessageAttachment() }
                runtimeV2Recorder.resume(paused.command.runId)
                sendMessage(paused.command.input, paused, attachments)
            }
            return
        }
        val message = mutableState.value.messages.lastOrNull { it.role == "user" } ?: return
        val drafts = message.attachments.mapNotNull { attachment ->
            val path = attachment.localPath?.takeIf { File(it).isFile } ?: return@mapNotNull null
            AttachmentDraft(
                id = UUID.randomUUID().toString(), name = attachment.name, mimeType = attachment.mimeType,
                size = attachment.size, kind = attachment.kind, localPath = path,
                thumbnailPath = attachment.thumbnailPath, sha256 = attachment.sha256,
                remoteId = attachment.remoteId, status = AttachmentStatus.UPLOADED, progress = 100,
            )
        }
        update { it.copy(error = null, attachmentDrafts = drafts) }
        sendMessage(message.text)
    }

    fun newConversation() {
        if (mutableState.value.streaming) return
        mutableState.value.attachmentDrafts.forEach(attachmentProcessor::delete)
        recoverableRun = null
        update { it.copy(currentConversation = null, messages = emptyList(), attachmentDrafts = emptyList(), historyOpen = false, error = null) }
    }

    fun selectAgent(id: String) {
        val snapshot = mutableState.value
        if (snapshot.streaming) return
        val agent = snapshot.agents.firstOrNull { it.id == id } ?: return
        if (!agent.available || !agent.chatSupported) {
            update { it.copy(error = "${agent.name} 暂不支持 Android 对话") }
            return
        }
        tokenStore.selectedAgentId = agent.id
        update {
            if (it.selectedAgent?.id == agent.id) it.copy(error = null)
            else it.copy(
                selectedAgent = agent,
                currentConversation = null,
                messages = emptyList(),
                historyOpen = false,
                error = null,
                toolDowngraded = false,
            )
        }
    }

    fun refreshAgents() {
        val user = mutableState.value.user ?: return
        viewModelScope.launch(Dispatchers.IO) {
            update { it.copy(agentCatalogStatus = it.agentCatalogStatus.copy(state = "loading", message = "正在刷新平台智能体")) }
            val catalog = agentRepository.load(user.id, refresh = true)
            val localAgent = configuredLocalAgent(user.id, mutableState.value.models)
            val agents = listOf(localAgent) + catalog.agents
            val current = mutableState.value.currentConversation
            val selected = current?.let { conversation ->
                agents.firstOrNull { it.id == conversation.agentId } ?: Agent(
                    id = conversation.agentId,
                    name = conversation.agentName,
                    source = conversation.agentSource,
                    mode = conversation.agentSource,
                    available = false,
                    chatSupported = false,
                    description = "该会话使用的智能体当前不在目录中",
                )
            } ?: agents.firstOrNull { it.id == mutableState.value.selectedAgent?.id }
                ?: agents.firstOrNull { it.isDefault && it.chatSupported }
                ?: localAgent
            tokenStore.selectedAgentId = selected.id
            refreshSkillCatalog(agents, mutableState.value.workbenchWorkspaces.any { !it.local })
            update {
                it.copy(
                    agents = agents,
                    selectedAgent = selected,
                    agentCatalogStatus = catalog.status,
                    skills = skillCatalog.snapshot().map(::toSkillUiItem),
                )
            }
        }
    }

    fun searchWorkbench(query: String) {
        val subject = mutableState.value.user?.id ?: return
        val generation = ++workbenchSearchGeneration
        workbenchSearchJob?.cancel()
        if (query.isBlank()) {
            update { it.copy(workbenchSearchResults = emptyList()) }
            return
        }
        workbenchSearchJob = viewModelScope.launch(Dispatchers.IO) {
            kotlinx.coroutines.delay(180)
            val result = unifiedWorkbench.search(subject, query)
            val dao = database.workbenchDao()
            val sessionRows = result.sessions.associateBy { it.sessionId }.toMutableMap()
            result.messages.forEach { message ->
                if (message.conversationId !in sessionRows) {
                    dao.session(subject, message.conversationId)?.let { sessionRows[it.sessionId] = it }
                }
            }
            val titleItems = result.sessions.map { row ->
                WorkbenchSearchItem(row.toUiItem(), row.title, messageMatch = false)
            }
            val messageItems = result.messages.mapNotNull { message ->
                sessionRows[message.conversationId]?.let { row ->
                    WorkbenchSearchItem(row.toUiItem(), message.content.take(160), messageMatch = true)
                }
            }
            if (generation == workbenchSearchGeneration) {
                update { it.copy(workbenchSearchResults = (titleItems + messageItems).distinctBy { item ->
                    "${item.messageMatch}:${item.session.sessionId}:${item.snippet}"
                }.take(100)) }
            }
        }
    }

    fun loadMoreWorkbenchSessions(workspaceKey: String) {
        val subject = mutableState.value.user?.id ?: return
        val workspace = mutableState.value.workbenchWorkspaces.firstOrNull { it.key == workspaceKey } ?: return
        if (!workspace.sessionHasMore) return
        val current = mutableState.value.workbenchSessionLimits[workspaceKey] ?: WORKBENCH_SESSION_PAGE_SIZE
        update { it.copy(workbenchSessionLimits = it.workbenchSessionLimits + (workspaceKey to current + WORKBENCH_SESSION_PAGE_SIZE)) }
        viewModelScope.launch(Dispatchers.IO) {
            val tree = loadWorkbenchTree(subject)
            update { it.copy(workbenchWorkspaces = tree) }
        }
    }

    fun projectRemoteWorkspaces(items: List<Pair<String, ai.drsai.remote.remote.model.RemoteWorkspaceRef>>) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            workbenchProjection.projectRemoteWorkspaces(subject, items, System.currentTimeMillis())
            val tree = loadWorkbenchTree(subject)
            refreshSkillCatalog(mutableState.value.agents, hasRemoteWorkspace = tree.any { !it.local })
            update { it.copy(workbenchWorkspaces = tree, skills = skillCatalog.snapshot().map(::toSkillUiItem)) }
        }
    }

    fun projectRemoteSessions(items: List<ai.drsai.remote.remote.model.RemoteSessionRef>) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            workbenchProjection.projectRemoteSessions(subject, items, System.currentTimeMillis())
            val tree = loadWorkbenchTree(subject)
            update { it.copy(workbenchWorkspaces = tree) }
        }
    }

    fun openConversation(id: String) = viewModelScope.launch(Dispatchers.IO) {
        if (mutableState.value.streaming) return@launch
        val conversation = mutableState.value.conversations.firstOrNull { it.id == id } ?: return@launch
        val messages = loadMessages(id)
        mutableState.value.user?.let { database.workbenchDao().setSessionUnread(it.id, id, false) }
        val tree = mutableState.value.user?.let { loadWorkbenchTree(it.id) }.orEmpty()
        recoverableRun = mutableState.value.user?.let { user ->
            runtimeV2Recorder.recover(user.id).lastOrNull { it.command.sessionId.value == id }
        }
        val agent = mutableState.value.agents.firstOrNull { it.id == conversation.agentId }
            ?: Agent(
                id = conversation.agentId,
                name = conversation.agentName,
                source = conversation.agentSource,
                mode = conversation.agentSource,
                available = false,
                chatSupported = false,
                description = "该会话使用的智能体当前不在目录中",
            )
        update {
            it.copy(
                currentConversation = conversation,
                selectedAgent = agent,
                messages = messages,
                historyOpen = false,
                error = null,
                runtimeStatus = recoverableRun?.let { "发现暂停的任务，可点击重试继续" },
                workbenchWorkspaces = tree,
            )
        }
    }

    fun toggleHistory(open: Boolean) = update { it.copy(historyOpen = open) }
    fun toggleProfile(open: Boolean) = update { it.copy(profileOpen = open) }

    fun setMemoryEnabled(enabled: Boolean) {
        val subject = mutableState.value.user?.id ?: return
        memorySettings.setEnabled(subject, enabled)
        update { it.copy(memoryEnabled = enabled) }
    }

    fun openRecoverableRun(runId: String) = viewModelScope.launch(Dispatchers.IO) {
        val user = tokenStore.user() ?: return@launch
        val recovered = runtimeV2Recorder.recover(user.id).firstOrNull { it.command.runId.value == runId }
            ?: return@launch
        state.filter { it.user?.id == user.id && !it.loading }.first()
        openConversation(recovered.command.sessionId.value)
    }

    fun deleteMemory(id: Long) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            database.dao().deleteMemory(subject, id)
            val memories = database.dao().memorySnapshot(subject).map { MemoryUiItem(it.id, it.content) }
            update { it.copy(memories = memories) }
        }
    }

    fun renameSession(sessionId: String, title: String) = mutateSession { subject ->
        unifiedWorkbench.rename(subject, sessionId, title, System.currentTimeMillis())
    }

    fun setSessionPinned(sessionId: String, pinned: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setPinned(subject, sessionId, pinned, System.currentTimeMillis())
    }

    fun setSessionArchived(sessionId: String, archived: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setArchived(subject, sessionId, archived, System.currentTimeMillis())
    }

    fun setSessionUnread(sessionId: String, unread: Boolean) = mutateSession { subject ->
        unifiedWorkbench.setUnread(subject, sessionId, unread)
    }

    private fun mutateSession(block: suspend (String) -> SessionMutationResult) {
        val subject = mutableState.value.user?.id ?: return
        viewModelScope.launch(Dispatchers.IO) {
            when (block(subject)) {
                SessionMutationResult.Applied -> {
                    val entities = database.dao().conversationSnapshot(subject)
                    val tree = loadWorkbenchTree(subject)
                    val archived = loadArchivedSessions(subject)
                    update { it.copy(
                        conversations = entities.map(::toConversation),
                        currentConversation = it.currentConversation?.let { current ->
                            entities.firstOrNull { row -> row.id == current.id }?.let(::toConversation)
                        },
                        workbenchWorkspaces = tree,
                        archivedSessions = archived,
                    ) }
                }
                SessionMutationResult.NotFound -> update { it.copy(error = "会话不存在或已移除") }
                SessionMutationResult.RemoteAuthorityRequired -> update { it.copy(error = "远程会话需要由对应 Runtime 执行此操作") }
            }
        }
    }
    fun setTheme(value: Boolean?) = update { it.copy(darkTheme = value) }

    fun logout() {
        val remoteSubject = mutableState.value.user?.id
        remoteSubject?.let(RemoteSubscriptionRegistry::cancelSubject)
        activeRunId?.let { runId ->
            chatExecution.stop(activeRunAuthority, runId)
            skillCatalog.release(runId)
        }
        runJob?.cancel()
        approvalJob?.cancel()
        approvalJob = null
        runJob = null
        activeRunId = null
        oidcClient.cancel(oidcSession)
        oidcTransactions.clear()
        loginJob?.cancel()
        mutableState.value.attachmentDrafts.forEach(attachmentProcessor::delete)
        viewModelScope.launch {
            mutableState.value.attachmentDrafts.mapNotNull { it.remoteId }.forEach { remote ->
                runCatching { attachmentRepository.delete(remote) }
            }
            runCatching { modelClient.logout() }
            remoteSubject?.let { runCatching { RemoteCacheRepository(database).clearSubject(it) } }
            tokenStore.clear()
            update { AppState(destination = AppDestination.Login) }
        }
    }

    private suspend fun refreshApprovals(subject: String) {
        val approvals = approvalRepository.pending(subject)
        pendingApprovalEntities = approvals.associateBy(WorkbenchApprovalEntity::approvalId)
        update { it.copy(pendingApprovals = approvals.map { item -> item.toApprovalUiItem() }) }
    }

    private fun configuredLocalAgent(subject: String, models: List<ai.drsai.remote.data.ModelInfo>): Agent {
        val base = localAgentFor(models)
        return if (safWorkspaceStore.uri(subject) == null) base else base.copy(
            capabilities = base.capabilities + setOf("saf-read", "saf-write", "project-instructions"),
        )
    }

    private fun WorkbenchApprovalEntity.toApprovalUiItem() = ApprovalUiItem(
        id = approvalId,
        operation = operation,
        scope = scope,
        runtimeId = runtimeId,
        sessionId = sessionId,
        expiresAt = expiresAt,
    )

    private suspend fun loadMessages(id: String): List<ChatMessage> {
        val attachments = database.dao().attachmentSnapshot(id).groupBy { it.messageId }
        return database.dao().visibleMessageSnapshot(id).map {
        ChatMessage(
            it.id,
            it.conversationId,
            it.role,
            sanitizeLegacyAssistantText(it.role, it.content),
            it.createdAt,
            it.status,
            attachments[it.id].orEmpty().map { item ->
                MessageAttachment(
                    id = item.id,
                    messageId = item.messageId,
                    conversationId = item.conversationId,
                    remoteId = item.remoteId,
                    name = item.name,
                    mimeType = item.mimeType,
                    size = item.size,
                    kind = item.kind,
                    localPath = item.localPath,
                    thumbnailPath = item.thumbnailPath,
                    sha256 = item.sha256,
                    status = item.status,
                    createdAt = item.createdAt,
                )
            },
        )
        }
    }

    private fun ai.drsai.remote.data.MessageAttachmentEntity.toMessageAttachment() = MessageAttachment(
        id = id,
        messageId = messageId,
        conversationId = conversationId,
        remoteId = remoteId,
        name = name,
        mimeType = mimeType,
        size = size,
        kind = kind,
        localPath = localPath,
        thumbnailPath = thumbnailPath,
        sha256 = sha256,
        status = status,
        createdAt = createdAt,
    )

    private fun toConversation(entity: ConversationEntity) = Conversation(
        id = entity.id,
        title = entity.title,
        updatedAt = entity.updatedAt,
        agentId = entity.agentId,
        agentName = entity.agentName,
        agentSource = entity.agentSource,
        modelId = entity.modelId,
    )

    private suspend fun loadWorkbenchTree(subject: String): List<WorkbenchWorkspaceItem> {
        val dao = database.workbenchDao()
        val latestRuns = dao.allRuns(subject)
            .distinctBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
            .associateBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
        val now = System.currentTimeMillis()
        return dao.allWorkspaces(subject).map { workspace ->
            val local = workspace.authority == RuntimeAuthority.LOCAL_DEVICE.name
            val key = "${workspace.organization}:${workspace.runtimeId}:${workspace.workspaceId}"
            val limit = mutableState.value.workbenchSessionLimits[key] ?: WORKBENCH_SESSION_PAGE_SIZE
            val sessionCount = dao.sessionCount(subject, workspace.organization, workspace.runtimeId, workspace.workspaceId)
            val sessions = dao.sessionPage(
                subject, workspace.organization, workspace.runtimeId, workspace.workspaceId,
                limit = limit.coerceIn(WORKBENCH_SESSION_PAGE_SIZE, WORKBENCH_SESSION_MAX_VISIBLE), offset = 0,
            )
            WorkbenchWorkspaceItem(
                key = key,
                runtimeId = workspace.runtimeId,
                workspaceId = workspace.workspaceId,
                displayName = workspace.displayName,
                local = local,
                sessions = sessions.map { session ->
                    WorkbenchSessionItem(
                        session.sessionId, session.runtimeId, session.workspaceId, session.title,
                        local, session.pinned, session.unread, session.updatedAt,
                        latestRuns[Triple(session.runtimeId, session.workspaceId, session.sessionId)]?.status ?: "IDLE",
                    )
                },
                connectionStatus = when {
                    local -> "local"
                    now - workspace.lastSyncedAt <= 2 * 60 * 1_000 -> "online"
                    else -> "stale"
                },
                sessionHasMore = sessions.size < sessionCount && sessions.size < WORKBENCH_SESSION_MAX_VISIBLE,
            )
        }
    }

    private suspend fun loadArchivedSessions(subject: String): List<WorkbenchSessionItem> =
        database.workbenchDao().allSessions(subject, archived = true).map { session ->
            session.toUiItem()
        }

    private fun ai.drsai.remote.workbench.data.WorkbenchSessionEntity.toUiItem() = WorkbenchSessionItem(
        sessionId, runtimeId, workspaceId, title,
        authority == RuntimeAuthority.LOCAL_DEVICE.name, pinned, unread, updatedAt, "IDLE",
    )

    private fun toEntity(conversation: Conversation, userId: String, createdAt: Long) = ConversationEntity(
        id = conversation.id,
        userId = userId,
        title = conversation.title,
        agentId = conversation.agentId,
        agentName = conversation.agentName,
        agentSource = conversation.agentSource,
        modelId = conversation.modelId,
        createdAt = createdAt,
        updatedAt = conversation.updatedAt,
    )

    private fun toolLabel(name: String) = when (name) {
        "get_current_time" -> "正在读取当前时间…"
        "save_memory" -> "正在保存本地记忆…"
        "search_memory" -> "正在查询本地记忆…"
        else -> "正在使用本地工具…"
    }
}
