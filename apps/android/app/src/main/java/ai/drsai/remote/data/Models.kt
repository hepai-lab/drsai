package ai.drsai.remote.data

import ai.drsai.remote.BuildConfig
import ai.drsai.remote.remote.model.RemoteTranscriptMessage
import ai.drsai.remote.remote.model.OaepTimelineEntry
import org.json.JSONObject

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

data class ModelInfo(
    val id: String,
    val name: String = id,
    val vision: Boolean = false,
    val tools: Boolean = false,
    val providerId: String = "hepai",
    val upstreamId: String = id,
    val reasoning: Boolean = false,
    val contextTokens: Int? = null,
    val maxOutputTokens: Int? = null,
    val enabled: Boolean = true,
    val source: String = "MANUAL",
)

internal val DEFAULT_HEPAI_MODEL_IDS = listOf(
    "deepseek-ai/deepseek-v4-pro",
    "deepseek-ai/deepseek-v4-flash",
)

internal fun retainDefaultHepaiModels(models: List<ModelInfo>): List<ModelInfo> = DEFAULT_HEPAI_MODEL_IDS.mapNotNull { id ->
    models.firstOrNull { model -> model.id == id || model.upstreamId == id }
}

internal fun orderPreferredDeepseekModels(models: List<ModelInfo>): List<ModelInfo> = models.sortedBy { model ->
    when (model.upstreamId.substringAfterLast('/')) {
        "deepseek-v4-pro" -> 0
        "deepseek-v4-flash" -> 1
        else -> 2
    }
}

data class ModelProviderConfig(
    val id: String,
    val name: String,
    val baseUrl: String,
    val modelIds: List<String>,
    val builtIn: Boolean = false,
    val presetId: String? = null,
    val wireApi: String = "openai",
    val hasApiKey: Boolean = false,
    val revision: Long = 1,
    val connectionStatus: String = "UNCHECKED",
    val lastCheckedAt: Long? = null,
)

data class ModelDiscoveryMerge(
    val models: List<ModelInfo>,
    val added: Int,
    val retained: Int,
    val missing: Int,
)

internal fun mergeDiscoveredModels(current: List<ModelInfo>, discoveredIds: List<String>): ModelDiscoveryMerge {
    val existing = current.associateBy { it.upstreamId.lowercase() }
    val remote = discoveredIds.map(String::trim).filter(String::isNotBlank).distinctBy(String::lowercase)
    val remoteKeys = remote.mapTo(linkedSetOf()) { it.lowercase() }
    val discovered = remote.map { upstream ->
        existing[upstream.lowercase()] ?: JSONObject().put("id", upstream).let { row ->
            ModelInfo(
                "", upstream,
                vision = modelSupportsVision(row, upstream, upstream),
                tools = modelSupportsTools(row, upstream, upstream),
                upstreamId = upstream,
                source = "DISCOVERED",
            )
        }
    }
    return ModelDiscoveryMerge(
        models = discovered + current.filterNot { it.upstreamId.lowercase() in remoteKeys },
        added = remoteKeys.count { it !in existing },
        retained = remoteKeys.count { it in existing },
        missing = existing.keys.count { it !in remoteKeys },
    )
}

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
    val attachments: List<MessageAttachment> = emptyList(),
)

enum class AttachmentStatus {
    SELECTED, PREPARING, READY, UPLOADING, UPLOADED, SENDING, SENT, FAILED, CANCELLED, EXPIRED,
}

data class AttachmentDraft(
    val id: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val kind: String,
    val localPath: String,
    val thumbnailPath: String? = null,
    val sha256: String = "",
    val remoteId: String? = null,
    val status: AttachmentStatus = AttachmentStatus.SELECTED,
    val progress: Int = 0,
    val error: String? = null,
)

data class MessageAttachment(
    val id: String,
    val messageId: String,
    val conversationId: String,
    val remoteId: String? = null,
    val name: String,
    val mimeType: String,
    val size: Long,
    val kind: String,
    val localPath: String? = null,
    val thumbnailPath: String? = null,
    val sha256: String = "",
    val status: String = "sent",
    val createdAt: Long = System.currentTimeMillis(),
)

data class RemoteAttachment(
    val id: String,
    val name: String,
    val kind: String,
    val mimeType: String,
    val size: Long,
    val sha256: String,
    val processingStatus: String,
    val expiresAt: String? = null,
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
    val images: List<RuntimeImage> = emptyList(),
)

data class RuntimeImage(val mimeType: String, val dataUrl: String)

data class CompletedToolCall(val id: String, val name: String, val arguments: String)
data class ToolCallDelta(val index: Int, val id: String?, val name: String?, val arguments: String)
data class ModelDelta(
    val content: String?,
    val toolCalls: List<ToolCallDelta>,
    val finishReason: String?,
    val reasoningSummary: String? = null,
)

