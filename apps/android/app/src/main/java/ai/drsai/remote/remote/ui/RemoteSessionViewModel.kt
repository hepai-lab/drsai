package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.remote.data.*
import android.content.Intent
import android.util.Base64
import java.io.File
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.generated.*
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class RemoteSessionViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
    private val sessionId: SessionId,
    private val runtimeName: String,
    private val workspaceName: String,
) : AndroidViewModel(app) {
    private val container = RemoteWorkspaceContainer.get(app)
    private val time = container.time
    private val tokens = container.boundaries.auth.tokens
    private val auth = container.boundaries.auth.coordinator
    private val sessions = container.boundaries.session.client
    private val runs = container.boundaries.run.client
    private val approvals = container.boundaries.approval.client
    private val runEvents = container.boundaries.run.events
    private val oaep = container.boundaries.session.oaep
    private val legacy = container.boundaries.session.legacy
    private val workspace = container.boundaries.file.client(runtimeId)
    private val cache = container.cache
    private val drafts = container.drafts
    private val activity = container.activity
    private val runControls = container.boundaries.run.controls
    private val approvalDecisions = container.boundaries.approval.decisions
    private val connectivity = container.connectivity
    private val resourceLease = container.resourceLeases.acquire("session_sync")
    private val subject get() = tokens.user()?.id ?: error("remote_subject_required")
    private val organization = ""
    private val scopeKey = "${runtimeId.value}/${workspaceId.value}/${sessionId.value}"
    private val mutableState = MutableStateFlow(RemoteChatUiState(runtimeName, workspaceName, sessionId.value, scopeKey = scopeKey))
    val state: StateFlow<RemoteChatUiState> = mutableState.asStateFlow()
    private var streamJob: Job? = null
    private var transcriptSearchJob: Job? = null
    private var activeRun: RemoteRunIdentity? = null
    private var latestRun: RemoteRunSummary? = null
    private var synchronizer: RemoteSequenceSynchronizer? = null
    private val deltaFrames = RemoteDeltaFrameBuffer()
    private var deltaFrameJob: Job? = null
    private var oaepRenderFrameJob: Job? = null
    private val oaepRenderMailbox = LatestFrameMailbox<OaepEvent>()
    private var authRefreshAttempted = false
    private val refreshGeneration = AtomicLong(0)
    private val retryPolicy = RemoteRetryPolicy()
    private val syncStateMachine = SessionSyncStateMachine()
    private val projectionStateMachine = SessionProjectionStateMachine()
    private val runControlStateMachine = SessionRunControlStateMachine()
    private val approvalStateMachine = SessionApprovalStateMachine()
    private val draftStateMachine = SessionDraftStateMachine()
    private val uiAuthorityReducer = RemoteSessionUiAuthorityReducer()
    private val uiAuthorityGeneration = AtomicLong(0)
    private val userSlo = RemoteUserSloTracker(clockMs = time::wallClockMillis)
    @Volatile private var oaepEnabled = false
    @Volatile private var foreground = true
    private val lifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            foreground = true
            syncStateMachine.accept(SessionSyncEvent.Foreground)
            reconcileSessionStream()
        }
        override fun onStop(owner: LifecycleOwner) {
            // Background delivery is notification-driven. Do not keep an SSE
            // reconnect loop alive while the process is not visible.
            foreground = false
            syncStateMachine.accept(SessionSyncEvent.Background)
            reconcileSessionStream()
        }
    }

    init {
        AndroidDevicePresence.markAccessing(runtimeId)
        runCatching { activity.markSessionRead(subject, runtimeId.value, sessionId.value) }
        ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)
        viewModelScope.launch {
            connectivity.state.collect { network ->
                if (!network.online) userSlo.disconnected()
                syncStateMachine.accept(SessionSyncEvent.Network(network.online))
                mutableState.update { it.copy(authority = authoritativeConnection(
                    if (network.online) RemoteConnectionState.CONNECTING else RemoteConnectionState.OFFLINE,
                )) }
                reconcileSessionStream()
            }
        }
        runCatching { drafts.read(subject, runtimeId.value, sessionId.value) }
            .getOrDefault("")
            .takeIf(String::isNotEmpty)
            ?.let { draft ->
                draftStateMachine.restore(draft)
                mutableState.update { it.copy(draft = draft) }
            }
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val (messages, artifacts) = cachedOaepProjection()
                if (messages.isNotEmpty() || artifacts.isNotEmpty()) {
                    mutableState.update { it.copy(messages = messages, artifacts = artifacts) }
                }
            }
            userSlo.cacheLoaded()
            refresh()
        }
    }

    /** Called after Compose commits the latest authoritative UI state. */
    fun onUiRendered() {
        val firstScreen = userSlo.firstRendered()
        val operations = userSlo.operationsRendered()
        if (firstScreen == null && operations.isEmpty()) return
        viewModelScope.launch(Dispatchers.IO) {
            firstScreen?.let { observation ->
                runCatching { oaep.recordFirstScreen(runtimeId, workspaceId, sessionId, observation) }
            }
            operations.forEach { observation ->
                runCatching {
                    oaep.recordOperationConfirmation(runtimeId, workspaceId, sessionId, observation)
                }
            }
        }
    }

    private fun reconcileSessionStream() {
        val policy = ai.drsai.remote.remote.device.remoteBackgroundPolicy(
            foreground,
            connectivity.online.value,
            false,
        )
        if (policy.keepForegroundSse) startSessionSync() else streamJob?.cancel()
    }

    fun updateDraft(value: String) {
        val edited = draftStateMachine.edit(value)
        mutableState.update { it.copy(draft = edited.text) }
        runCatching { drafts.write(subject, runtimeId.value, sessionId.value, edited.text) }
            .onSuccess { draftStateMachine.persisted(edited.revision) }
    }

    fun loadOlderHistory() = viewModelScope.launch(Dispatchers.IO) {
        val cursor = mutableState.value.historyCursor ?: return@launch
        if (mutableState.value.loadingHistory) return@launch
        mutableState.update { it.copy(loadingHistory = true, historyError = null) }
        runCatching {
            val snapshot = oaep.snapshot(runtimeId, workspaceId, sessionId, cursor = cursor)
            cache.mergeOaepSnapshotWindow(
                subject, organization, runtimeId.value, workspaceId.value, snapshot,
            )
            if (snapshot.window?.hasMore == false && snapshot.checkpoint != null) {
                cache.verifyOaepProjectionCheckpoint(
                    subject, organization, runtimeId.value, sessionId.value, snapshot.checkpoint,
                )
            }
            renderCachedOaepItems()
            mutableState.update {
                it.copy(
                    historyCursor = snapshot.window?.nextCursor,
                    loadingHistory = false,
                    historyError = null,
                )
            }
        }.onFailure { failure ->
            mutableState.update {
                it.copy(loadingHistory = false, historyError = safeRemoteFailureMessage(failure))
            }
        }
    }

    fun searchTranscript(query: String) {
        transcriptSearchJob?.cancel()
        val boundedQuery = query.take(200)
        val normalized = boundedQuery.trim()
        mutableState.update {
            it.copy(
                transcriptSearchQuery = boundedQuery,
                transcriptSearchResults = if (normalized.isEmpty()) null else it.transcriptSearchResults,
                transcriptSearching = normalized.isNotEmpty(),
                transcriptSearchTruncated = false,
            )
        }
        if (normalized.isEmpty()) return
        transcriptSearchJob = viewModelScope.launch(Dispatchers.IO) {
            time.waitFor(150)
            if (mutableState.value.transcriptSearchQuery.trim() != normalized) return@launch
            val candidates = runCatching {
                cache.searchCachedOaepItems(
                    subject, organization, runtimeId.value, sessionId.value, normalized, 201,
                )
            }.getOrElse { emptyList() }
            val projected = candidates.take(200).mapNotNull(::cachedOaepMessage).filter { message ->
                listOf(message.text, message.title.orEmpty(), message.detail.orEmpty())
                    .any { it.contains(normalized, ignoreCase = true) }
            }
            if (mutableState.value.transcriptSearchQuery.trim() == normalized) {
                mutableState.update {
                    it.copy(
                        transcriptSearchResults = projected,
                        transcriptSearching = false,
                        transcriptSearchTruncated = candidates.size > 200,
                    )
                }
            }
        }
    }

    fun focusItem(itemId: String) {
        require(itemId.matches(Regex("^[A-Za-z0-9_.:-]{1,200}$")) && itemId != "." && itemId != "..") {
            "remote_notification_item_id_invalid"
        }
        if (mutableState.value.messages.any { it.id == itemId }) {
            mutableState.update { it.copy(focusItemState = RemoteFocusItemState.FOUND) }
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            mutableState.update { it.copy(focusItemState = RemoteFocusItemState.LOADING) }
            var target = cache.oaepSessionItem(
                subject, organization, runtimeId.value, sessionId.value, itemId,
            )
            if (target == null) {
                refresh().join()
                target = cache.oaepSessionItem(
                    subject, organization, runtimeId.value, sessionId.value, itemId,
                )
            }
            val projected = target?.let(::cachedOaepMessage)
            mutableState.update { state ->
                if (projected == null) {
                    state.copy(focusItemState = RemoteFocusItemState.NOT_FOUND)
                } else {
                    state.copy(
                        messages = if (state.messages.any { it.id == projected.id }) {
                            state.messages
                        } else listOf(projected) + state.messages,
                        focusItemState = RemoteFocusItemState.FOUND,
                    )
                }
            }
        }
    }

    fun refresh(): Job = viewModelScope.launch(Dispatchers.IO) {
        val requestGeneration = refreshGeneration.incrementAndGet()
        runCatching {
            container.singleFlight.run("session:${runtimeId.value}:${workspaceId.value}:${sessionId.value}") {
                val session = sessions.session(runtimeId, workspaceId, sessionId)
                require(session.lifecycle == RemoteResourceLifecycle.ACTIVE) { "remote_session_not_active" }
                coroutineScope {
                val selection = sessions.protocolSelection(runtimeId)
                container.protocolTelemetry.record(selection)
                oaepEnabled = selection.oaep
                val snapshotRequest = async {
                    if (oaepEnabled) {
                        val snapshot = oaep.snapshot(runtimeId, workspaceId, sessionId)
                        cache.replaceOaepSnapshot(
                            subject, organization, runtimeId.value, workspaceId.value,
                            snapshot, time.wallClockMillis(),
                        )
                        if (snapshot.window?.hasMore == false && snapshot.checkpoint != null) {
                            cache.verifyOaepProjectionCheckpoint(
                                subject, organization, runtimeId.value, sessionId.value, snapshot.checkpoint,
                            )
                        }
                        runCatching { cache.maintainAccountIfDue(subject, organization) }
                        val (messages, artifacts) = cachedOaepProjection()
                        Triple(messages, artifacts, snapshot.window?.nextCursor)
                    } else {
                        val snapshot = loadConversationSnapshot()
                        cache.replaceSessionSnapshot(
                            subject, organization, runtimeId.value, workspaceId.value,
                            snapshot, time.wallClockMillis(),
                        )
                        runCatching { cache.maintainAccountIfDue(subject, organization) }
                        val conversation = snapshot.toLegacyItems()
                        val messages = projectConversationMessages(conversation).map { it.toUi() }
                        val artifacts = conversation.asSequence()
                            .filter { it.kind == "artifact.created" }
                            .mapNotNull(::conversationArtifact)
                            .distinctBy { it.artifactId }
                            .toList()
                        Triple(messages, artifacts, null)
                    }
                }
                val runsRequest = async {
                    collectAllPages { cursor ->
                        runs.runs(runtimeId, workspaceId, sessionId, cursor)
                    }
                }
                val approvalsRequest = async { approvals.approvals(runtimeId, workspaceId) }
                val (messages, artifacts, historyCursor) = snapshotRequest.await()

                // Conversation is the primary screen content. Publish it as
                // soon as the authoritative Snapshot arrives; slow Run or
                // Approval metadata must not leave the chat blank.
                    if (requestGeneration == refreshGeneration.get()) {
                        userSlo.authorityRefreshed()
                        mutableState.update {
                            it.copy(
                                sessionTitle = session.title,
                                messages = messages,
                                artifacts = artifacts,
                                historyCursor = historyCursor,
                                authority = authoritativeConnection(RemoteConnectionState.ONLINE),
                            )
                        }
                    }

                    val runs = runsRequest.await()
                    val latest = runs.lastOrNull()
                    val pending = approvalsRequest.await().firstOrNull {
                        it.sessionId == sessionId &&
                            (latest == null || it.runId == latest.identity.runId)
                    }
                    LoadedSession(session, runs, messages, artifacts, emptyList(), pending, historyCursor)
                }
            }
        }.onSuccess { loaded ->
            if (requestGeneration != refreshGeneration.get()) return@onSuccess
            val latest = loaded.runs.lastOrNull()
            latestRun = latest
            activeRun = latest?.identity
            val approvalProjection = convergeApprovalProjection(
                mutableState.value.approval?.approvalId?.value,
                mutableState.value.approvalDecisionState,
                mutableState.value.approvalOutcome,
                loaded.pending?.approvalId?.value,
            )
            approvalStateMachine.restore(approvalProjection.decisionState)
            mutableState.value = RemoteChatUiState(
                runtimeName = runtimeName,
                workspaceName = workspaceName,
                sessionTitle = loaded.session.title,
                messages = loaded.messages,
                artifacts = loaded.artifacts,
                historyCursor = loaded.historyCursor,
                approval = loaded.pending?.let { approval ->
                    RemoteApprovalCard(approval.approvalId,
                        latest?.identity ?: RemoteRunIdentity(runtimeId, workspaceId, sessionId, approval.runId, approval.backendId),
                        runtimeName, workspaceName, loaded.session.title, approval.operation, approval.riskSummary,
                        approval.scope, approval.expiresAt, approval.correlationId)
                },
                authority = authoritativeSnapshot(RemoteConnectionState.ONLINE, latest?.status),
                correlationId = latest?.correlationId,
                activeRunId = latest?.identity?.runId,
                scopeKey = scopeKey,
                draft = mutableState.value.draft,
                approvalDecisionState = approvalProjection.decisionState,
                approvalOutcome = approvalProjection.outcome,
            )
            reconcilePendingRunControl()
            reconcilePendingApprovalDecision()
            authRefreshAttempted = false
            startSessionSync()
        }.onFailure { failure ->
            if (requestGeneration != refreshGeneration.get()) return@onFailure
            when {
                handleAuthoritativeRevocation(failure) -> Unit
                recoverAuthentication(failure) -> refresh()
                mutableState.value.connectionState == RemoteConnectionState.AUTH_REQUIRED -> Unit
                else -> mutableState.update {
                    it.copy(
                        authority = authoritativeSnapshot(RemoteConnectionState.OFFLINE, null),
                        messages = it.messages + RemoteMessageUi(
                            "error", "assistant", safeRemoteFailureMessage(failure),
                        ),
                    )
                }
            }
        }
    }

    fun send(message: String) = viewModelScope.launch(Dispatchers.IO) {
        if (message.isBlank() || mutableState.value.running) return@launch
        val sourceMessageId = UUID.randomUUID().toString()
        var sideEffectRequestStarted = false
        runCatching {
            if (oaepEnabled) {
                cache.saveOptimisticOaepMessage(
                    subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                    sourceMessageId, message, time.wallClockMillis(),
                )
                renderCachedOaepItems()
            } else {
                cache.saveOptimisticMessage(
                    subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                    sourceMessageId, message, time.wallClockMillis(),
                )
                renderCachedSessionItems()
            }
            val session = sessions.session(runtimeId, workspaceId, sessionId)
            if (oaepEnabled) {
                cache.markOptimisticOaepDelivery(
                    subject, organization, runtimeId.value, sessionId.value,
                    sourceMessageId, RemoteDeliveryState.SENDING, time.wallClockMillis(),
                )
                renderCachedOaepItems()
            }
            sideEffectRequestStarted = true
            userSlo.operationDispatched(sourceMessageId)
            runs.createRun(
                session, message, emptyList(), sourceMessageId,
                sourceMessageId = sourceMessageId,
            )
        }.onSuccess { identity ->
            userSlo.operationCommitted(sourceMessageId)
            activeRun = identity
            cache.markOptimisticOaepDelivery(subject, organization, runtimeId.value, sessionId.value,
                sourceMessageId, RemoteDeliveryState.ACCEPTED, time.wallClockMillis())
            drafts.clear(subject, runtimeId.value, sessionId.value)
            mutableState.update { it.copy(draft = draftStateMachine.clear().text) }
            if (oaepEnabled) reconcileOaepSession() else reconcileSession()
        }
            .onFailure { failure ->
                if (!handleAuthoritativeRevocation(failure)) {
                    val delivery = deliveryFailureState(
                        sideEffectRequestStarted,
                        failure is java.io.IOException || failure is RelayHttpException && failure.status >= 500,
                    )
                    if (oaepEnabled) {
                        cache.markOptimisticOaepDelivery(subject, organization, runtimeId.value, sessionId.value,
                            sourceMessageId, delivery, time.wallClockMillis())
                        renderCachedOaepItems()
                    }
                    mutableState.update { it.copy(messages = it.messages +
                        RemoteMessageUi("send-error-${UUID.randomUUID()}", "assistant", safeRemoteFailureMessage(failure))) }
                }
            }
    }

    fun cancel() = viewModelScope.launch(Dispatchers.IO) {
        val identity = activeRun ?: return@launch
        val pending = PendingRemoteRunControl(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
            identity.runId.value, RemoteRunControlOperation.CANCEL,
            "cancel:${identity.runId.value}", time.wallClockMillis(),
        )
        val acquired = runCatching { runControls.begin(pending) }.getOrElse {
            mutableState.update { state -> state.copy(
                runControlState = RemoteRunControlState.IDLE,
                runControlOutcome = "已有控制操作正在确认，请等待权威状态同步。",
            ) }
            return@launch
        }
        mutableState.update { it.copy(runControlState = runControlStateMachine.begin(RemoteRunControlOperation.CANCEL)) }
        runCatching { runs.cancel(identity) }
            .onSuccess { status ->
                runControls.clear(acquired)
                runControlStateMachine.settled()
                mutableState.update { it.copy(
                    authority = authoritativeRun(status),
                    runControlState = RemoteRunControlState.IDLE,
                    runControlOutcome = null,
                ) }
                refresh()
            }
            .onFailure { failure -> reconcileCancelOutcome(identity, acquired, failure) }
    }

    fun retry() = viewModelScope.launch(Dispatchers.IO) {
        val prior = latestRun ?: return@launch
        if (prior.status !in setOf(RemoteRunStatus.FAILED, RemoteRunStatus.CANCELLED)) return@launch
        val existing = runControls.pending(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
        )
        val pending = existing?.takeIf {
            it.operation == RemoteRunControlOperation.RETRY && it.runId == prior.identity.runId.value
        } ?: PendingRemoteRunControl(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
            prior.identity.runId.value, RemoteRunControlOperation.RETRY,
            "retry:${prior.identity.runId.value}", time.wallClockMillis(),
        )
        val acquired = runCatching {
            runControls.begin(pending.copy(updatedAt = time.wallClockMillis()))
        }.getOrElse {
            mutableState.update { state -> state.copy(
                runControlState = RemoteRunControlState.IDLE,
                runControlOutcome = "已有控制操作正在确认，请等待权威状态同步。",
            ) }
            return@launch
        }
        mutableState.update { it.copy(runControlState = runControlStateMachine.begin(RemoteRunControlOperation.RETRY)) }
        runCatching {
            val session = sessions.session(runtimeId, workspaceId, sessionId)
            val retryKey = acquired.idempotencyKey
            runs.createRun(
                session, prior.message, prior.attachmentRefs, retryKey, prior.identity.runId,
                sourceMessageId = retryKey,
            )
        }.onSuccess { identity ->
            runControls.clear(acquired)
            runControlStateMachine.settled()
            activeRun = identity
            mutableState.update { it.copy(
                authority = authoritativeRun(RemoteRunStatus.RUNNING),
                activeRunId = identity.runId,
                runControlState = RemoteRunControlState.IDLE,
                runControlOutcome = null,
            ) }
            refresh()
        }
            .onFailure { failure ->
                val uncertain = failure is java.io.IOException ||
                    failure is RelayHttpException && failure.status >= 500
                if (!uncertain) runControls.clear(acquired)
                runControlStateMachine.settled()
                mutableState.update { it.copy(
                    runControlState = RemoteRunControlState.IDLE,
                    runControlOutcome = if (uncertain) {
                        "重试结果尚未确认；系统会查询原幂等操作，可安全再次检查。"
                    } else null,
                    messages = it.messages + RemoteMessageUi(
                        "retry-error-${UUID.randomUUID()}", "assistant",
                        safeRemoteFailureMessage(failure),
                    ),
                ) }
            }
    }

    private suspend fun reconcileCancelOutcome(
        identity: RemoteRunIdentity,
        pending: PendingRemoteRunControl,
        failure: Throwable,
    ) {
        val authoritative = runCatching { runs.getRun(runtimeId, identity.runId).second }.getOrNull()
        if (authoritative in setOf("completed", "failed", "cancelled")) {
            runControls.clear(pending)
            runControlStateMachine.settled()
            mutableState.update { it.copy(
                runControlState = RemoteRunControlState.IDLE,
                runControlOutcome = "停止结果已与权威运行状态同步。",
            ) }
            refresh()
            return
        }
        runControlStateMachine.settled()
        mutableState.update { it.copy(
            runControlState = RemoteRunControlState.IDLE,
            runControlOutcome = "停止结果尚未确认；可安全再次停止，系统不会创建新的运行。",
            messages = it.messages + RemoteMessageUi(
                "cancel-error-${UUID.randomUUID()}", "assistant", safeRemoteFailureMessage(failure),
            ),
        ) }
    }

    private suspend fun reconcilePendingRunControl() {
        val pending = runControls.pending(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
        ) ?: return
        if (time.isWallExpired(pending.updatedAt, RUN_CONTROL_LEDGER_MAX_AGE_MS)) {
            runControls.clear(pending)
            mutableState.update { it.copy(
                runControlState = RemoteRunControlState.IDLE,
                runControlOutcome = "上次控制操作已过期，请根据当前运行状态重新操作。",
            ) }
            return
        }
        mutableState.update { it.copy(runControlState = runControlStateMachine.reconcile()) }
        when (pending.operation) {
            RemoteRunControlOperation.CANCEL -> {
                val status = runCatching {
                    runs.getRun(runtimeId, RunId(pending.runId)).second
                }.getOrNull()
                if (status in setOf("completed", "failed", "cancelled")) {
                    runControls.clear(pending)
                    mutableState.update { it.copy(
                        runControlState = RemoteRunControlState.IDLE,
                        runControlOutcome = "停止结果已与权威运行状态同步。",
                    ) }
                } else {
                    mutableState.update { it.copy(
                        runControlState = RemoteRunControlState.IDLE,
                        runControlOutcome = "上次停止结果尚未确认；可安全再次停止。",
                    ) }
                }
            }
            RemoteRunControlOperation.RETRY -> {
                val recovered = runCatching {
                    runs.recoverRun(
                        runtimeId, workspaceId, sessionId, pending.idempotencyKey,
                    )
                }.getOrNull()
                if (recovered != null) {
                    runControls.clear(pending)
                    activeRun = recovered
                    mutableState.update { it.copy(
                        authority = authoritativeRun(RemoteRunStatus.RUNNING),
                        activeRunId = recovered.runId,
                        runControlState = RemoteRunControlState.IDLE,
                        runControlOutcome = "已恢复上次重试的权威运行。",
                    ) }
                } else {
                    mutableState.update { it.copy(
                        runControlState = RemoteRunControlState.IDLE,
                        runControlOutcome = "上次重试结果尚未确认；再次重试会复用同一幂等操作。",
                    ) }
                }
            }
        }
        runControlStateMachine.settled()
    }

    fun decide(approvalId: String, decision: String) = viewModelScope.launch(Dispatchers.IO) {
        if (mutableState.value.approvalDecisionState != RemoteApprovalDecisionState.PENDING) return@launch
        val card = mutableState.value.approval?.takeIf { it.approvalId.value == approvalId }
            ?: return@launch
        val pending = PendingRemoteApprovalDecision(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
            card.identity.runId.value, approvalId, decision,
            "approval:$approvalId:$decision", time.wallClockMillis(),
        )
        val acquired = runCatching { approvalDecisions.begin(pending) }.getOrElse {
            mutableState.update { state -> state.copy(
                approvalDecisionState = RemoteApprovalDecisionState.PENDING,
                approvalOutcome = "已有审批决定正在确认，请等待权威状态同步。",
            ) }
            return@launch
        }
        mutableState.update { it.copy(approvalDecisionState = approvalStateMachine.begin()) }
        runCatching { approvals.decide(runtimeId, ApprovalId(approvalId), decision) }
            .onSuccess { status ->
                approvalDecisions.clear(acquired)
                val final = approvalStateMachine.settle(status)
                mutableState.update { it.copy(approvalDecisionState = final,
                    approvalOutcome = final.userLabel()) }
                refresh()
            }
            .onFailure { failure -> reconcileApprovalDecision(acquired, failure) }
    }

    fun openArtifact(artifactId: String) {
        val artifact = mutableState.value.artifacts.firstOrNull { it.artifactId == artifactId } ?: return
        when (RemoteNetworkPolicy().download(artifact.size, connectivity.metered.value)) {
            RemoteDownloadDecision.ALLOW -> downloadArtifact(artifactId)
            RemoteDownloadDecision.REQUIRE_CONFIRMATION -> mutableState.update {
                it.copy(pendingArtifactConfirmation = artifactId)
            }
            RemoteDownloadDecision.REJECT_TOO_LARGE -> mutableState.update { state -> state.copy(
                artifacts = state.artifacts.map {
                    if (it.artifactId == artifactId) it.copy(error = "文件过大，无法在移动端下载") else it
                },
            ) }
        }
    }

    fun confirmArtifactDownload(confirmed: Boolean) {
        val artifactId = mutableState.value.pendingArtifactConfirmation ?: return
        mutableState.update { it.copy(pendingArtifactConfirmation = null) }
        if (confirmed) downloadArtifact(artifactId)
    }

    private fun downloadArtifact(artifactId: String) = viewModelScope.launch(Dispatchers.IO) {
        val expected = mutableState.value.artifacts.firstOrNull { it.artifactId == artifactId } ?: return@launch
        mutableState.update { state -> state.copy(artifacts = state.artifacts.map {
            if (it.artifactId == artifactId) it.copy(downloading = true, error = null) else it
        }) }
        runCatching {
            val metadata = workspace.artifactMetadata(workspaceId, artifactId, UUID.randomUUID().toString(),
                UUID.randomUUID().toString()).success()
            require(metadata["workspace_id"] == workspaceId.value) { "artifact_scope_mismatch" }
            val size = (metadata["size"] as Number).toLong()
            val sha256 = metadata["sha256"] as String
            require(size == expected.size && sha256.equals(expected.sha256, ignoreCase = true)) { "artifact_metadata_changed" }
            val user = tokens.user()?.id ?: error("artifact_subject_missing")
            val directory = File(getApplication<Application>().cacheDir, "remote/artifacts").apply { mkdirs() }
            val safeName = File(metadata["display_name"] as String).name.ifBlank { "artifact-$artifactId" }
            val target = File(directory, "${sha256.take(16)}-$safeName")
            target.outputStream().use { output ->
                ArtifactDownloader().download(ArtifactMetadata(artifactId, safeName,
                    metadata["mime_type"] as String, size, sha256, runtimeId.value, workspaceId.value, user),
                    user, runtimeId.value, workspaceId.value, output) { offset, length ->
                    val chunk = workspace.artifactChunk(workspaceId, artifactId, offset, length.toLong(),
                        UUID.randomUUID().toString(), UUID.randomUUID().toString()).success()
                    Base64.decode(chunk["content_base64"] as String, Base64.DEFAULT)
                }
            }
            getApplication<Application>().startActivity(artifactOpenIntent(getApplication(), target,
                metadata["mime_type"] as String).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onSuccess {
            mutableState.update { state -> state.copy(artifacts = state.artifacts.map {
                if (it.artifactId == artifactId) it.copy(downloading = false, error = null) else it
            }) }
        }.onFailure { failure -> mutableState.update { state -> state.copy(artifacts = state.artifacts.map {
            if (it.artifactId == artifactId) it.copy(downloading = false, error = safeRemoteFailureMessage(failure)) else it
        }) } }
    }

    private suspend fun loadConversationSnapshot(): GeneratedConversationSnapshot {
        val items = mutableListOf<GeneratedSessionConversationItem>()
        var cursor: String? = null
        var snapshotSequence: Long? = null
        do {
            val page = legacy.snapshot(runtimeId, workspaceId, sessionId, cursor)
            if (snapshotSequence == null) snapshotSequence = page.snapshotSequence
            require(page.snapshotSequence == snapshotSequence) { "conversation_snapshot_changed_during_paging" }
            items += page.items
            cursor = page.nextCursor
        } while (cursor != null)
        return GeneratedConversationSnapshot(
            sessionId.value,
            snapshotSequence ?: 0,
            items.groupBy { it.itemId }.map { (_, values) -> values.maxBy { it.revision } }
                .sortedBy { it.sessionSequence },
            null,
        )
    }

    private fun GeneratedConversationSnapshot.toLegacyItems(): List<RemoteConversationItem> =
        items.mapIndexed { index, item -> item.toLegacyItem(index + 1L) }

    private fun GeneratedSessionConversationItem.toLegacyItem(projectedSequence: Long) =
        RemoteConversationItem(
            eventId = itemId,
            sequence = projectedSequence,
            kind = if (kind == "message") "message.${role ?: "system"}" else kind,
            timestamp = updatedAt,
            payload = payload.toMutableMap().apply {
                if (!containsKey("content") && containsKey("text")) put("content", get("text"))
                runId?.let { put("run_id", it) }
                sourceMessageId?.let { put("source_message_id", it) }
            },
        )

    private fun RemoteConversationItemEntity.toLegacyItem(projectedSequence: Long): RemoteConversationItem {
        val payload = JSONObject(payloadJson).keys().asSequence().associateWith {
            JSONObject(payloadJson).opt(it).takeUnless { value -> value == JSONObject.NULL }
        }.toMutableMap()
        if (!payload.containsKey("content") && payload.containsKey("text")) {
            payload["content"] = payload["text"]
        }
        runId?.let { payload["run_id"] = it }
        sourceMessageId?.let { payload["source_message_id"] = it }
        return RemoteConversationItem(
            itemId, projectedSequence,
            if (kind == "message") "message.${role ?: "system"}" else kind,
            updatedAt, payload,
        )
    }

    private suspend fun renderCachedSessionItems() {
        val items = cache.sessionItems(
            subject, organization, runtimeId.value, sessionId.value,
        ).mapIndexed { index, item -> item.toLegacyItem(index + 1L) }
        val messages = projectConversationMessages(items).map { it.toUi() }
        val artifacts = items.asSequence()
            .filter { it.kind == "artifact.created" }
            .mapNotNull(::conversationArtifact)
            .distinctBy { it.artifactId }
            .toList()
        mutableState.update { it.copy(messages = messages, artifacts = artifacts) }
    }

    private suspend fun cachedOaepProjection(): Pair<List<RemoteMessageUi>, List<RemoteArtifactUi>> {
        // Cold start must remain bounded even when Room retains a very long
        // offline transcript. Older windows stay queryable through history
        // pagination and transcript search; the active timeline only projects
        // the newest window into Compose state.
        val rows = cache.oaepSessionItemWindow(
            subject, organization, runtimeId.value, sessionId.value,
        )
        val messages = rows.mapNotNull(::cachedOaepMessage)
        val artifacts = rows.mapNotNull { item ->
            if (item.type != "artifact") return@mapNotNull null
            val content = JSONObject(item.contentJson)
            val size = content.optLong("size", -1L).takeIf { it >= 0 }
                ?: return@mapNotNull null
            val sha256 = content.optString("sha256").takeIf(String::isNotBlank)
                ?: return@mapNotNull null
            RemoteArtifactUi(
                artifactId = content.optString("artifact_id").takeIf(String::isNotBlank)
                    ?: return@mapNotNull null,
                name = content.optString("name").ifBlank { "Artifact" },
                mimeType = content.optString("mime_type").ifBlank { "application/octet-stream" },
                size = size,
                sha256 = sha256,
            )
        }.distinctBy { it.artifactId }
        return messages to artifacts
    }

    private fun cachedOaepMessage(item: RemoteOaepItemEntity): RemoteMessageUi? {
        val content = JSONObject(item.contentJson)
        val text = when (item.type) {
            "message" -> content.optString("text")
            "reasoning" -> content.optJSONArray("segments")?.let { segments ->
                (0 until segments.length()).map { segments.getJSONObject(it) }
                    .filter { it.optString("visibility", "user") == "user" }
                    .joinToString("\n") { it.optString("text") }
            }.orEmpty()
            "plan" -> content.optString("text")
            "command_execution" -> listOf(
                content.optString("display_command"), content.optString("output"),
            ).filter(String::isNotBlank).joinToString("\n")
            "tool_call" -> content.opt("result")?.takeUnless { it == JSONObject.NULL }
                ?.toString()?.takeIf(String::isNotBlank)
                ?: content.optString("tool_name")
            "file_change", "artifact", "subtask" -> content.optString("summary")
            "interaction" -> content.optString("prompt")
            "notice" -> content.optString("message")
            else -> ""
        }
        val safeText = sanitizeRemoteTranscriptText(text)
        if (safeText.isBlank()) return null
        return RemoteMessageUi(
            item.itemId,
            sanitizeRemoteTranscriptText(content.optString("role", item.type)),
            safeText,
            item.status,
            kind = item.type,
            title = oaepCachedTitle(item.type, content)?.let(::sanitizeRemoteTranscriptText),
            deliveryState = content.optString("delivery_state").takeIf(String::isNotBlank)?.let { value ->
                runCatching { RemoteDeliveryState.valueOf(value.uppercase()) }.getOrNull()
            },
        )
    }

    private suspend fun renderCachedOaepItems() {
        val (messages, artifacts) = cachedOaepProjection()
        mutableState.update { it.copy(messages = messages, artifacts = artifacts) }
    }

    private suspend fun reloadSessionProjection() {
        if (oaepEnabled) {
            reloadOaepProjection()
            return
        }
        val (snapshot, runs, approvals) = coroutineScope {
            val snapshotRequest = async { loadConversationSnapshot() }
            val runsRequest = async {
                collectAllPages { cursor ->
                    runs.runs(runtimeId, workspaceId, sessionId, cursor)
                }
            }
            val approvalsRequest = async { approvals.approvals(runtimeId, workspaceId) }
            Triple(
                snapshotRequest.await(),
                runsRequest.await(),
                approvalsRequest.await(),
            )
        }
        cache.replaceSessionSnapshot(
            subject, organization, runtimeId.value, workspaceId.value,
            snapshot, time.wallClockMillis(),
        )
        renderCachedSessionItems()
        val latest = runs.lastOrNull()
        activeRun = latest?.identity
        val pending = approvals
            .firstOrNull { it.sessionId == sessionId && (latest == null || it.runId == latest.identity.runId) }
        mutableState.update { current ->
            val approvalProjection = convergeApprovalProjection(
                current.approval?.approvalId?.value,
                current.approvalDecisionState,
                current.approvalOutcome,
                pending?.approvalId?.value,
            )
            current.copy(
                authority = authoritativeSnapshot(RemoteConnectionState.ONLINE, latest?.status),
                correlationId = latest?.correlationId,
                activeRunId = latest?.identity?.runId,
                approval = pending?.let { approval ->
                    RemoteApprovalCard(
                        approval.approvalId,
                        latest?.identity ?: RemoteRunIdentity(
                            runtimeId, workspaceId, sessionId, approval.runId, approval.backendId,
                        ),
                        runtimeName, workspaceName, current.sessionTitle, approval.operation,
                        approval.riskSummary, approval.scope, approval.expiresAt, approval.correlationId,
                    )
                },
                approvalDecisionState = approvalProjection.decisionState,
                approvalOutcome = approvalProjection.outcome,
            )
        }
    }

    private suspend fun reloadOaepProjection() {
        val (snapshot, runs, approvals) = coroutineScope {
            val snapshotRequest = async { oaep.snapshot(runtimeId, workspaceId, sessionId) }
            val runsRequest = async {
                collectAllPages { cursor -> runs.runs(runtimeId, workspaceId, sessionId, cursor) }
            }
            val approvalsRequest = async { approvals.approvals(runtimeId, workspaceId) }
            Triple(snapshotRequest.await(), runsRequest.await(), approvalsRequest.await())
        }
        cache.replaceOaepSnapshot(
            subject, organization, runtimeId.value, workspaceId.value,
            snapshot, time.wallClockMillis(),
        )
        if (snapshot.window?.hasMore == false && snapshot.checkpoint != null) {
            cache.verifyOaepProjectionCheckpoint(
                subject, organization, runtimeId.value, sessionId.value, snapshot.checkpoint,
            )
        }
        runCatching { cache.maintainAccountIfDue(subject, organization) }
        val (cachedMessages, cachedArtifacts) = cachedOaepProjection()
        val latest = runs.lastOrNull()
        latestRun = latest
        activeRun = latest?.identity
        val pending = approvals.firstOrNull {
            it.sessionId == sessionId && (latest == null || it.runId == latest.identity.runId)
        }
        mutableState.update { current ->
            val approvalProjection = convergeApprovalProjection(
                current.approval?.approvalId?.value,
                current.approvalDecisionState,
                current.approvalOutcome,
                pending?.approvalId?.value,
            )
            current.copy(
            messages = cachedMessages,
            artifacts = cachedArtifacts,
            authority = authoritativeSnapshot(RemoteConnectionState.ONLINE, latest?.status),
            correlationId = latest?.correlationId,
            activeRunId = latest?.identity?.runId,
            approval = pending?.let { approval -> RemoteApprovalCard(
                approval.approvalId,
                latest?.identity ?: RemoteRunIdentity(
                    runtimeId, workspaceId, sessionId, approval.runId, approval.backendId,
                ),
                runtimeName, workspaceName, current.sessionTitle, approval.operation,
                approval.riskSummary, approval.scope, approval.expiresAt, approval.correlationId,
            ) },
            approvalDecisionState = approvalProjection.decisionState,
            approvalOutcome = approvalProjection.outcome,
        ) }
        reconcilePendingRunControl()
    }

    private suspend fun reconcileOaepSession() {
        recoverUncertainRuns()
        var after = cache.oaepSessionCursor(
            subject, organization, runtimeId.value, sessionId.value,
        )?.lastSequence ?: 0L
        var changed = false
        while (true) {
            val page = oaep.events(runtimeId, workspaceId, sessionId, after)
            if (page.data.isEmpty()) break
            for (event in page.data) {
                when (cache.applyOaepEvent(
                    subject, organization, runtimeId.value, workspaceId.value,
                    sessionId.value, event, time.wallClockMillis(),
                )) {
                    EventDecision.APPLY -> { after = event.sequence; changed = true }
                    EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> after = maxOf(after, event.sequence)
                    EventDecision.GAP -> { reloadOaepProjection(); return }
                    EventDecision.CROSS_SCOPE -> error("remote_oaep_event_scope_mismatch")
                }
            }
            if (!page.hasMore) break
        }
        if (changed) reloadOaepProjection()
    }

    private suspend fun recoverUncertainRuns() {
        val pending = cache.uncertainOaepSourceMessageIds(
            subject, organization, runtimeId.value, sessionId.value,
        )
        for (sourceMessageId in pending) {
            val recovered = runs.recoverRun(
                runtimeId, workspaceId, sessionId, sourceMessageId,
            ) ?: continue
            activeRun = recovered
            cache.markOptimisticOaepDelivery(
                subject, organization, runtimeId.value, sessionId.value,
                sourceMessageId, RemoteDeliveryState.ACCEPTED, time.wallClockMillis(),
            )
        }
    }

    private suspend fun reconcileSession() {
        var after = cache.sessionCursor(
            subject, organization, runtimeId.value, sessionId.value,
        )?.lastSequence ?: 0L
        var changed = false
        while (true) {
            val page = legacy.events(runtimeId, workspaceId, sessionId, after)
            if (page.items.isEmpty()) break
            for (event in page.items.sortedBy { it.sessionSequence }) {
                when (
                    cache.applySessionEvent(
                        subject, organization, runtimeId.value, workspaceId.value,
                        sessionId.value, event, time.wallClockMillis(),
                    )
                ) {
                    EventDecision.APPLY -> {
                        after = event.sessionSequence
                        changed = true
                    }
                    EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> {
                        after = maxOf(after, event.sessionSequence)
                    }
                    EventDecision.GAP -> {
                        reloadSessionProjection()
                        return
                    }
                    EventDecision.CROSS_SCOPE -> error("remote_session_event_scope_mismatch")
                }
            }
            if (page.items.size < 500) break
        }
        if (changed) reloadSessionProjection()
    }

    private fun startSessionSync() {
        if (!syncStateMachine.state.shouldSubscribe || !foreground || !connectivity.online.value) return
        syncStateMachine.accept(SessionSyncEvent.Connecting)
        streamJob?.cancel()
        streamJob = viewModelScope.launch(Dispatchers.IO) {
            val retry = RemoteStreamRetryState(retryPolicy)
            while (isActive) {
                try {
                    if (oaepEnabled) {
                        reconcileOaepSession()
                        val after = cache.oaepSessionCursor(
                            subject, organization, runtimeId.value, sessionId.value,
                        )?.lastSequence ?: 0L
                        projectionStateMachine.reset(after)
                        syncStateMachine.accept(SessionSyncEvent.Streaming)
                        mutableState.update {
                            it.copy(authority = authoritativeConnection(RemoteConnectionState.ONLINE))
                        }
                        oaep.eventStream(
                            runtimeId, workspaceId, sessionId, after,
                            onConnected = {
                                userSlo.transportRestored()
                                userSlo.replayCaughtUp()?.let { observation ->
                                    viewModelScope.launch(Dispatchers.IO) {
                                        runCatching {
                                            oaep.recordReconnect(runtimeId, workspaceId, sessionId, observation)
                                        }
                                    }
                                }
                            },
                            onReceived = { event, _ ->
                                oaep.markLatencyReceived(event)
                            },
                        ).collect { event ->
                            retry.reset()
                            projectionStateMachine.observe(event.sequence)
                            val renderedNow = when (cache.applyOaepEvent(
                                subject, organization, runtimeId.value, workspaceId.value,
                                sessionId.value, event, time.wallClockMillis(),
                            )) {
                                EventDecision.APPLY -> {
                                    if (event.type == "event.item.delta") {
                                        scheduleOaepProjectionReload(event)
                                        false
                                    } else {
                                        flushOaepProjectionReload()
                                        reloadOaepProjection()
                                        true
                                    }
                                }
                                EventDecision.GAP -> {
                                    flushOaepProjectionReload()
                                    reloadOaepProjection()
                                    true
                                }
                                EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> false
                                EventDecision.CROSS_SCOPE -> error("remote_oaep_event_scope_mismatch")
                            }
                            if (renderedNow) runCatching {
                                oaep.recordLatencyRendered(
                                    runtimeId, workspaceId, sessionId, event,
                                )
                            }
                            authRefreshAttempted = false
                        }
                        throw java.io.EOFException("relay_oaep_sse_eof")
                    }
                    reconcileSession()
                    val after = cache.sessionCursor(
                        subject, organization, runtimeId.value, sessionId.value,
                    )?.lastSequence ?: 0L
                    projectionStateMachine.reset(after)
                    syncStateMachine.accept(SessionSyncEvent.Streaming)
                    mutableState.update {
                        it.copy(authority = authoritativeConnection(RemoteConnectionState.ONLINE))
                    }
                    legacy.eventStream(runtimeId, workspaceId, sessionId, after).collect { event ->
                        retry.reset()
                        projectionStateMachine.observe(event.sessionSequence)
                        when (
                            cache.applySessionEvent(
                                subject, organization, runtimeId.value, workspaceId.value,
                                sessionId.value, event, time.wallClockMillis(),
                            )
                        ) {
                            EventDecision.APPLY -> reloadSessionProjection()
                            EventDecision.GAP -> reloadSessionProjection()
                            EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> Unit
                            EventDecision.CROSS_SCOPE -> error("remote_session_event_scope_mismatch")
                        }
                        authRefreshAttempted = false
                    }
                    throw java.io.EOFException("relay_session_sse_eof")
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    userSlo.disconnected()
                    if (handleAuthoritativeRevocation(failure)) break
                    if (failure is RelayHttpException && failure.requiresSnapshotRecovery()) {
                        reloadSessionProjection()
                        continue
                    }
                    if (recoverAuthentication(failure)) continue
                    if (mutableState.value.connectionState == RemoteConnectionState.AUTH_REQUIRED) break
                    mutableState.update {
                        it.copy(authority = authoritativeConnection(RemoteConnectionState.DEGRADED))
                    }
                    val retryDelay = retry.nextDelay(failure, time.monotonicNanos()) ?: break
                    time.waitFor(retryDelay)
                }
            }
        }
    }

    private suspend fun loadAllEvents(run: RemoteRunSummary): List<RelayStreamEvent> {
        val result = mutableListOf<RelayStreamEvent>()
        var after = 0L
        do {
            val page = runs.events(run.identity, after)
            result += page.items
            after = page.nextCursor?.toLongOrNull() ?: break
        } while (true)
        return result
    }

    private suspend fun loadConversation(): List<RemoteConversationItem> {
        val result = mutableListOf<RemoteConversationItem>()
        var cursor: String? = null
        do {
            val page = sessions.conversation(runtimeId, workspaceId, sessionId, cursor)
            result += page.items
            cursor = page.nextCursor
        } while (cursor != null)
        return RemoteConversationProjection(result, null).items
    }

    private fun conversationArtifact(item: RemoteConversationItem): RemoteArtifactUi? {
        val artifactId = item.payload["artifact_id"]?.toString()?.takeIf(String::isNotBlank) ?: return null
        val size = (item.payload["size"] as? Number)?.toLong() ?: return null
        val sha256 = item.payload["sha256"]?.toString()?.takeIf(String::isNotBlank) ?: return null
        return RemoteArtifactUi(
            artifactId = artifactId,
            name = item.payload["display_name"]?.toString().orEmpty().ifBlank { "Artifact" },
            mimeType = item.payload["mime_type"]?.toString().orEmpty().ifBlank { "application/octet-stream" },
            size = size,
            sha256 = sha256,
        )
    }

    private fun oaepArtifact(item: OaepItem): RemoteArtifactUi? {
        val content = item.content as? OaepArtifactContent ?: return null
        val size = content.size ?: return null
        val sha256 = content.sha256?.takeIf(String::isNotBlank) ?: return null
        return RemoteArtifactUi(
            artifactId = content.artifactId,
            name = content.name.ifBlank { "Artifact" },
            mimeType = content.mimeType.orEmpty().ifBlank { "application/octet-stream" },
            size = size,
            sha256 = sha256,
        )
    }

    private fun startStream(identity: RemoteRunIdentity, afterSequence: Long) {
        streamJob?.cancel()
        val sequence = RemoteSequenceSynchronizer(
            afterSequence,
            fetchPage = { after -> runs.events(identity, after) },
            commit = { event ->
                cache.applyEvent(
                    cacheEntity(event), runtimeId.value, identity.runId.value,
                    event.event.sequence.toString(), time.wallClockMillis(),
                ).also { decision ->
                    if (decision == EventDecision.APPLY) applyProjectedEvent(identity, event)
                }
            },
            replaceFromSnapshot = { rebuildProjection(identity) },
        )
        synchronizer = sequence
        streamJob = viewModelScope.launch(Dispatchers.IO) {
            val retry = RemoteStreamRetryState(retryPolicy)
            while (isActive && activeRun == identity && mutableState.value.running) {
                try {
                    sequence.reconcile()
                    mutableState.update { it.copy(authority = authoritativeConnection(RemoteConnectionState.ONLINE)) }
                    runEvents.stream(identity, sequence.lastSequence).collect {
                        retry.reset()
                        sequence.accept(it)
                        authRefreshAttempted = false
                    }
                    if (settleCompletedStream(identity, sequence)) break
                    throw java.io.EOFException("relay_sse_eof")
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    if (handleAuthoritativeRevocation(failure)) break
                    if (failure is RelayHttpException && failure.requiresSnapshotRecovery()) {
                        rebuildProjection(identity)
                        continue
                    }
                    if (recoverAuthentication(failure)) continue
                    if (mutableState.value.connectionState == RemoteConnectionState.AUTH_REQUIRED) break
                    if (settleCompletedStream(identity, sequence)) break
                    mutableState.update { it.copy(authority = authoritativeConnection(RemoteConnectionState.DEGRADED)) }
                    val retryDelay = retry.nextDelay(failure, time.monotonicNanos()) ?: break
                    time.waitFor(retryDelay)
                }
            }
        }
    }

    private suspend fun settleCompletedStream(
        identity: RemoteRunIdentity,
        sequence: RemoteSequenceSynchronizer,
    ): Boolean {
        if (!mutableState.value.running) {
            mutableState.update {
                it.copy(authority = authoritativeConnection(RemoteConnectionState.ONLINE))
            }
            return true
        }
        return runCatching {
            sequence.reconcile()
            val status = runs.getRun(runtimeId, identity.runId).second
            if (!isTerminalRemoteRunStatus(status)) return@runCatching false
            rebuildProjection(identity)
            true
        }.getOrDefault(false)
    }

    private fun reconcileAndRestart(identity: RemoteRunIdentity) {
        if (mutableState.value.running) startStream(identity, synchronizer?.lastSequence ?: 0L)
    }

    private suspend fun rebuildProjection(identity: RemoteRunIdentity): Long {
        val conversation = loadConversation()
        val events = loadAllEvents(RemoteRunSummary(identity, RemoteRunStatus.RUNNING, "", "", "", emptyList()))
        val status = runs.getRun(runtimeId, identity.runId).second
        val pending = approvals.approvals(runtimeId, workspaceId)
            .firstOrNull { it.sessionId == sessionId && it.runId == identity.runId }
        val messages = projectConversationMessages(conversation).map { it.toUi() }
        val artifacts = conversation.asSequence()
            .filter { it.kind == "artifact.created" }
            .mapNotNull(::conversationArtifact)
            .distinctBy { it.artifactId }
            .toList()
        cache.replaceRunProjection(
            subject, organization, runtimeId.value, identity.runId.value,
            events.map(::cacheEntity), time.wallClockMillis(),
        )
        val last = events.maxOfOrNull { it.event.sequence } ?: 0L
        val parsedStatus = runCatching { RemoteRunStatus.valueOf(status.uppercase()) }
            .getOrDefault(RemoteRunStatus.RUNNING)
        mutableState.update { current ->
            current.copy(
                messages = messages,
                artifacts = artifacts,
                approval = pending?.let { approval ->
                    RemoteApprovalCard(
                        approval.approvalId, identity, runtimeName, workspaceName,
                        current.sessionTitle, approval.operation, approval.riskSummary,
                        approval.scope, approval.expiresAt, approval.correlationId,
                    )
                },
                authority = authoritativeSnapshot(RemoteConnectionState.ONLINE, parsedStatus),
            )
        }
        return last
    }

    private suspend fun applyProjectedEvent(identity: RemoteRunIdentity, item: RelayStreamEvent) {
        when (item.event.type) {
            "message.delta" -> enqueueDelta(identity, item.payload.optString("delta"))
            "approval.requested", "artifact.created" -> {
                flushDeltaFrames()
                rebuildProjection(identity)
            }
            "approval.resolved" -> {
                flushDeltaFrames()
                val final = approvalDecisionState(
                    item.payload.optString("decision").ifBlank { item.payload.optString("status") },
                )
                rebuildProjection(identity)
                if (final != null && final != RemoteApprovalDecisionState.PENDING) {
                    approvalStateMachine.restore(final)
                    approvalDecisions.pending(
                        subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                    )?.takeIf {
                        it.approvalId == item.payload.optString("approval_id")
                    }?.let(approvalDecisions::clear)
                    mutableState.update { it.copy(
                        approval = null,
                        approvalDecisionState = final,
                        approvalOutcome = "该请求${final.userLabel()}（可能由另一台已授权设备处理）",
                    ) }
                }
            }
            "run.completed", "run.failed", "run.cancelled" -> {
                flushDeltaFrames()
                val terminalStatus = when (item.event.type) {
                    "run.failed" -> RemoteRunStatus.FAILED
                    "run.cancelled" -> RemoteRunStatus.CANCELLED
                    else -> RemoteRunStatus.COMPLETED
                }
                runControls.pending(
                    subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                )?.takeIf {
                    it.operation == RemoteRunControlOperation.CANCEL &&
                        it.runId == identity.runId.value
                }?.let(runControls::clear)
                mutableState.update { it.copy(
                    authority = authoritativeRun(terminalStatus),
                    runControlState = RemoteRunControlState.IDLE,
                    runControlOutcome = null,
                ) }
                runControlStateMachine.settled()
            }
        }
    }

    private suspend fun reconcileApprovalDecision(
        pending: PendingRemoteApprovalDecision,
        failure: Throwable,
    ) {
        if (handleAuthoritativeRevocation(failure)) {
            approvalDecisions.clear(pending)
            return
        }
        val recovered = runCatching {
            approvals.recoverApprovalDecision(
                runtimeId, ApprovalId(pending.approvalId), pending.decision,
            )?.let(::approvalDecisionState)
        }.getOrNull()
        val audited = runCatching {
            approvals.audit(runtimeId, workspaceId, RunId(pending.runId))
                .asReversed()
                .firstNotNullOfOrNull { entry ->
                    if (entry.approvalId?.value == pending.approvalId) {
                        approvalDecisionState(entry.action)
                    } else null
                }
        }.getOrNull()
        val final = recovered?.takeIf { it != RemoteApprovalDecisionState.PENDING }
            ?: audited
        if (final != null && final != RemoteApprovalDecisionState.PENDING) {
            approvalStateMachine.restore(final)
            approvalDecisions.clear(pending)
            mutableState.update { it.copy(
                approval = null,
                approvalDecisionState = final,
                approvalOutcome = "该请求${final.userLabel()}（可能由另一台已授权设备处理）",
            ) }
            refresh()
            return
        }
        val uncertain = failure is java.io.IOException ||
            failure is RelayHttpException && failure.status >= 500
        if (!uncertain) approvalDecisions.clear(pending)
        approvalStateMachine.restore(RemoteApprovalDecisionState.PENDING)
        mutableState.update { it.copy(
            approvalDecisionState = RemoteApprovalDecisionState.PENDING,
            approvalOutcome = if (uncertain) {
                "审批结果尚未确认；再次提交相同决定会复用原幂等操作。"
            } else safeRemoteFailureMessage(failure),
        ) }
    }

    private suspend fun reconcilePendingApprovalDecision() {
        val pending = approvalDecisions.pending(
            subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
        ) ?: return
        if (time.isWallExpired(pending.updatedAt, APPROVAL_LEDGER_MAX_AGE_MS)) {
            approvalDecisions.clear(pending)
            approvalStateMachine.restore(RemoteApprovalDecisionState.PENDING)
            mutableState.update { it.copy(
                approvalDecisionState = RemoteApprovalDecisionState.PENDING,
                approvalOutcome = "上次审批操作已过期，请根据当前权威状态重新决定。",
            ) }
            return
        }
        approvalStateMachine.restore(RemoteApprovalDecisionState.PENDING)
        mutableState.update { it.copy(approvalDecisionState = approvalStateMachine.begin()) }
        val recovered = runCatching {
            approvals.recoverApprovalDecision(
                runtimeId, ApprovalId(pending.approvalId), pending.decision,
            )?.let(::approvalDecisionState)
        }.getOrNull()
        val audited = runCatching {
            approvals.audit(runtimeId, workspaceId, RunId(pending.runId))
                .asReversed()
                .firstNotNullOfOrNull { entry ->
                    if (entry.approvalId?.value == pending.approvalId) {
                        approvalDecisionState(entry.action)
                    } else null
                }
        }.getOrNull()
        val final = recovered?.takeIf { it != RemoteApprovalDecisionState.PENDING } ?: audited
        if (final != null && final != RemoteApprovalDecisionState.PENDING) {
            approvalStateMachine.restore(final)
            approvalDecisions.clear(pending)
            mutableState.update { it.copy(
                approval = null,
                approvalDecisionState = final,
                approvalOutcome = "已恢复上次审批的权威结果：${final.userLabel()}。",
            ) }
        } else {
            approvalStateMachine.restore(RemoteApprovalDecisionState.PENDING)
            mutableState.update { it.copy(
                approvalDecisionState = RemoteApprovalDecisionState.PENDING,
                approvalOutcome = "上次审批结果尚未确认；只能安全重试相同决定。",
            ) }
        }
    }

    private fun enqueueDelta(identity: RemoteRunIdentity, delta: String) {
        val forced = deltaFrames.offer(identity.runId.value, delta)
        if (forced.isNotEmpty()) applyDeltaChunks(forced)
        if (deltaFrameJob?.isActive != true) {
            deltaFrameJob = viewModelScope.launch {
                time.awaitFrame()
                applyDeltaChunks(deltaFrames.drain())
            }
        }
    }

    private fun flushDeltaFrames() {
        deltaFrameJob?.cancel()
        deltaFrameJob = null
        applyDeltaChunks(deltaFrames.drain())
    }

    private fun scheduleOaepProjectionReload(event: OaepEvent) {
        if (!oaepRenderMailbox.offer(event)) return
        oaepRenderFrameJob = viewModelScope.launch(Dispatchers.IO) {
            while (isActive) {
                time.awaitFrame()
                oaepRenderMailbox.take()?.let { renderedEvent ->
                    reloadOaepProjection()
                    runCatching {
                        oaep.recordLatencyRendered(
                            runtimeId, workspaceId, sessionId, renderedEvent,
                        )
                    }
                }
                if (oaepRenderMailbox.finishCycle()) break
            }
        }
    }

    private fun flushOaepProjectionReload() {
        oaepRenderFrameJob?.cancel()
        oaepRenderFrameJob = null
        oaepRenderMailbox.cancel()
    }

    private fun applyDeltaChunks(chunks: List<RemoteDeltaChunk>) {
        if (chunks.isEmpty()) return
        mutableState.update { state ->
            val messages = state.messages.toMutableList()
            chunks.forEach { chunk ->
                val id = "assistant-${chunk.streamId}"
                val existing = messages.indexOfFirst { it.id == id }
                if (existing >= 0) {
                    messages[existing] = messages[existing].copy(text = messages[existing].text + chunk.text)
                } else {
                    messages += RemoteMessageUi(id, "assistant", chunk.text)
                }
            }
            state.copy(messages = messages)
        }
    }

    private fun cacheEntity(item: RelayStreamEvent) = RemoteEventEntity(
        subject, organization, item.event.identity.runtimeId.value,
        item.event.identity.workspaceId.value, item.event.identity.sessionId.value,
        item.event.identity.runId.value, item.event.eventId.value, item.event.sequence,
        item.event.type, item.event.timestamp,
    )

    private fun authoritativeConnection(state: RemoteConnectionState): RemoteSessionUiAuthorityState =
        uiAuthorityReducer.accept(RemoteSessionUiAuthorityEvent.Connection(
            generation = uiAuthorityGeneration.incrementAndGet(),
            state = state,
            hasCachedContent = mutableState.value.messages.isNotEmpty(),
        ))

    private fun authoritativeRun(status: RemoteRunStatus?): RemoteSessionUiAuthorityState =
        uiAuthorityReducer.accept(RemoteSessionUiAuthorityEvent.Run(
            generation = uiAuthorityGeneration.incrementAndGet(),
            status = status,
        ))

    private fun authoritativeSnapshot(
        connection: RemoteConnectionState,
        status: RemoteRunStatus?,
    ): RemoteSessionUiAuthorityState = uiAuthorityReducer.accept(
        RemoteSessionUiAuthorityEvent.Snapshot(
            generation = uiAuthorityGeneration.incrementAndGet(),
            connection = connection,
            hasCachedContent = mutableState.value.messages.isNotEmpty(),
            runStatus = status,
        )
    )

    private fun authoritativeRun(status: String): RemoteSessionUiAuthorityState = authoritativeRun(
        runCatching { RemoteRunStatus.valueOf(status.uppercase()) }.getOrNull(),
    )

    private suspend fun recoverAuthentication(failure: Throwable): Boolean {
        if (!failure.requiresAuthentication()) return false
        if (!authRefreshAttempted) {
            authRefreshAttempted = true
            val failedToken = runCatching { auth.current() }.getOrNull()
            if (failedToken != null && auth.refreshAfter(failedToken) != null) return true
        }
        mutableState.update {
            it.copy(authority = authoritativeSnapshot(RemoteConnectionState.AUTH_REQUIRED, null))
        }
        syncStateMachine.accept(SessionSyncEvent.AuthenticationRequired)
        return false
    }

    private suspend fun handleAuthoritativeRevocation(failure: Throwable): Boolean {
        if (failure !is RelayHttpException || failure.status != 403) return false
        runCatching { runControls.clearRuntime(subject, runtimeId.value) }
        runCatching { approvalDecisions.clearRuntime(subject, runtimeId.value) }
        container.directoryCache.removeRuntime(
            subject,
            organization,
            runtimeId,
        )
        activeRun = null
        syncStateMachine.accept(SessionSyncEvent.Revoked)
        mutableState.update {
            it.copy(
                authority = authoritativeSnapshot(RemoteConnectionState.AUTH_REQUIRED, null),
                messages = listOf(
                    RemoteMessageUi(
                        "access-revoked",
                        "assistant",
                        "当前设备的远程访问授权已撤销",
                    )
                ),
                artifacts = emptyList(),
                approval = null,
            )
        }
        return true
    }

    override fun onCleared() {
        oaepRenderFrameJob?.cancel()
        oaepRenderMailbox.cancel()
        deltaFrameJob?.cancel()
        streamJob?.cancel()
        ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        resourceLease.close()
        super.onCleared()
    }

    private data class LoadedSession(
        val session: RemoteSessionRef,
        val runs: List<RemoteRunSummary>,
        val messages: List<RemoteMessageUi>,
        val artifacts: List<RemoteArtifactUi>,
        val latestEvents: List<RelayStreamEvent>,
        val pending: ai.drsai.remote.remote.data.RemoteApprovalRecord?,
        val historyCursor: String?,
    )

    private fun RemoteTranscriptMessage.toUi() = RemoteMessageUi(
        id = id,
        role = role,
        text = text,
        progress = progress,
        kind = kind,
        title = title,
        detail = detail,
        runId = runId,
        phase = phase,
        resources = resources,
        deliveryState = if (role == "user") when (progress?.lowercase()) {
            "pending" -> RemoteDeliveryState.ACCEPTED
            "in_progress", "running" -> RemoteDeliveryState.RUNNING
            "completed" -> RemoteDeliveryState.COMPLETED
            "failed", "cancelled" -> RemoteDeliveryState.FAILED
            else -> null
        } else null,
    )

    private fun oaepCachedTitle(type: String, content: JSONObject): String? = when (type) {
        "command_execution" -> "Command"
        "tool_call" -> content.optString("tool_name").takeIf(String::isNotBlank) ?: "Tool"
        "file_change" -> "File change"
        "artifact" -> content.optString("name").takeIf(String::isNotBlank) ?: "Artifact"
        "interaction" -> content.optString("interaction_type").takeIf(String::isNotBlank) ?: "Interaction"
        "subtask" -> content.optString("title").takeIf(String::isNotBlank) ?: "Subtask"
        "notice" -> content.optString("code").takeIf(String::isNotBlank) ?: "Notice"
        "reasoning" -> "Reasoning"
        "plan" -> "Plan"
        else -> null
    }

    private fun OwopResult.success(): Map<String, Any?> = when (this) {
        is OwopResult.Success -> result
        is OwopResult.Failure -> error("$code: $message")
    }

    companion object {
        private const val RUN_CONTROL_LEDGER_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
        private const val APPROVAL_LEDGER_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000

        fun factory(app: Application, runtimeId: RuntimeId, workspaceId: WorkspaceId, sessionId: SessionId,
                    runtimeName: String, workspaceName: String): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    RemoteSessionViewModel(app, runtimeId, workspaceId, sessionId, runtimeName, workspaceName) as T
            }
    }
}

internal fun isTerminalRemoteRunStatus(status: String): Boolean =
    status.uppercase() in setOf("COMPLETED", "FAILED", "CANCELLED")
