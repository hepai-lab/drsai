package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.AndroidRemoteConnectivity
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.RemoteLifecycleCoordinator
import ai.drsai.remote.remote.data.SharedPreferencesWorkspaceRecencyStore
import ai.drsai.remote.remote.data.RuntimeInstanceTracker
import ai.drsai.remote.remote.data.associationErrorMessage
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.drop
import java.util.concurrent.atomic.AtomicLong

class RemoteHomeViewModel(app: Application) : AndroidViewModel(app) {
    private val tokenStore = SecureTokenStore(app)
    private val auth = AccessTokenCoordinator(tokenStore, OidcClient(refreshClientId = { tokenStore.oidcClientId }))
    private val deviceProof = androidRelayDeviceProof(app)
    private val relay = HttpRelayDiscoveryService(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        auth::refreshAfter,
        deviceProof = deviceProof,
    )
    private val connectivity = AndroidRemoteConnectivity(app)
    private val lifecycleCoordinator = RemoteLifecycleCoordinator()
    private val instances = RuntimeInstanceTracker()
    private val directory = RemoteDirectoryLoader(relay, SharedPreferencesWorkspaceRecencyStore(app))
    private val mutableState = MutableStateFlow(RemoteHomeUiState(loading = true))
    private var searchJob: Job? = null
    private val refreshGeneration = AtomicLong(0)
    val state: StateFlow<RemoteHomeUiState> = mutableState.asStateFlow()

    init {
        refresh()
        viewModelScope.launch {
            connectivity.online.drop(1).collect { online ->
                lifecycleCoordinator.networkChanged()
                if (online) refresh() else mutableState.update { it.copy(stale = it.computers.isNotEmpty(), error = "网络已断开") }
            }
        }
    }

    fun refresh(query: String? = mutableState.value.query) = viewModelScope.launch(Dispatchers.IO) {
        val generation = refreshGeneration.incrementAndGet()
        val normalizedQuery = query?.trim().orEmpty()
        mutableState.update { it.copy(loading = it.computers.isEmpty(), refreshing = it.computers.isNotEmpty(), error = null) }
        runCatching {
            val subject = tokenStore.user()?.id ?: error("remote_subject_required")
            directory.load(subject, normalizedQuery).map { entry ->
                val runtime = entry.runtime
                instances.observe(runtime.reference.runtimeId.value, runtime.instanceId, runtime.connectionGeneration)
                RemoteComputerUi(
                    runtimeId = runtime.reference.runtimeId,
                    displayName = runtime.reference.displayName,
                    state = runtime.state,
                    version = runtime.version,
                    instanceId = runtime.instanceId,
                    connectionGeneration = runtime.connectionGeneration,
                    lastSeenLabel = if (runtime.state == RemoteConnectionState.OFFLINE) "离线" else "刚刚连接",
                    workspaces = entry.workspaces,
                )
            }
        }.onSuccess { computers ->
            if (generation == refreshGeneration.get()) {
                mutableState.value = RemoteHomeUiState(
                    computers = computers,
                    query = normalizedQuery,
                    recentlyAssociatedRuntimeId = mutableState.value.recentlyAssociatedRuntimeId,
                )
            }
        }.onFailure { failure ->
            if (generation == refreshGeneration.get()) {
                mutableState.update { it.copy(loading = false, refreshing = false, stale = it.computers.isNotEmpty(),
                    error = failure.message ?: "远程工作区加载失败") }
            }
        }
    }

    fun updateQuery(query: String) {
        refreshGeneration.incrementAndGet()
        mutableState.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(250)
            refresh(query)
        }
    }

    fun markWorkspaceOpened(workspace: RemoteWorkspaceRef) {
        val subject = tokenStore.user()?.id ?: return
        directory.markOpened(subject, workspace)
        mutableState.update { state ->
            state.copy(computers = state.computers
                .map { computer ->
                    if (computer.runtimeId == workspace.runtimeId) {
                        computer.copy(workspaces = computer.workspaces.sortedByDescending { it == workspace })
                    } else computer
                }
                .sortedByDescending { it.runtimeId == workspace.runtimeId })
        }
    }

    fun associate(payload: String) = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(refreshing = true, error = null) }
        runCatching { relay.associate(payload) }
            .onSuccess { runtimeId ->
                mutableState.update { it.copy(recentlyAssociatedRuntimeId = runtimeId) }
                refresh()
            }
            .onFailure { failure -> mutableState.update { it.copy(refreshing = false, error = associationErrorMessage(failure)) } }
    }

    fun revokeAssociation(runtimeId: ai.drsai.remote.remote.model.RuntimeId) =
        viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(refreshing = true, error = null) }
            runCatching { relay.revokeAssociation(runtimeId) }
                .onSuccess {
                    mutableState.update { state ->
                        state.copy(
                            computers = state.computers.filterNot { it.runtimeId == runtimeId },
                            recentlyAssociatedRuntimeId = state.recentlyAssociatedRuntimeId
                                ?.takeUnless { it == runtimeId },
                            refreshing = false,
                            stale = false,
                        )
                    }
                    refresh()
                }
                .onFailure { failure ->
                    mutableState.update {
                        it.copy(
                            refreshing = false,
                            error = if (failure is ai.drsai.remote.remote.data.RelayHttpException &&
                                failure.status == 401
                            ) {
                                "HepAI 登录已过期，请重新登录"
                            } else {
                                "解除关联失败，请重试"
                            },
                        )
                    }
                }
        }

    override fun onCleared() {
        connectivity.close()
        super.onCleared()
    }
}