sealed interface RuntimeEvent {
    data class Started(val runId: String) : RuntimeEvent
    data class TextDelta(val text: String) : RuntimeEvent
    data class ToolStarted(val name: String) : RuntimeEvent
    data class ToolFinished(val name: String) : RuntimeEvent
    data class ToolFailed(val name: String, val code: String) : RuntimeEvent
    data class ToolDowngraded(val reason: String) : RuntimeEvent
    data class Artifact(val attachment: RemoteAttachment) : RuntimeEvent
    data object Completed : RuntimeEvent
    data object Paused : RuntimeEvent
    data object Cancelled : RuntimeEvent
    data class Failed(val message: String, val retryable: Boolean = true) : RuntimeEvent
}

val DEFAULT_AGENT = Agent(
    id = "local:opendrsai",
    name = "OpenDrSai",
    description = if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) {
        "运行在 Android 本机、已通过 Desktop 能力对等验收的 Agent Runtime"
    } else {
        "运行在 Android 本机的 Android Agent Runtime Preview（Desktop 能力对等尚未完成）"
    },
    systemPrompt = """
        You are OpenDrSai for Android, a concise and capable personal AI agent.
        Reply in the user's language. Use local tools only when they materially help.
        Never claim to have shell, arbitrary file, browser, location, contacts, or device-control access.
        Ask before storing sensitive personal information. Do not expose tool JSON to the user.
    """.trimIndent(),
    capabilities = setOf("chat", "local-tools", "memory", "attachment-upload", "document-input", "safe-device-info", "web-search", "web-fetch"),
)

internal fun localAgentFor(models: List<ModelInfo>): Agent = DEFAULT_AGENT.copy(
    capabilities = DEFAULT_AGENT.capabilities + if (models.any(ModelInfo::vision)) setOf("image-input") else emptySet(),
)

internal fun selectLocalModelForAttachments(
    models: List<ModelInfo>,
    selected: ModelInfo?,
    conversationModelId: String?,
    requiresVision: Boolean,
): ModelInfo? {
    val conversationModel = conversationModelId?.let { id -> models.firstOrNull { it.id == id } }
    val preferred = conversationModel ?: selected
    return if (requiresVision) selectVisionModel(models, preferred) else preferred
}

data class AgentCatalogStatus(
    val state: String = "loading",
    val message: String = "正在加载平台智能体",
    val apiVersion: String? = null,
    val capabilities: Set<String> = emptySet(),
    val cached: Boolean = false,
)

data class ApprovalUiItem(
    val id: String,
    val operation: String,
    val scope: String,
    val runtimeId: String,
    val sessionId: String,
    val expiresAt: String,
)

data class WorkbenchSessionItem(
    val sessionId: String,
    val runtimeId: String,
    val workspaceId: String,
    val title: String,
    val local: Boolean,
    val pinned: Boolean,
    val unread: Boolean,
    val updatedAt: Long,
    val runtimeStatus: String = "IDLE",
)

data class WorkbenchWorkspaceItem(
    val key: String,
    val runtimeId: String,
    val workspaceId: String,
    val displayName: String,
    val local: Boolean,
    val sessions: List<WorkbenchSessionItem>,
    val connectionStatus: String = if (local) "local" else "offline",
    val sessionHasMore: Boolean = false,
)

data class MemoryUiItem(val id: Long, val content: String)

data class SkillUiItem(
    val id: String,
    val name: String,
    val version: Int,
    val source: String,
    val available: Boolean,
    val permissions: String,
    val userManaged: Boolean = false,
    val enabled: Boolean = available,
)

data class ConnectorUiItem(
    val id: String,
    val url: String,
    val enabled: Boolean,
    val scopes: List<String>,
    val expiresAtEpochMs: Long?,
)

data class WorkbenchArtifactItem(
    val id: String,
    val name: String,
    val mimeType: String,
    val size: Long,
    val sessionId: String,
    val runId: String? = null,
    val source: String,
)

data class DesktopHandoffUi(
    val handoffId: String,
    val targetRuntimeId: String,
    val targetName: String,
    val requiredCapabilities: List<String>,
    val message: String,
    val executionLocation: String = "Desktop Runtime",
    val transport: String? = null,
    val resourceId: String? = null,
)

data class WorkbenchSearchItem(
    val session: WorkbenchSessionItem,
    val snippet: String,
    val messageMatch: Boolean,
)

data class RuntimeDiagnosticUi(
    val code: String,
    val userAction: String,
    val runId: String?,
    val requestId: String?,
    val details: String,
) {
    fun exportText(): String = buildString {
        append("OpenDrSai Android diagnostic\n")
        append("code=").append(code).append('\n')
        append("action=").append(userAction).append('\n')
        runId?.let { append("run_id=").append(it).append('\n') }
        requestId?.let { append("request_id=").append(it).append('\n') }
        append("details=").append(details)
    }
}

