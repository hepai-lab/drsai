package ai.drsai.remote.remote.ui

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.remote.data.AndroidDevicePresence
import ai.drsai.remote.remote.data.RemoteWorkspaceContainer
import ai.drsai.remote.remote.data.RemoteDirectoryEntry
import ai.drsai.remote.remote.data.RemoteDirectoryLoader
import ai.drsai.remote.remote.data.RemoteLifecycleCoordinator
import ai.drsai.remote.remote.data.SharedPreferencesWorkspaceRecencyStore
import ai.drsai.remote.remote.data.RuntimeInstanceTracker
import ai.drsai.remote.remote.data.WorkspaceInstructionVersionStore
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.associationErrorMessage
import ai.drsai.remote.remote.data.remoteActionableFailure
import ai.drsai.remote.remote.data.RemoteSearchResult
import ai.drsai.remote.remote.data.RemoteSearchKind
import ai.drsai.remote.remote.data.RemoteSearchSource
import ai.drsai.remote.remote.data.RemotePairingJourneyEvent
import ai.drsai.remote.remote.data.RemotePairingJourneyReducer
import ai.drsai.remote.remote.data.SharedPreferencesPushRegistrationStateStore
import ai.drsai.remote.remote.device.RemotePushProvider
import ai.drsai.remote.remote.device.RemotePushProviderStatus
import ai.drsai.remote.remote.device.RemotePushRegistrationScheduler
import ai.drsai.remote.remote.device.AndroidRemoteBackgroundWorkController
import ai.drsai.remote.remote.device.RemoteBackgroundSyncCoordinator
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RemoteConnectionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.drop
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean

