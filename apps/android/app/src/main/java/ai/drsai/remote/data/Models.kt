package ai.drsai.remote.data

data class User(val id: String, val name: String = id, val avatarUrl: String? = null)

data class Agent(
    val id: String,
    val name: String,
    val description: String = "",
    val systemPrompt: String = "",
    val platformId: String? = null,
    val source: String = "local",
    val mode: String = "local",
    val available: Boolean = true,
    val chatSupported: Boolean = true,
    val isDefault: Boolean = false,
    val owner: String? = null,
    val capabilities: Set<String> = emptySet(),
    val logoUrl: String? = null,
    val examples: List<String> = emptyList(),
)

data class ModelInfo(val id: String, val name: String = id)

data class Conversation(
    val id: String,
    val title: String,
    val updatedAt: Long = System.currentTimeMillis(),
    val agentId: String = DEFAULT_AGENT.id,
    val agentName: String = DEFAULT_AGENT.name,
    val agentSource: String = DEFAULT_AGENT.source,
    val modelId: String = "",
)

data class ChatMessage(
    val id: String,
    val conversationId: String,
    val role: String,
    val text: String,
    val createdAt: Long = System.currentTimeMillis(),
    val status: String = "complete",
)

data class AuthTokens(val accessToken: String, val refreshToken: String, val user: User)

interface AuthTokenStore {
    var accessToken: String?
    var refreshToken: String?
    fun save(auth: AuthTokens)
}

interface TokenLifecycleClient {
    suspend fun refresh(refreshToken: String): AuthTokens
    suspend fun revoke(refreshToken: String)
}

data class RuntimeMessage(
    val role: String,
    val content: String,
    val toolCallId: String? = null,
    val toolCalls: List<CompletedToolCall> = emptyList(),
)

data class CompletedToolCall(val id: String, val name: String, val arguments: String)
data class ToolCallDelta(val index: Int, val id: String?, val name: String?, val arguments: String)
data class ModelDelta(val content: String?, val toolCalls: List<ToolCallDelta>, val finishReason: String?)

sealed interface RuntimeEvent {
    data class Started(val runId: String) : RuntimeEvent
    data class TextDelta(val text: String) : RuntimeEvent
    data class ToolStarted(val name: String) : RuntimeEvent
    data class ToolFinished(val name: String) : RuntimeEvent
    data class ToolDowngraded(val reason: String) : RuntimeEvent
    data object Completed : RuntimeEvent
    data object Paused : RuntimeEvent
    data class Failed(val message: String, val retryable: Boolean = true) : RuntimeEvent
}

val DEFAULT_AGENT = Agent(
    id = "local:opendrsai",
    name = "OpenDrSai",
    description = "运行在 Android 本机的轻量智能 Agent",
    systemPrompt = """
        You are OpenDrSai for Android, a concise and capable personal AI agent.
        Reply in the user's language. Use local tools only when they materially help.
        Never claim to have shell, arbitrary file, browser, location, contacts, or device-control access.
        Ask before storing sensitive personal information. Do not expose tool JSON to the user.
    """.trimIndent(),
    capabilities = setOf("chat", "local-tools", "memory"),
)

data class AgentCatalogStatus(
    val state: String = "loading",
    val message: String = "正在加载平台智能体",
    val apiVersion: String? = null,
    val capabilities: Set<String> = emptySet(),
    val cached: Boolean = false,
)

sealed interface AppDestination {
    data object Splash : AppDestination
    data object Login : AppDestination
    data object Chat : AppDestination
}

data class AppState(
    val destination: AppDestination = AppDestination.Splash,
    val user: User? = null,
    val agents: List<Agent> = listOf(DEFAULT_AGENT),
    val selectedAgent: Agent? = DEFAULT_AGENT,
    val models: List<ModelInfo> = emptyList(),
    val selectedModel: ModelInfo? = null,
    val conversations: List<Conversation> = emptyList(),
    val currentConversation: Conversation? = null,
    val messages: List<ChatMessage> = emptyList(),
    val streaming: Boolean = false,
    val loading: Boolean = false,
    val loginUrl: String? = null,
    val waitingForLogin: Boolean = false,
    val historyOpen: Boolean = false,
    val profileOpen: Boolean = false,
    val error: String? = null,
    val runtimeStatus: String? = null,
    val toolDowngraded: Boolean = false,
    val agentCatalogStatus: AgentCatalogStatus = AgentCatalogStatus(),
    val darkTheme: Boolean? = null,
)

internal fun sanitizeLegacyAssistantText(role: String, content: String): String {
    if (role != "assistant" || !content.startsWith("nullnull")) return content
    return content.replaceFirst(Regex("^(?:null)+"), "")
}