data class OaepDiagnosticEventUi(
    val eventId: String,
    val sequence: Long,
    val type: String,
    val timestamp: String,
    val runId: String?,
    val itemId: String?,
    val source: String,
    val errorCode: String? = null,
    val errorMessage: String? = null,
)

/** Keeps the current model when it is still enabled, otherwise chooses the first enabled model. */
internal fun selectAvailableConfiguredModel(models: List<ModelInfo>, currentModelId: String?): ModelInfo? =
    currentModelId?.let { id -> models.firstOrNull { model ->
        model.enabled && (
            model.id == id ||
                "${model.providerId}/${model.upstreamId}" == id ||
                "${model.providerId}:${model.upstreamId}" == id
            )
    } }
        ?: models.firstOrNull { it.enabled }

data class FullRuntimeDiagnosticUi(
    val buildEnabled: Boolean = false,
    val desktopParityComplete: Boolean = false,
    val bindingState: String = "UNINITIALIZED",
    val health: String = "NOT_READY",
    val process: String = ":runtime",
    val bindReason: String? = null,
    val bindLatencyMs: Long? = null,
    val starts: Long = 0,
    val bindAttempts: Long = 0,
    val bindSuccesses: Long = 0,
    val safeFallbacks: Long = 0,
    val route: String = if (BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE) "Full Local" else "Local Preview",
    val availableTools: List<String> = emptyList(),
    val permissionRequiredTools: List<String> = emptyList(),
    val modelUnsupportedTools: List<String> = emptyList(),
    val availableSkills: List<String> = emptyList(),
    val permissionRequiredSkills: List<String> = emptyList(),
    val kotlinFallbackAvailable: Boolean = false,
    val kernelVersion: String? = null,
    val kernelSha256: String? = null,
    val promptVersion: String? = null,
    val promptSha256: String? = null,
    val toolManifestVersion: String? = null,
    val skillManifestVersion: String? = null,
    val skillManifestSha256: String? = null,
    val capabilityManifestVersion: String? = null,
    val capabilityManifestSha256: String? = null,
    val hostPortProtocolVersion: String? = null,
    val modelToolSnapshotVersion: String? = null,
    val modelCapabilityStatus: String? = null,
    val modelCapabilitySource: String? = null,
    val modelCapabilityDigest: String? = null,
    val modelSupportsTools: Boolean? = null,
    val modelSupportsParallelTools: Boolean? = null,
    val modelSupportsReasoning: Boolean? = null,
) {
    fun exportText(): String = buildString {
        append("OpenDrSai Android Full Runtime diagnostic\n")
        append("build_enabled=").append(buildEnabled).append('\n')
        append("desktop_parity_complete=").append(desktopParityComplete).append('\n')
        append("binding=").append(bindingState).append('\n')
        append("health=").append(health).append('\n')
        append("process=").append(process).append('\n')
        append("route=").append(route).append('\n')
        append("starts=").append(starts).append('\n')
        append("bind_attempts=").append(bindAttempts).append('\n')
        append("bind_successes=").append(bindSuccesses).append('\n')
        append("safe_fallbacks=").append(safeFallbacks).append('\n')
        append("kotlin_fallback_available=").append(kotlinFallbackAvailable).append('\n')
        bindLatencyMs?.let { append("bind_latency_ms=").append(it).append('\n') }
        bindReason?.let { append("reason=").append(it).append('\n') }
        kernelVersion?.let { append("kernel_version=").append(it).append('\n') }
        kernelSha256?.let { append("kernel_sha256=").append(it).append('\n') }
        promptVersion?.let { append("prompt_version=").append(it).append('\n') }
        promptSha256?.let { append("prompt_sha256=").append(it).append('\n') }
        toolManifestVersion?.let { append("tool_manifest_version=").append(it).append('\n') }
        skillManifestVersion?.let { append("skill_manifest_version=").append(it).append('\n') }
        skillManifestSha256?.let { append("skill_manifest_sha256=").append(it).append('\n') }
        capabilityManifestVersion?.let { append("capability_manifest_version=").append(it).append('\n') }
        capabilityManifestSha256?.let { append("capability_manifest_sha256=").append(it).append('\n') }
        hostPortProtocolVersion?.let { append("host_port_protocol_version=").append(it).append('\n') }
        modelToolSnapshotVersion?.let { append("model_tool_snapshot_version=").append(it).append('\n') }
        modelCapabilityStatus?.let { append("model_capability_status=").append(it).append('\n') }
        modelCapabilitySource?.let { append("model_capability_source=").append(it).append('\n') }
        modelCapabilityDigest?.let { append("model_capability_digest=").append(it).append('\n') }
        modelSupportsTools?.let { append("model_supports_tools=").append(it).append('\n') }
        modelSupportsParallelTools?.let { append("model_supports_parallel_tools=").append(it).append('\n') }
        modelSupportsReasoning?.let { append("model_supports_reasoning=").append(it).append('\n') }
        append("available_tools=").append(availableTools.joinToString(",")).append('\n')
        append("permission_required_tools=").append(permissionRequiredTools.joinToString(",")).append('\n')
        append("model_unsupported_tools=").append(modelUnsupportedTools.joinToString(",")).append('\n')
        append("available_skills=").append(availableSkills.joinToString(",")).append('\n')
        append("permission_required_skills=").append(permissionRequiredSkills.joinToString(","))
    }
}