class RemoteHomeViewModel(app: Application) : AndroidViewModel(app) {
    private val container = RemoteWorkspaceContainer.get(app)
    private val time = container.time
    private val tokenStore = container.boundaries.auth.tokens
    private val relay = container.boundaries.catalog.discovery
    private val associations = container.boundaries.association.service
    private val connectivity = container.connectivity
    private val lifecycleCoordinator = RemoteLifecycleCoordinator()
    private val instances = RuntimeInstanceTracker()
    private val instructionVersions = WorkspaceInstructionVersionStore(app)
    private val directory = RemoteDirectoryLoader(
        relay,
        SharedPreferencesWorkspaceRecencyStore(app),
        container.directoryCache,
    )
    private val mutableState = MutableStateFlow(RemoteHomeUiState(loading = true))
    private var searchJob: Job? = null
    private val refreshGeneration = AtomicLong(0)
    private val notificationReadinessGeneration = AtomicLong(0)
    private val keyRotationInFlight = AtomicBoolean(false)
    private val pairingReducer = RemotePairingJourneyReducer()
    private val backgroundSync = RemoteBackgroundSyncCoordinator(
        AndroidRemoteBackgroundWorkController(app),
    )
    @Volatile private var appForeground = ProcessLifecycleOwner.get().lifecycle.currentState
        .isAtLeast(Lifecycle.State.STARTED)
    private val processLifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            appForeground = true
            onForeground()
        }

        override fun onStop(owner: LifecycleOwner) {
            appForeground = false
            reconcileBackgroundPolicy()
        }
    }
    val state: StateFlow<RemoteHomeUiState> = mutableState.asStateFlow()

    init {
        ProcessLifecycleOwner.get().lifecycle.addObserver(processLifecycleObserver)
        refreshNotificationReadiness()
        RemotePushRegistrationScheduler.schedule(app)
        refresh()
        viewModelScope.launch {
            connectivity.online.drop(1).collect { online ->
                lifecycleCoordinator.networkChanged()
                reconcileBackgroundPolicy()
                if (online && appForeground) refresh() else if (!online) mutableState.update {
                    it.copy(stale = it.computers.isNotEmpty(), error = "网络已断开")
                }
            }
        }
    }

    fun refreshNotificationReadiness() {
        val generation = notificationReadinessGeneration.incrementAndGet()
        val app = getApplication<Application>()
        val provider = RemotePushProvider.initialize(app)
        val notificationsEnabled = NotificationManagerCompat.from(app).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                app,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED)
        val local = localRemoteNotificationReadiness(provider, notificationsEnabled)
        mutableState.update { it.copy(notificationState = local) }
        reconcileBackgroundPolicy(local)
        if (local != RemoteNotificationReadiness.CHECKING) return
        viewModelScope.launch(Dispatchers.IO) {
            val platform = runCatching { container.boundaries.push.readiness.pushReadiness() }.getOrNull()
            if (generation == notificationReadinessGeneration.get()) {
                mutableState.update {
                    it.copy(notificationState = resolvedRemoteNotificationReadiness(local, platform))
                }
                reconcileBackgroundPolicy()
            }
        }
    }

    /** Foreground is the lossless fallback when background push is unavailable. */
    fun onForeground() {
        refreshNotificationReadiness()
        RemotePushRegistrationScheduler.schedule(getApplication())
        refresh()
        reconcileBackgroundPolicy()
    }

    private fun reconcileBackgroundPolicy(
        readiness: RemoteNotificationReadiness = mutableState.value.notificationState,
    ) {
        backgroundSync.reconcile(
            foreground = appForeground,
            online = connectivity.online.value,
            pushReady = readiness == RemoteNotificationReadiness.READY,
        )
    }

    fun diagnoseConnection() {
        refreshNotificationReadiness()
        val current = mutableState.value
        val signedIn = tokenStore.user() != null
        val proofReady = runCatching {
            val device = container.boundaries.auth.deviceProof.associationDevice
            device.deviceId.isNotBlank() && device.devicePublicKey.isNotBlank()
        }.getOrDefault(false)
        val checks = RemoteConnectionDiagnosticInput(
            computer = when {
                current.computers.isEmpty() -> RemoteDiagnosticCheck.UNKNOWN
                current.computers.all { it.state == RemoteConnectionState.OFFLINE } -> RemoteDiagnosticCheck.FAILED
                else -> RemoteDiagnosticCheck.OK
            },
            platform = if (current.error != null && current.computers.isEmpty()) {
                RemoteDiagnosticCheck.FAILED
            } else RemoteDiagnosticCheck.OK,
            account = if (signedIn) RemoteDiagnosticCheck.OK else RemoteDiagnosticCheck.FAILED,
            deviceIdentity = when {
                !proofReady -> RemoteDiagnosticCheck.FAILED
                signedIn && current.computers.isEmpty() && !current.loading -> RemoteDiagnosticCheck.FAILED
                else -> RemoteDiagnosticCheck.OK
            },
            protocol = if (current.computers.any { it.state == RemoteConnectionState.INCOMPATIBLE }) {
                RemoteDiagnosticCheck.FAILED
            } else RemoteDiagnosticCheck.OK,
            notifications = if (current.notificationState == RemoteNotificationReadiness.READY) {
                RemoteDiagnosticCheck.OK
            } else RemoteDiagnosticCheck.FAILED,
        )
        mutableState.update { it.copy(diagnostic = diagnoseRemoteConnection(checks)) }
    }

    fun refresh(query: String? = mutableState.value.query) = viewModelScope.launch(Dispatchers.IO) {
        val generation = refreshGeneration.incrementAndGet()
        val normalizedQuery = query?.trim().orEmpty()
        mutableState.update {
            it.copy(
                loading = it.computers.isEmpty(),
                refreshing = it.computers.isNotEmpty(),
                error = null,
                actionableError = null,
            )
        }
        runCatching {
            val subject = tokenStore.user()?.id ?: error("remote_subject_required")
            val cached = directory.cached(subject)
            val cachedSearch = container.unifiedSearch.cached(subject, normalizedQuery)
            if (cached.isNotEmpty() && mutableState.value.computers.isEmpty()) {
                mutableState.update {
                    it.copy(
                        computers = cached.toUiComputers(forceCached = true),
                        loading = false,
                        refreshing = true,
                        stale = true,
                        searchResults = cachedSearch,
                    )
                }
            }
            container.singleFlight.run("host:$subject:$normalizedQuery") {
                val result = directory.synchronize(subject, query = normalizedQuery)
                result to container.unifiedSearch.cached(subject, normalizedQuery)
            }
        }.onSuccess { (result, cachedSearch) ->
            reportPresence(result.entries.map { it.runtime.reference.runtimeId }.distinct())
            scheduleDeviceKeyRotation(result.entries)
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
                    actionableError = null,
                    recentlyAssociatedRuntimeId = mutableState.value.recentlyAssociatedRuntimeId,
                    searchResults = onlineSearchResults(result.entries, normalizedQuery) + cachedSearch,
                    notificationState = mutableState.value.notificationState,
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
                        actionableError = remoteActionableFailure(failure),
                    )
                }
            }
        }
    }

    private fun scheduleDeviceKeyRotation(entries: List<RemoteDirectoryEntry>) {
        if (!container.boundaries.auth.deviceProof.isKeyRotationDue() ||
            !keyRotationInFlight.compareAndSet(false, true)
        ) return
        // The synchronized catalog contains only currently associated
        // Runtimes; revoked associations are removed before this point.
        val runtimeId = entries.firstOrNull()?.runtime?.reference?.runtimeId
        if (runtimeId == null) {
            keyRotationInFlight.set(false)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { associations.rotateDeviceKey(runtimeId) }
                .onFailure {
                    mutableState.update { state ->
                        state.copy(error = "设备安全密钥暂时无法更新，将自动重试")
                    }
                }
            keyRotationInFlight.set(false)
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
        val activity = tokenStore.user()?.id?.let { subject ->
            container.activity.runtime(subject, runtime.reference.runtimeId.value)
        } ?: ai.drsai.remote.remote.data.RemoteActivitySummary()
        RemoteComputerUi(
            runtimeId = runtime.reference.runtimeId,
            displayName = runtime.reference.displayName,
            state = state,
            version = runtime.version,
            lastSeenLabel = when {
                cached && entry.lastSyncedAt != null ->
                    "缓存 · 上次同步 ${formatSyncTime(entry.lastSyncedAt)}"
                runtime.state == RemoteConnectionState.PAUSED -> "此电脑已暂停"
                runtime.state == RemoteConnectionState.OFFLINE -> "离线"
                else -> "刚刚连接"
            },
            workspaces = entry.workspaces,
            workspacesCached = cached,
            lastSyncedAtMillis = entry.lastSyncedAt,
            pendingApprovalCount = activity.pendingApprovals,
            unreadTurnCount = activity.unreadTurns,
            runningRunCount = activity.runningRuns,
            lastActivityAt = activity.lastActivityAt,
        )
    }.sortedWith(compareByDescending<RemoteComputerUi> { it.pendingApprovalCount > 0 }
        .thenByDescending { it.runningRunCount > 0 }
        .thenByDescending { it.unreadTurnCount }
        .thenByDescending { it.lastActivityAt }
        .thenBy { it.displayName })

    private fun formatSyncTime(timestamp: Long): String =
        java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date(timestamp))

    fun updateQuery(query: String) {
        refreshGeneration.incrementAndGet()
        mutableState.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            time.waitFor(250)
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

    fun beginAssociationScan() {
        mutableState.update { it.copy(pairing = pairingReducer.reduce(it.pairing, RemotePairingJourneyEvent.ScanStarted)) }
    }

    fun cancelAssociationScan() {
        mutableState.update { it.copy(pairing = pairingReducer.reduce(it.pairing, RemotePairingJourneyEvent.Cancelled)) }
    }

    fun associate(payload: String) = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(
            refreshing = true,
            error = null,
            actionableError = null,
            pairing = pairingReducer.reduce(it.pairing, RemotePairingJourneyEvent.PayloadAccepted),
        ) }
        runCatching { associations.associate(payload) }
            .onSuccess { runtimeId ->
                runCatching { associations.recordPresence(runtimeId) }
                RemotePushRegistrationScheduler.schedule(getApplication())
                mutableState.update { it.copy(
                    recentlyAssociatedRuntimeId = runtimeId,
                    pairing = pairingReducer.reduce(it.pairing, RemotePairingJourneyEvent.Connected),
                ) }
                refresh()
            }
            .onFailure { failure -> mutableState.update { state ->
                val actionable = remoteActionableFailure(failure)
                state.copy(
                    refreshing = false,
                    error = associationErrorMessage(failure),
                    actionableError = actionable,
                    pairing = pairingReducer.reduce(
                        state.pairing,
                        RemotePairingJourneyEvent.Failed(actionable.action),
                    ),
                )
            } }
    }

    private suspend fun reportPresence(runtimeIds: List<ai.drsai.remote.remote.model.RuntimeId>) {
        runtimeIds.forEach { runtimeId ->
            runCatching { associations.recordPresence(runtimeId) }
        }
    }

    fun revokeAssociation(runtimeId: ai.drsai.remote.remote.model.RuntimeId, clearLocalCache: Boolean = false) =
        viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(refreshing = true, error = null) }
            runCatching { associations.revokeAssociation(runtimeId) }
                .onSuccess {
                    tokenStore.user()?.let { user ->
                        SharedPreferencesPushRegistrationStateStore(
                            getApplication(), "${BuildConfig.OIDC_ISSUER}\n${user.id}",
                        ).clear(runtimeId)
                    }
                    val cleanupFailure = tokenStore.user()?.id?.let { subject ->
                        if (clearLocalCache) runCatching {
                            directory.removeCachedRuntime(subject, runtimeId)
                            container.drafts.clearRuntime(subject, runtimeId.value)
                            container.activity.clearRuntime(subject, runtimeId.value)
                            container.boundaries.run.controls.clearRuntime(subject, runtimeId.value)
                            container.boundaries.approval.decisions.clearRuntime(subject, runtimeId.value)
                            instructionVersions.clearRuntime(subject, runtimeId)
                        }.exceptionOrNull() else null
                    }
                    mutableState.update { state ->
                        state.copy(
                            computers = state.computers.filterNot { it.runtimeId == runtimeId },
                            recentlyAssociatedRuntimeId = state.recentlyAssociatedRuntimeId
                                ?.takeUnless { it == runtimeId },
                            refreshing = false,
                            stale = false,
                            error = cleanupFailure?.let {
                                "访问已解除，但本机缓存未能完全清除，请重试清理"
                            },
                        )
                    }
                    if (cleanupFailure == null) refresh()
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
        ProcessLifecycleOwner.get().lifecycle.removeObserver(processLifecycleObserver)
        super.onCleared()
    }

    private fun onlineSearchResults(entries: List<RemoteDirectoryEntry>, query: String): List<RemoteSearchResult> {
        if (query.isBlank()) return emptyList()
        return entries.flatMap { entry ->
            buildList {
                val runtime = entry.runtime.reference
                if (runtime.displayName.contains(query, ignoreCase = true)) {
                    add(RemoteSearchResult(RemoteSearchKind.HOST, runtime.displayName, "计算机",
                        RemoteSearchSource.ONLINE, runtime.runtimeId))
                }
                entry.workspaces.filter { it.displayName.contains(query, ignoreCase = true) }.forEach { workspace ->
                    add(RemoteSearchResult(RemoteSearchKind.WORKSPACE, workspace.displayName, "工作区",
                        RemoteSearchSource.ONLINE, workspace.runtimeId, workspace.workspaceId))
                }
            }
        }.distinctBy { listOf(it.kind, it.runtimeId.value, it.workspaceId?.value, it.sessionId?.value) }
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
