package ai.drsai.remote

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.Agent
import ai.drsai.remote.data.AgentRepository
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
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.MAX_ATTACHMENTS
import ai.drsai.remote.data.MAX_ATTACHMENT_TOTAL_BYTES
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.OidcLoginSession
import ai.drsai.remote.data.OidcTransactionStore
import ai.drsai.remote.data.OIDC_LEGACY_CLIENT_ID
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.PlatformAgentClient
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.sanitizeLegacyAssistantText
import ai.drsai.remote.data.localAgentFor
import ai.drsai.remote.data.selectLocalModelForAttachments
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteSubscriptionRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.util.UUID
import java.io.File

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val tokenStore by lazy { SecureTokenStore(app) }
    private val oidcTransactions by lazy { OidcTransactionStore(app) }
    private val database by lazy {
        Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
            .build()
    }
    private val oidcClient by lazy { OidcClient(refreshClientId = { tokenStore.oidcClientId }) }
    private val modelClient by lazy { HaiModelClient(tokenStore, oidcClient) }
    private val tokenCoordinator by lazy { AccessTokenCoordinator(tokenStore, oidcClient) }
    private val platformClient by lazy { PlatformAgentClient(tokenCoordinator) }
    private val agentRepository by lazy { AgentRepository(platformClient, database.dao()) }
    private val platformRuntime by lazy { PlatformAgentRuntime(tokenCoordinator, database.dao()) }
    private val attachmentProcessor by lazy { AttachmentProcessor(app) }
    private val attachmentRepository by lazy { AttachmentRepository(tokenCoordinator) }
    private val runtime by lazy { LocalAgentRuntime(modelClient, database.dao(), attachmentContexts = attachmentRepository) }
    private val mutableState = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutableState.asStateFlow()

    private var loginJob: Job? = null
    private var oidcSession: OidcLoginSession? = null
    private var runJob: Job? = null
    private var activeRunId: String? = null
    private var activeRunSource: String = "local"
    private var streamText = ""

    init {
        viewModelScope.launch(Dispatchers.IO) { attachmentProcessor.cleanupOrphans() }
        bootstrap()
    }

    private fun update(transform: (AppState) -> AppState) {
        mutableState.update(transform)
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

    private fun loadWorkspace(user: ai.drsai.remote.data.User) = viewModelScope.launch(Dispatchers.IO) {
        update { it.copy(destination = AppDestination.Chat, user = user, loading = true, waitingForLogin = false, error = null) }
        val modelResult = runCatching { modelClient.listModels() }
        val catalog = agentRepository.load(user.id)
        val models = modelResult.getOrDefault(emptyList())
        val selected = tokenStore.selectedModelId?.let { saved -> models.firstOrNull { it.id == saved } }
            ?: runCatching { modelClient.selectModel(models) }.getOrNull()
        selected?.let { tokenStore.selectedModelId = it.id }
        val localAgent = localAgentFor(models)
        val agents = listOf(localAgent) + catalog.agents
        val entities = database.dao().conversationSnapshot(user.id)
        val conversations = entities.map(::toConversation)
        val current = conversations.firstOrNull()
        val messages = current?.let { loadMessages(it.id) }.orEmpty()
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
            )
        }
    }

    fun send(text: String) = sendMessage(text)

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

    private fun sendMessage(text: String) {
        val clean = text.trim()
        val snapshot = mutableState.value
        val user = snapshot.user ?: return
        val agent = snapshot.selectedAgent ?: return
        val drafts = snapshot.attachmentDrafts
        val hasImages = drafts.any { it.kind == "image" }
        val model = when {
            agent.source != "local" -> snapshot.selectedModel
            else -> selectLocalModelForAttachments(
                snapshot.models,
                snapshot.selectedModel,
                snapshot.currentConversation?.modelId,
                hasImages,
            )
        }
        if ((clean.isEmpty() && drafts.isEmpty()) || snapshot.streaming) return
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
        if (drafts.any { it.kind == "image" } && "image-input" !in agent.capabilities) {
            update { it.copy(error = "${agent.name} 暂不支持图片输入") }
            return
        }
        if (drafts.any { it.kind != "image" } && "document-input" !in agent.capabilities) {
            update { it.copy(error = "${agent.name} 暂不支持文档输入") }
            return
        }
        if (agent.source == "local" && model != snapshot.selectedModel) {
            tokenStore.selectedModelId = model?.id
            update { it.copy(selectedModel = model) }
        }
        runJob = viewModelScope.launch {
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
                    database.dao().saveConversation(toEntity(conversation, user.id, now))
                    update { it.copy(currentConversation = conversation, conversations = listOf(conversation) + it.conversations) }
                } else if (agent.source == "local" && model != null && conversation.modelId != model.id) {
                    val now = System.currentTimeMillis()
                    val switched = conversation.copy(modelId = model.id, updatedAt = now)
                    conversation = switched
                    database.dao().saveConversation(toEntity(switched, user.id, now))
                    update { state ->
                        state.copy(
                            currentConversation = switched,
                            selectedModel = model,
                            conversations = state.conversations.map { item -> if (item.id == switched.id) switched else item },
                        )
                    }
                }
                val activeConversation = conversation ?: return@launch
                val runId = UUID.randomUUID().toString()
                val userMessageId = UUID.randomUUID().toString()
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
                val messageAttachments = uploaded.map { draft ->
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
                update { it.copy(messages = it.messages + optimisticUser + optimisticAssistant, attachmentDrafts = emptyList(), runtimeStatus = null) }
                activeRunSource = activeConversation.agentSource
                val events = if (activeConversation.agentSource == "platform") {
                    platformRuntime.run(activeConversation, messageText, messageAttachments, runId, userMessageId, assistantMessageId)
                } else {
                    runtime.run(user.id, activeConversation, messageText, messageAttachments, runId, userMessageId)
                }
                events.collect { event ->
                    when (event) {
                        is RuntimeEvent.Started -> activeRunId = event.runId
                        is RuntimeEvent.TextDelta -> { streamText += event.text; replaceLast(streamText); update { it.copy(runtimeStatus = null) } }
                        is RuntimeEvent.ToolStarted -> update { it.copy(runtimeStatus = toolLabel(event.name)) }
                        is RuntimeEvent.ToolFinished -> update { it.copy(runtimeStatus = "正在整理工具结果…") }
                        is RuntimeEvent.ToolDowngraded -> update { it.copy(toolDowngraded = true, runtimeStatus = event.reason) }
                        is RuntimeEvent.Artifact -> receiveArtifact(activeConversation.id, assistantMessageId, event.attachment)
                        RuntimeEvent.Completed -> finishRun(activeConversation.id)
                        RuntimeEvent.Paused -> { reloadMessages(activeConversation.id); update { it.copy(streaming = false, runtimeStatus = null, error = "任务已在后台暂停，可点击重试继续") } }
                        is RuntimeEvent.Failed -> { reloadMessages(activeConversation.id); update { it.copy(streaming = false, runtimeStatus = null, error = event.message) } }
                    }
                }
            } catch (error: kotlinx.coroutines.CancellationException) {
                update { it.copy(streaming = false, runtimeStatus = null) }
            } catch (error: Throwable) {
                update { it.copy(streaming = false, runtimeStatus = null, error = error.message ?: "附件发送失败") }
            } finally {
                activeRunId = null
                activeRunSource = "local"
            }
        }
    }

    private fun updateDraft(id: String, transform: (AttachmentDraft) -> AttachmentDraft) = update { state ->
        state.copy(attachmentDrafts = state.attachmentDrafts.map { if (it.id == id) transform(it) else it })
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
        update { state ->
            state.copy(messages = state.messages.map { message ->
                if (message.id == messageId) {
                    message.copy(attachments = message.attachments.filterNot { it.id == attachment.id } + attachment)
                } else message
            })
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
        update { it.copy(streaming = false, runtimeStatus = null) }
    }

    private suspend fun reloadMessages(conversationId: String) {
        val messages = loadMessages(conversationId)
        update { it.copy(messages = messages) }
    }

    fun stop() {
        activeRunId?.let { runId ->
            if (activeRunSource == "platform") platformRuntime.stop(runId) else runtime.stop(runId)
        }
        if (activeRunId == null) runJob?.cancel()
        update { it.copy(runtimeStatus = "正在停止…") }
    }

    fun pauseForBackground() {
        if (!mutableState.value.streaming) return
        activeRunId?.let { runId ->
            if (activeRunSource == "platform") platformRuntime.pause(runId) else runtime.pause(runId)
        }
    }

    fun retry() {
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
            val localAgent = localAgentFor(mutableState.value.models)
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
            update { it.copy(agents = agents, selectedAgent = selected, agentCatalogStatus = catalog.status) }
        }
    }

    fun openConversation(id: String) = viewModelScope.launch(Dispatchers.IO) {
        if (mutableState.value.streaming) return@launch
        val conversation = mutableState.value.conversations.firstOrNull { it.id == id } ?: return@launch
        val messages = loadMessages(id)
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
        update { it.copy(currentConversation = conversation, selectedAgent = agent, messages = messages, historyOpen = false, error = null) }
    }

    fun toggleHistory(open: Boolean) = update { it.copy(historyOpen = open) }
    fun toggleProfile(open: Boolean) = update { it.copy(profileOpen = open) }
    fun setTheme(value: Boolean?) = update { it.copy(darkTheme = value) }

    fun logout() {
        val remoteSubject = mutableState.value.user?.id
        remoteSubject?.let(RemoteSubscriptionRegistry::cancelSubject)
        activeRunId?.let { runId ->
            if (activeRunSource == "platform") platformRuntime.stop(runId) else runtime.stop(runId)
        }
        runJob?.cancel()
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

    private fun toConversation(entity: ConversationEntity) = Conversation(
        id = entity.id,
        title = entity.title,
        updatedAt = entity.updatedAt,
        agentId = entity.agentId,
        agentName = entity.agentName,
        agentSource = entity.agentSource,
        modelId = entity.modelId,
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
