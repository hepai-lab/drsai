package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.remote.data.RemoteWorkspaceContainer
import ai.drsai.remote.remote.data.RemoteAgentDefinition
import ai.drsai.remote.remote.data.collectAllPages
import ai.drsai.remote.remote.data.RemoteProjectInstructionLoader
import ai.drsai.remote.remote.data.WorkspaceInstructionVersionStore
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.remote.data.WorkspaceSessionCatalogDecision
import ai.drsai.remote.remote.data.WorkspaceSessionCatalogGate
import ai.drsai.remote.remote.data.WorkspaceSessionCatalogProjection
import ai.drsai.remote.remote.data.RemoteRetryPolicy
import ai.drsai.remote.remote.data.RemoteStreamRetryState
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.R
import ai.drsai.remote.ui.LocalizedText
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive

internal fun normalizedWorkspaceSessionQuery(query: String?): String? =
    query?.trim()?.takeIf(String::isNotEmpty)

class WorkspaceSessionsViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
    runtimeName: String,
    workspaceName: String,
) : AndroidViewModel(app) {
    private val container = RemoteWorkspaceContainer.get(app)
    private val time = container.time
    private val tokenStore = container.boundaries.auth.tokens
    private val sessions = container.boundaries.session.client
    private val approvals = container.boundaries.approval.client
    private val instructionLoader = RemoteProjectInstructionLoader(
        container.boundaries.file.client(runtimeId),
    )
    private val instructionVersionStore = WorkspaceInstructionVersionStore(app)
    private val directoryCache = container.directoryCache
    private val activity = container.activity
    private val connectivity = container.connectivity
    private val mutableState = MutableStateFlow(
        WorkspaceSessionsUiState(runtimeName = runtimeName, workspaceName = workspaceName, loading = true),
    )
    val state: StateFlow<WorkspaceSessionsUiState> = mutableState.asStateFlow()
    private val generation = AtomicLong(0)
    private var searchJob: Job? = null
    private var catalogJob: Job? = null
    @Volatile private var foreground = true
    private val lifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            foreground = true
            observeCatalog()
        }

        override fun onStop(owner: LifecycleOwner) {
            foreground = false
            catalogJob?.cancel()
        }
    }
    private val catalogGate = WorkspaceSessionCatalogGate()
    private var acceptedInstructionVersions: Map<String, String>? = tokenStore.user()?.id?.let { subject ->
        instructionVersionStore.accepted(subject, runtimeId, workspaceId)
    }

    init {
        AndroidDevicePresence.markAccessing(runtimeId)
        ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)
        refresh()
        observeCatalog()
        viewModelScope.launch {
            connectivity.state.collect { network ->
                if (foreground && network.online) observeCatalog() else catalogJob?.cancel()
            }
        }
    }

    private fun observeCatalog() {
        catalogJob?.cancel()
        if (!foreground || !connectivity.online.value) return
        catalogJob = viewModelScope.launch(Dispatchers.IO) {
            val retry = RemoteStreamRetryState(RemoteRetryPolicy())
            while (isActive && foreground && connectivity.online.value) {
                try {
                    container.boundaries.catalog.sessionEvents.workspaceSessionCatalogStream(runtimeId, workspaceId) {
                        refresh()
                    }.collect { event ->
                        retry.reset()
                        if (catalogGate.accept(event) == WorkspaceSessionCatalogDecision.APPLY) refresh()
                    }
                    throw java.io.EOFException("relay_workspace_catalog_sse_eof")
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    val retryMillis = retry.nextDelay(failure, time.monotonicNanos()) ?: break
                    time.waitFor(retryMillis)
                }
            }
        }
    }

    fun refresh(query: String? = mutableState.value.query) = viewModelScope.launch(Dispatchers.IO) {
        val requestGeneration = generation.incrementAndGet()
        val normalizedQuery = normalizedWorkspaceSessionQuery(query)
        mutableState.update { it.copy(loading = true, error = null, errorText = null) }
        runCatching {
            container.singleFlight.run("workspace:${runtimeId.value}:${workspaceId.value}:${normalizedQuery.orEmpty()}") {
                coroutineScope {
                    val definitions = async { sessions.agentDefinitions(runtimeId) }
                    val sessionPage = async {
                        collectAllPages { cursor ->
                            sessions.sessions(
                                runtimeId, workspaceId, cursor, normalizedQuery,
                                if (mutableState.value.showArchived) {
                                    ai.drsai.remote.remote.model.RemoteResourceLifecycle.ARCHIVED
                                } else ai.drsai.remote.remote.model.RemoteResourceLifecycle.ACTIVE,
                            )
                        }
                    }
                    val approvalPage = async { approvals.approvals(runtimeId, workspaceId) }
                    val instructions = async { runCatching { instructionLoader.load(workspaceId) } }
                    RefreshPayload(definitions.await(), sessionPage.await(), approvalPage.await(), instructions.await())
                }
            }
        }.onSuccess { payload ->
            if (requestGeneration == generation.get()) {
                val lifecycle = if (mutableState.value.showArchived) {
                    ai.drsai.remote.remote.model.RemoteResourceLifecycle.ARCHIVED
                } else ai.drsai.remote.remote.model.RemoteResourceLifecycle.ACTIVE
                val sessionItems = WorkspaceSessionCatalogProjection.project(
                    payload.sessions, runtimeId, workspaceId, lifecycle,
                ).map { summary ->
                    RemoteSessionUi(
                        reference = summary.reference,
                        lastRunStatus = summary.lastRunStatus,
                        updatedAtLabel = summary.updatedAt,
                        lifecycle = summary.lifecycle,
                        unreadTurns = tokenStore.user()?.id?.let { subject ->
                            activity.observeSession(subject, runtimeId.value, summary.reference.sessionId.value, summary.updatedAt)
                        } ?: 0,
                        pendingApprovals = payload.approvals.count { approval ->
                            approval.status == "pending" && approval.sessionId == summary.reference.sessionId
                        },
                        runningRuns = if (summary.lastRunStatus in setOf("queued", "running", "waiting_approval")) 1 else 0,
                    )
                }
                tokenStore.user()?.id?.let { subject ->
                    activity.saveWorkspace(subject, runtimeId.value, workspaceId.value,
                        sessionItems.fold(ai.drsai.remote.remote.data.RemoteActivitySummary()) { total, session ->
                            total + ai.drsai.remote.remote.data.RemoteActivitySummary(
                                session.unreadTurns, session.pendingApprovals, session.runningRuns, session.updatedAtLabel,
                            )
                        })
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
                val instructionStatusText = payload.instructions.fold(
                    onSuccess = { values -> when {
                        instructionRefreshRequired -> LocalizedText(R.string.project_instructions_changed)
                        values.isEmpty() -> LocalizedText(R.string.no_project_instructions)
                        else -> LocalizedText(R.string.project_instructions_verified, values.size)
                    } },
                    onFailure = { failure -> LocalizedText(
                        R.string.project_instructions_unreadable,
                        safeRemoteFailureMessage(getApplication(), failure),
                    ) },
                )
                mutableState.update { it.copy(agentDefinitions = payload.definitions, sessions = sessionItems,
                    capabilities = listOf(
                        RemoteCapabilityUi("Files", payload.definitions.any { definition -> definition.capabilities.any { cap -> cap.startsWith("files") || cap == "workspace.read" } }),
                        RemoteCapabilityUi("Git", payload.definitions.any { definition -> definition.capabilities.any { cap -> cap.startsWith("git") || cap == "workspace.read" } }),
                    ),
                    pendingApprovalCount = payload.approvals.count { approval -> approval.status == "pending" },
                    instructionVersions = instructionVersions,
                    instructionStatus = null,
                    instructionStatusText = instructionStatusText,
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
                        error = if (failure is RelayHttpException && failure.status == 403) null
                            else safeRemoteFailureMessage(getApplication(), failure),
                        errorText = if (failure is RelayHttpException && failure.status == 403) {
                            LocalizedText(R.string.remote_host_access_revoked)
                        } else null,
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
                instructionStatus = null,
                instructionStatusText = if (it.instructionVersions.isEmpty()) {
                    LocalizedText(R.string.no_project_instructions)
                } else LocalizedText(R.string.latest_project_instructions_confirmed),
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
            time.waitFor(250)
            refresh(query)
        }
    }

    fun createSession(definition: RemoteAgentDefinition) = viewModelScope.launch(Dispatchers.IO) {
        require(definition.version != "latest") { "exact_agent_definition_required" }
        require(!mutableState.value.instructionRefreshRequired) { "project_instruction_refresh_required" }
        mutableState.update { it.copy(creating = true, error = null, errorText = null) }
        runCatching {
            sessions.createSession(
                runtimeId = runtimeId,
                workspaceId = workspaceId,
                title = getApplication<Application>().getString(R.string.new_session),
                definition = definition,
                idempotencyKey = java.util.UUID.randomUUID().toString(),
            )
        }.onSuccess { refresh() }
            .onFailure { failure ->
                mutableState.update { it.copy(creating = false, error = safeRemoteFailureMessage(getApplication(), failure)) }
            }
    }

    override fun onCleared() {
        ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        catalogJob?.cancel()
        super.onCleared()
    }

    fun toggleArchived() {
        mutableState.update { it.copy(showArchived = !it.showArchived) }
        refresh()
    }

    fun renameSession(reference: ai.drsai.remote.remote.model.RemoteSessionRef, title: String) =
        mutateSession(reference, title = title)

    fun setArchived(reference: ai.drsai.remote.remote.model.RemoteSessionRef, archived: Boolean) =
        mutateSession(reference, lifecycle = if (archived) {
            ai.drsai.remote.remote.model.RemoteResourceLifecycle.ARCHIVED
        } else ai.drsai.remote.remote.model.RemoteResourceLifecycle.ACTIVE)

    private fun mutateSession(
        reference: ai.drsai.remote.remote.model.RemoteSessionRef,
        title: String? = null,
        lifecycle: ai.drsai.remote.remote.model.RemoteResourceLifecycle? = null,
    ) = viewModelScope.launch(Dispatchers.IO) {
        runCatching { sessions.updateSession(reference, title, lifecycle) }
            .onSuccess { refresh() }
            .onFailure { failure -> mutableState.update { it.copy(error = safeRemoteFailureMessage(getApplication(), failure)) } }
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
