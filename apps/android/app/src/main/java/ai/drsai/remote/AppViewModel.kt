package ai.drsai.remote

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import ai.drsai.remote.data.AppDestination
import ai.drsai.remote.data.AppState
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.LocalAgentRuntime
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.OidcLoginSession
import ai.drsai.remote.data.OidcTransactionStore
import ai.drsai.remote.data.OIDC_LEGACY_CLIENT_ID
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.sanitizeLegacyAssistantText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.util.UUID

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val tokenStore by lazy { SecureTokenStore(app) }
    private val oidcTransactions by lazy { OidcTransactionStore(app) }
    private val database by lazy {
        Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(MIGRATION_1_2)
            .build()
    }
    private val oidcClient by lazy { OidcClient(refreshClientId = { tokenStore.oidcClientId }) }
    private val modelClient by lazy { HaiModelClient(tokenStore, oidcClient) }
    private val runtime by lazy { LocalAgentRuntime(modelClient, database.dao()) }
    private val mutableState = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = mutableState.asStateFlow()

    private var loginJob: Job? = null
    private var oidcSession: OidcLoginSession? = null
    private var runJob: Job? = null
    private var activeRunId: String? = null
    private var streamText = ""

    init { bootstrap() }

    private fun update(transform: (AppState) -> AppState) {
        mutableState.value = transform(mutableState.value)
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
        if (modelResult.isFailure) {
            val error = modelResult.exceptionOrNull()
            update { it.copy(loading = false, error = error?.message ?: "无法加载 HAI 模型") }
            return@launch
        }
        val models = modelResult.getOrThrow()
        val selected = tokenStore.selectedModelId?.let { saved -> models.firstOrNull { it.id == saved } }
            ?: runCatching { modelClient.selectModel(models) }.getOrNull()
        if (selected == null) {
            update { it.copy(loading = false, error = "当前 HAI 账号没有可用模型") }
            return@launch
        }
        tokenStore.selectedModelId = selected.id
        val entities = database.dao().conversationSnapshot(user.id)
        val conversations = entities.map(::toConversation)
        val current = conversations.firstOrNull()
        val messages = current?.let { loadMessages(it.id) }.orEmpty()
        update {
            it.copy(
                agents = listOf(DEFAULT_AGENT),
                selectedAgent = DEFAULT_AGENT,
                models = models,
                selectedModel = selected,
                conversations = conversations,
                currentConversation = current,
                messages = messages,
                loading = false,
            )
        }
    }

    fun send(text: String) = sendMessage(text)

    private fun sendMessage(text: String) {
        val clean = text.trim()
        val snapshot = mutableState.value
        val user = snapshot.user ?: return
        val model = snapshot.selectedModel ?: return
        if (clean.isEmpty() || snapshot.streaming) return
        if (clean.length > 16_000) {
            update { it.copy(error = "单条消息不能超过 16,000 字符") }
            return
        }
        runJob = viewModelScope.launch {
            var conversation = snapshot.currentConversation
            if (conversation == null) {
                val now = System.currentTimeMillis()
                conversation = Conversation(
                    id = UUID.randomUUID().toString(),
                    title = clean.replace('\n', ' ').take(32),
                    modelId = model.id,
                    updatedAt = now,
                )
                database.dao().saveConversation(toEntity(conversation, user.id, now))
                update { it.copy(currentConversation = conversation, conversations = listOf(conversation) + it.conversations) }
            }
            val activeConversation = conversation ?: return@launch
            val optimisticUser = ChatMessage(UUID.randomUUID().toString(), activeConversation.id, "user", clean)
            val optimisticAssistant = ChatMessage(UUID.randomUUID().toString(), activeConversation.id, "assistant", "", status = "streaming")
            streamText = ""
            update {
                it.copy(
                    messages = it.messages + optimisticUser + optimisticAssistant,
                    streaming = true,
                    // The empty streaming assistant message already renders the thinking state.
                    // Keep the runtime banner for tool execution and lifecycle notices only.
                    runtimeStatus = null,
                    error = null,
                )
            }
            runtime.run(user.id, activeConversation, clean).collect { event ->
                when (event) {
                    is RuntimeEvent.Started -> activeRunId = event.runId
                    is RuntimeEvent.TextDelta -> {
                        streamText += event.text
                        replaceLast(streamText)
                        update { it.copy(runtimeStatus = null) }
                    }
                    is RuntimeEvent.ToolStarted -> update { it.copy(runtimeStatus = toolLabel(event.name)) }
                    is RuntimeEvent.ToolFinished -> update { it.copy(runtimeStatus = "正在整理工具结果…") }
                    is RuntimeEvent.ToolDowngraded -> update { it.copy(toolDowngraded = true, runtimeStatus = event.reason) }
                    RuntimeEvent.Completed -> finishRun(activeConversation.id)
                    RuntimeEvent.Paused -> {
                        reloadMessages(activeConversation.id)
                        update { it.copy(streaming = false, runtimeStatus = null, error = "任务已在后台暂停，可点击重试继续") }
                    }
                    is RuntimeEvent.Failed -> {
                        reloadMessages(activeConversation.id)
                        update { it.copy(streaming = false, runtimeStatus = null, error = event.message) }
                    }
                }
            }
            activeRunId = null
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
        activeRunId?.let(runtime::stop)
        update { it.copy(runtimeStatus = "正在停止…") }
    }

    fun pauseForBackground() {
        if (!mutableState.value.streaming) return
        activeRunId?.let(runtime::pause)
    }

    fun retry() {
        val text = mutableState.value.messages.lastOrNull { it.role == "user" }?.text ?: return
        update { it.copy(error = null) }
        sendMessage(text)
    }

    fun newConversation() = update {
        if (it.streaming) it else it.copy(currentConversation = null, messages = emptyList(), historyOpen = false, error = null)
    }

    fun openConversation(id: String) = viewModelScope.launch(Dispatchers.IO) {
        if (mutableState.value.streaming) return@launch
        val conversation = mutableState.value.conversations.firstOrNull { it.id == id } ?: return@launch
        val messages = loadMessages(id)
        update { it.copy(currentConversation = conversation, messages = messages, historyOpen = false, error = null) }
    }

    fun toggleHistory(open: Boolean) = update { it.copy(historyOpen = open) }
    fun toggleProfile(open: Boolean) = update { it.copy(profileOpen = open) }
    fun setTheme(value: Boolean?) = update { it.copy(darkTheme = value) }

    fun logout() {
        activeRunId?.let(runtime::stop)
        runJob?.cancel()
        runJob = null
        activeRunId = null
        oidcClient.cancel(oidcSession)
        oidcTransactions.clear()
        loginJob?.cancel()
        viewModelScope.launch {
            runCatching { modelClient.logout() }
            tokenStore.clear()
            update { AppState(destination = AppDestination.Login) }
        }
    }

    private suspend fun loadMessages(id: String) = database.dao().visibleMessageSnapshot(id).map {
        ChatMessage(
            it.id,
            it.conversationId,
            it.role,
            sanitizeLegacyAssistantText(it.role, it.content),
            it.createdAt,
            it.status,
        )
    }

    private fun toConversation(entity: ConversationEntity) = Conversation(
        entity.id, entity.title, entity.updatedAt, entity.agentId, entity.modelId,
    )

    private fun toEntity(conversation: Conversation, userId: String, createdAt: Long) = ConversationEntity(
        conversation.id, userId, conversation.title, conversation.agentId, conversation.modelId, createdAt, conversation.updatedAt,
    )

    private fun toolLabel(name: String) = when (name) {
        "get_current_time" -> "正在读取当前时间…"
        "save_memory" -> "正在保存本地记忆…"
        "search_memory" -> "正在查询本地记忆…"
        else -> "正在使用本地工具…"
    }
}