sealed interface AppDestination {
    data object Splash : AppDestination
    data object Login : AppDestination
    data object Chat : AppDestination
}

enum class AssociationState { IDLE, PENDING_LOGIN, ASSOCIATING, ASSOCIATED, AUTH_REQUIRED, FAILED }

data class AppState(
    val destination: AppDestination = AppDestination.Splash,
    val user: User? = null,
    val agents: List<Agent> = listOf(DEFAULT_AGENT),
    val selectedAgent: Agent? = DEFAULT_AGENT,
    val models: List<ModelInfo> = emptyList(),
    val selectedModel: ModelInfo? = null,
    val modelProviders: List<ModelProviderConfig> = emptyList(),
    val configuredProviderModels: List<ModelInfo> = emptyList(),
    val discoveredProviderModels: List<String> = emptyList(),
    val modelConfigurationBusy: Boolean = false,
    val modelConfigurationMessage: String? = null,
    val conversations: List<Conversation> = emptyList(),
    val currentConversation: Conversation? = null,
    val messages: List<ChatMessage> = emptyList(),
    val oaepTranscript: List<RemoteTranscriptMessage> = emptyList(),
    val oaepTimeline: List<OaepTimelineEntry> = emptyList(),
    val oaepRunStatus: String? = null,
    val oaepActiveRunId: String? = null,
    val oaepSnapshotSequence: Long = 0,
    val oaepDiagnosticEvents: List<OaepDiagnosticEventUi> = emptyList(),
    val streaming: Boolean = false,
    val recovering: Boolean = false,
    val loading: Boolean = false,
    val loginUrl: String? = null,
    val waitingForLogin: Boolean = false,
    val historyOpen: Boolean = false,
    val profileOpen: Boolean = false,
    val error: String? = null,
    val diagnostic: RuntimeDiagnosticUi? = null,
    val runtimeStatus: String? = null,
    val runtimePolicyDiagnostic: RuntimePolicyDiagnosticUi? = null,
    val fullRuntimeDiagnostic: FullRuntimeDiagnosticUi = FullRuntimeDiagnosticUi(),
    val toolDowngraded: Boolean = false,
    val agentCatalogStatus: AgentCatalogStatus = AgentCatalogStatus(),
    val darkTheme: Boolean? = null,
    val attachmentDrafts: List<AttachmentDraft> = emptyList(),
    val pendingApprovals: List<ApprovalUiItem> = emptyList(),
    val localWorkspaceGranted: Boolean = false,
    val workbenchWorkspaces: List<WorkbenchWorkspaceItem> = emptyList(),
    val memories: List<MemoryUiItem> = emptyList(),
    val memoryEnabled: Boolean = true,
    val archivedSessions: List<WorkbenchSessionItem> = emptyList(),
    val workbenchSearchResults: List<WorkbenchSearchItem> = emptyList(),
    val workbenchArtifacts: List<WorkbenchArtifactItem> = emptyList(),
    val pendingDesktopHandoff: DesktopHandoffUi? = null,
    val skills: List<SkillUiItem> = emptyList(),
    val connectors: List<ConnectorUiItem> = emptyList(),
    val requestedRoutePath: String? = null,
    val requestedRemoteItemId: String? = null,
    val workbenchSessionLimits: Map<String, Int> = emptyMap(),
    val associationState: AssociationState = AssociationState.IDLE,
)

data class RuntimePolicyDiagnosticUi(
    val status: String,
    val policyVersion: String?,
    val reason: String?,
    val rolloutPercent: Int?,
    val emergencyDisabled: Boolean?,
    val recordedAtEpochSeconds: Long,
)

internal fun sanitizeLegacyAssistantText(role: String, content: String): String {
    if (role != "assistant" || !content.startsWith("nullnull")) return content
    return content.replaceFirst(Regex("^(?:null)+"), "")
}
