package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.room.Room
import androidx.lifecycle.AndroidViewModel
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
import ai.drsai.remote.data.MIGRATION_8_9
import ai.drsai.remote.data.MIGRATION_9_10
import ai.drsai.remote.data.MIGRATION_10_11
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.remote.data.AndroidRemoteConnectivity
import ai.drsai.remote.remote.data.RemoteDirectoryEntry
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.RemoteLifecycleCoordinator
import ai.drsai.remote.remote.data.RoomRemoteDirectoryCache
import ai.drsai.remote.remote.data.SharedPreferencesWorkspaceRecencyStore
import ai.drsai.remote.remote.data.RuntimeInstanceTracker
import ai.drsai.remote.remote.data.RelayHttpException
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
    private val database = Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
        .addMigrations(
            MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
            MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11,
        )
        .build()
    private val directory = RemoteDirectoryLoader(
        relay,
        SharedPreferencesWorkspaceRecencyStore(app),
        RoomRemoteDirectoryCache(database),
    )
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
            val cached = directory.cached(subject)
            if (cached.isNotEmpty() && mutableState.value.computers.isEmpty()) {
                mutableState.update {
                    it.copy(
                        computers = cached.toUiComputers(forceCached = true),
                        loading = false,
                        refreshing = true,
                        stale = true,
                    )
                }
            }
            directory.synchronize(subject, query = normalizedQuery)
        }.onSuccess { result ->
            reportPresence(result.entries.map { it.runtime.reference.runtimeId }.distinct())
            if (generation == refreshGeneration.get()) {
                mutableState.value = RemoteHomeUiState(
                    computers = result.entries.toUiComputers(),
                    query = normalizedQuery,
                    stale = result.stale,
                    error = when (result.warning) {
                        "remote_access_revoked" -> "部分远程访问授权已撤销"
                        "workspace_catalog_unavailable" -> "部分工作区暂时无法刷新，当前显示缓存"
                        else -> null
                    },
                    recentlyAssociatedRuntimeId = mutableState.value.recentlyAssociatedRuntimeId,
                )
            }
        }.onFailure { failure ->
            if (generation == refreshGeneration.get()) {
                val forbidden = failure is RelayHttpException && failure.status == 403
                mutableState.update {
                    it.copy(
                        computers = if (forbidden) emptyList() else it.computers,
                        loading = false,
                        refreshing = false,
                        stale = !forbidden && it.computers.isNotEmpty(),
                        error = when {
                            forbidden -> "当前设备的远程访问授权已撤销"
                            failure is RelayHttpException && failure.status == 401 ->
                                "HepAI 登录已过期，请重新登录"
                            else -> "远程目录刷新失败，当前显示上次同步内容"
                        },
                    )
                }
            }
        }
    }

    private fun List<RemoteDirectoryEntry>.toUiComputers(
        forceCached: Boolean = false,
    ): List<RemoteComputerUi> = map { entry ->
        val runtime = entry.runtime
        instances.observe(
            runtime.reference.runtimeId.value,
            runtime.instanceId,
            runtime.connectionGeneration,
        )
        val cached = forceCached || entry.workspaceProjectionCached
        val state = if (forceCached && runtime.state == RemoteConnectionState.ONLINE) {
            RemoteConnectionState.DEGRADED
        } else {
            runtime.state
        }
        RemoteComputerUi(
            runtimeId = runtime.reference.runtimeId,
            displayName = runtime.reference.displayName,
            state = state,
            version = runtime.version,
            instanceId = runtime.instanceId,
            connectionGeneration = runtime.connectionGeneration,
            lastSeenLabel = when {
                cached && entry.lastSyncedAt != null ->
                    "缓存 · 上次同步 ${formatSyncTime(entry.lastSyncedAt)}"
                runtime.state == RemoteConnectionState.OFFLINE -> "离线"
                else -> "刚刚连接"
            },
            workspaces = entry.workspaces,
            workspacesCached = cached,
            lastSyncedAtMillis = entry.lastSyncedAt,
        )
    }

    private fun formatSyncTime(timestamp: Long): String =
        java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date(timestamp))

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
        AndroidDevicePresence.markAccessing(workspace.runtimeId)
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

    fun refreshWorkspaces(runtimeId: ai.drsai.remote.remote.model.RuntimeId) =
        viewModelScope.launch(Dispatchers.IO) {
            val subject = tokenStore.user()?.id ?: return@launch
            if (runtimeId in mutableState.value.refreshingRuntimeIds) return@launch
            mutableState.update {
                it.copy(
                    refreshingRuntimeIds = it.refreshingRuntimeIds + runtimeId,
                    error = null,
                    computers = it.computers.map { computer ->
                        if (computer.runtimeId == runtimeId) {
                            computer.copy(workspaceSyncStatus = null, workspaceSyncFailed = false)
                        } else {
                            computer
                        }
                    },
                )
            }
            AndroidDevicePresence.markAccessing(runtimeId)
            runCatching { directory.forceSyncWorkspaces(subject, runtimeId) }
                .onSuccess { result ->
                    mutableState.update { state ->
                        val query = state.query.trim()
                        state.copy(
                            computers = state.computers.map { computer ->
                                if (computer.runtimeId != runtimeId) return@map computer
                                val visible = if (
                                    query.isEmpty() ||
                                    computer.displayName.contains(query, ignoreCase = true)
                                ) {
                                    result.items
                                } else {
                                    result.items.filter {
                                        it.displayName.contains(query, ignoreCase = true)
                                    }
                                }
                                val syncedAtMillis = java.time.Instant.parse(result.syncedAt).toEpochMilli()
                                computer.copy(
                                    workspaces = visible,
                                    workspacesCached = false,
                                    lastSyncedAtMillis = syncedAtMillis,
                                    workspaceSyncStatus = "已同步 ${formatSyncTime(syncedAtMillis)}",
                                    workspaceSyncFailed = false,
                                )
                            },
                            refreshingRuntimeIds = state.refreshingRuntimeIds - runtimeId,
                            stale = state.computers.any {
                                it.runtimeId != runtimeId && it.workspacesCached
                            },
                        )
                    }
                }
                .onFailure { failure ->
                    val forbidden = failure is RelayHttpException && failure.status == 403
                    mutableState.update { state ->
                        state.copy(
                            computers = if (forbidden) {
                                state.computers.filterNot { it.runtimeId == runtimeId }
                            } else {
                                state.computers.map { computer ->
                                    if (computer.runtimeId == runtimeId) {
                                        computer.copy(
                                            workspaceSyncStatus = workspaceCatalogSyncErrorMessage(failure),
                                            workspaceSyncFailed = true,
                                        )
                                    } else {
                                        computer
                                    }
                                }
                            },
                            refreshingRuntimeIds = state.refreshingRuntimeIds - runtimeId,
                            error = if (forbidden) "这台远程电脑的访问授权已撤销" else null,
                        )
                    }
                }
        }

    fun associate(payload: String) = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(refreshing = true, error = null) }
        runCatching { relay.associate(payload) }
            .onSuccess { runtimeId ->
                runCatching { relay.recordPresence(runtimeId) }
                mutableState.update { it.copy(recentlyAssociatedRuntimeId = runtimeId) }
                refresh()
            }
            .onFailure { failure -> mutableState.update { it.copy(refreshing = false, error = associationErrorMessage(failure)) } }
    }

    private suspend fun reportPresence(runtimeIds: List<ai.drsai.remote.remote.model.RuntimeId>) {
        runtimeIds.forEach { runtimeId ->
            runCatching { relay.recordPresence(runtimeId) }
        }
    }

    fun revokeAssociation(runtimeId: ai.drsai.remote.remote.model.RuntimeId) =
        viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(refreshing = true, error = null) }
            runCatching { relay.revokeAssociation(runtimeId) }
                .onSuccess {
                    tokenStore.user()?.id?.let { subject ->
                        directory.removeCachedRuntime(subject, runtimeId)
                    }
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
        database.close()
        super.onCleared()
    }
}

internal fun workspaceCatalogSyncErrorMessage(failure: Throwable): String = when {
    failure is RelayHttpException && failure.status == 401 ->
        "HepAI 登录已过期，请重新登录"
    failure is java.net.SocketTimeoutException ||
        failure is RelayHttpException && (
            failure.errorCode == "catalog_sync_timeout" ||
                failure.status == 504
            ) ->
        "同步超时；继续显示上次内容"
    failure is RelayHttpException && failure.errorCode == "host_offline" ->
        "远程电脑离线，未同步；继续显示上次内容"
    failure is RelayHttpException && failure.errorCode == "stale_runtime_generation" ->
        "远程电脑刚刚重连，请稍后重试；继续显示上次内容"
    failure is java.io.IOException ->
        "网络连接失败，未同步；继续显示上次内容"
    else ->
        "工作区同步失败；继续显示上次内容"
}
