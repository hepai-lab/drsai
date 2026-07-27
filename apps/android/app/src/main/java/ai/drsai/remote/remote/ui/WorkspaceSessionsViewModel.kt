package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.room.Room
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.collectAllPages
import ai.drsai.remote.remote.data.HttpOwopRelayTransport
import ai.drsai.remote.remote.data.RelayWorkspaceOperationsClient
import ai.drsai.remote.remote.data.RemoteProjectInstructionLoader
import ai.drsai.remote.remote.data.WorkspaceInstructionVersionStore
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.RoomRemoteDirectoryCache
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal fun normalizedWorkspaceSessionQuery(query: String?): String? =
    query?.trim()?.takeIf(String::isNotEmpty)

class WorkspaceSessionsViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
    runtimeName: String,
    workspaceName: String,
) : AndroidViewModel(app) {
    private val tokenStore = SecureTokenStore(app)
    private val auth = AccessTokenCoordinator(tokenStore, OidcClient(refreshClientId = { tokenStore.oidcClientId }))
    private val deviceProof = androidRelayDeviceProof(app)
    private val repository = RelayRemoteRepository(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        refreshAfter = auth::refreshAfter,
        deviceProof = deviceProof,
    )
    private val instructionLoader = RemoteProjectInstructionLoader(
        RelayWorkspaceOperationsClient(
            HttpOwopRelayTransport(
                BuildConfig.RELAY_BASE_URL,
                runtimeId,
                auth::current,
                deviceProof = deviceProof,
            )
        ),
    )
    private val instructionVersionStore = WorkspaceInstructionVersionStore(app)
    private val database = Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
        .addMigrations(
            MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
            MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8,
        )
        .build()
    private val directoryCache = RoomRemoteDirectoryCache(database)
    private val mutableState = MutableStateFlow(
        WorkspaceSessionsUiState(runtimeName = runtimeName, workspaceName = workspaceName, loading = true),
    )
    val state: StateFlow<WorkspaceSessionsUiState> = mutableState.asStateFlow()
    private val generation = AtomicLong(0)
    private var searchJob: Job? = null
    private var acceptedInstructionVersions: Map<String, String>? = tokenStore.user()?.id?.let { subject ->
        instructionVersionStore.accepted(subject, runtimeId, workspaceId)
    }

    init {
        AndroidDevicePresence.markAccessing(runtimeId)
        refresh()
    }

    fun refresh(query: String? = mutableState.value.query) = viewModelScope.launch(Dispatchers.IO) {
        val requestGeneration = generation.incrementAndGet()
        val normalizedQuery = normalizedWorkspaceSessionQuery(query)
        mutableState.update { it.copy(loading = true, error = null) }
        runCatching {
            coroutineScope {
                val definitions = async { repository.agentDefinitions(runtimeId) }
                val sessions = async {
                    collectAllPages { cursor ->
                        repository.sessions(runtimeId, workspaceId, cursor, normalizedQuery)
                    }
                }
                val approvals = async { repository.approvals(runtimeId, workspaceId) }
                val instructions = async { runCatching { instructionLoader.load(workspaceId) } }
                RefreshPayload(definitions.await(), sessions.await(), approvals.await(), instructions.await())
            }
        }.onSuccess { payload ->
            if (requestGeneration == generation.get()) {
                val sessionItems = payload.sessions.map { summary ->
                    require(summary.reference.runtimeId == runtimeId && summary.reference.workspaceId == workspaceId) {
                        "remote_session_scope_mismatch"
                    }
                    RemoteSessionUi(
                        reference = summary.reference,
                        lastRunStatus = summary.lastRunStatus,
                        updatedAtLabel = summary.updatedAt,
                        lifecycle = summary.lifecycle,
                    )
                }
                val instructionVersions = payload.instructions.getOrNull().orEmpty().associate { fragment ->
                    fragment.source to fragment.version.orEmpty()
                }
                val instructionRefreshRequired = payload.instructions.isSuccess &&
                    acceptedInstructionVersions?.let { it != instructionVersions } == true
                if (acceptedInstructionVersions == null && payload.instructions.isSuccess) {
                    acceptedInstructionVersions = instructionVersions
                    tokenStore.user()?.id?.let { subject ->
                        instructionVersionStore.accept(subject, runtimeId, workspaceId, instructionVersions)
                    }
                }
                val instructionStatus = payload.instructions.fold(
                    onSuccess = { values -> when {
                        instructionRefreshRequired -> "项目指令版本已变化，请确认后再新建会话"
                        values.isEmpty() -> "未发现项目指令"
                        else -> "已校验 ${values.size} 份项目指令"
                    } },
                    onFailure = { failure -> "项目指令不可读取：${failure.message}" },
                )
                mutableState.update { it.copy(agentDefinitions = payload.definitions, sessions = sessionItems,
                    capabilities = listOf(
                        RemoteCapabilityUi("Files", payload.definitions.any { definition -> definition.capabilities.any { cap -> cap.startsWith("files") || cap == "workspace.read" } }),
                        RemoteCapabilityUi("Git", payload.definitions.any { definition -> definition.capabilities.any { cap -> cap.startsWith("git") || cap == "workspace.read" } }),
                    ),
                    pendingApprovalCount = payload.approvals.count { approval -> approval.status == "pending" },
                    instructionVersions = instructionVersions,
                    instructionStatus = instructionStatus,
                    instructionRefreshRequired = instructionRefreshRequired,
                    query = normalizedQuery.orEmpty(), loading = false, creating = false) }
            }
        }.onFailure { failure ->
            if (requestGeneration == generation.get()) {
                if (failure is RelayHttpException && failure.status == 403) {
                    tokenStore.user()?.id?.let { subject ->
                        directoryCache.removeRuntime(subject, "", runtimeId)
                    }
                }
                mutableState.update {
                    it.copy(
                        loading = false,
                        sessions = if (failure is RelayHttpException && failure.status == 403) {
                            emptyList()
                        } else {
                            it.sessions
                        },
                        error = if (failure is RelayHttpException && failure.status == 403) {
                            "当前设备已无权访问此远程主机"
                        } else {
                            failure.message ?: "会话加载失败"
                        },
                    )
                }
            }
        }
    }

    fun confirmInstructionRefresh() {
        acceptedInstructionVersions = mutableState.value.instructionVersions
        tokenStore.user()?.id?.let { subject ->
            instructionVersionStore.accept(subject, runtimeId, workspaceId, mutableState.value.instructionVersions)
        }
        mutableState.update {
            it.copy(
                instructionRefreshRequired = false,
                instructionStatus = if (it.instructionVersions.isEmpty()) "未发现项目指令" else "已确认最新项目指令",
            )
        }
    }

    private data class RefreshPayload(
        val definitions: List<RemoteAgentDefinition>,
        val sessions: List<ai.drsai.remote.remote.data.RemoteSessionSummary>,
        val approvals: List<ai.drsai.remote.remote.data.RemoteApprovalRecord>,
        val instructions: Result<List<PromptFragment>>,
    )

    fun search(query: String) {
        generation.incrementAndGet()
        mutableState.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(250)
            refresh(query)
        }
    }

    fun createSession(definition: RemoteAgentDefinition) = viewModelScope.launch(Dispatchers.IO) {
        require(definition.version != "latest") { "exact_agent_definition_required" }
        require(!mutableState.value.instructionRefreshRequired) { "project_instruction_refresh_required" }
        mutableState.update { it.copy(creating = true, error = null) }
        runCatching {
            repository.createSession(
                runtimeId = runtimeId,
                workspaceId = workspaceId,
                title = "新会话",
                definition = definition,
                idempotencyKey = java.util.UUID.randomUUID().toString(),
            )
        }.onSuccess { refresh() }
            .onFailure { failure ->
                mutableState.update { it.copy(creating = false, error = failure.message ?: "会话创建失败") }
            }
    }

    override fun onCleared() {
        database.close()
        super.onCleared()
    }

    companion object {
        fun factory(
            app: Application,
            runtimeId: RuntimeId,
            workspaceId: WorkspaceId,
            runtimeName: String,
            workspaceName: String,
        ): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                WorkspaceSessionsViewModel(app, runtimeId, workspaceId, runtimeName, workspaceName) as T
        }
    }
}
