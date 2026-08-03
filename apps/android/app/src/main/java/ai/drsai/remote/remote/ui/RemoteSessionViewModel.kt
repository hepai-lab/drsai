package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.room.Room
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
import ai.drsai.remote.remote.data.*
import android.content.Intent
import android.util.Base64
import java.io.File
import ai.drsai.remote.remote.model.*
import ai.drsai.remote.remote.generated.*
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import org.json.JSONObject
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
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
    private val tokens = SecureTokenStore(app)
    private val auth = AccessTokenCoordinator(tokens, OidcClient(refreshClientId = { tokens.oidcClientId }))
    private val deviceProof = androidRelayDeviceProof(app)
    private val repository = RelayRemoteRepository(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        refreshAfter = auth::refreshAfter,
        deviceProof = deviceProof,
    )
    private val stream = RelaySseClient(
        BuildConfig.RELAY_BASE_URL,
        auth::current,
        refreshAfter = auth::refreshAfter,
        deviceProof = deviceProof,
    )
    private val workspace = RelayWorkspaceOperationsClient(
        HttpOwopRelayTransport(
            BuildConfig.RELAY_BASE_URL,
            runtimeId,
            auth::current,
            deviceProof = deviceProof,
        )
    )
    private val database = Room.databaseBuilder(app, ChatDatabase::class.java, "opendrsai.db")
        .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11)
        .build()
    private val cache = RemoteCacheRepository(database)
    private val connectivity = AndroidRemoteConnectivity(app)
    private val subject get() = tokens.user()?.id ?: error("remote_subject_required")
    private val organization = ""
    private val scopeKey = "${runtimeId.value}/${workspaceId.value}/${sessionId.value}"
    private val mutableState = MutableStateFlow(RemoteChatUiState(runtimeName, workspaceName, sessionId.value, scopeKey = scopeKey))
    val state: StateFlow<RemoteChatUiState> = mutableState.asStateFlow()
    private var streamJob: Job? = null
    private var activeRun: RemoteRunIdentity? = null
    private var synchronizer: RemoteSequenceSynchronizer? = null
    private var authRefreshAttempted = false
    @Volatile private var oaepEnabled = false
    private val lifecycleObserver = object : DefaultLifecycleObserver {
        override fun onStart(owner: LifecycleOwner) {
            startSessionSync()
        }
    }

    init {
        AndroidDevicePresence.markAccessing(runtimeId)
        ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)
        viewModelScope.launch {
            connectivity.online.drop(1).collect { online ->
                mutableState.update { it.copy(online = online,
                    connectionState = if (online) RemoteConnectionState.CONNECTING else RemoteConnectionState.OFFLINE) }
                if (online) startSessionSync() else streamJob?.cancel()
            }
        }
        refresh()
    }

    fun refresh(): Job = viewModelScope.launch(Dispatchers.IO) {
        runCatching {
            val session = repository.session(runtimeId, workspaceId, sessionId)
            require(session.lifecycle == RemoteResourceLifecycle.ACTIVE) { "remote_session_not_active" }
            coroutineScope {
                val selection = repository.protocolSelection(runtimeId)
                oaepEnabled = selection.oaep
                val snapshotRequest = async {
                    if (oaepEnabled) {
                        val snapshot = repository.oaepSnapshot(runtimeId, workspaceId, sessionId)
                        cache.replaceOaepSnapshot(
                            subject, organization, runtimeId.value, workspaceId.value,
                            snapshot, System.currentTimeMillis(),
                        )
                        val messages = projectOaepMessages(snapshot.items).map { it.toUi() }
                        val artifacts = snapshot.items.mapNotNull(::oaepArtifact).distinctBy { it.artifactId }
                        messages to artifacts
                    } else {
                        val snapshot = loadConversationSnapshot()
                        cache.replaceSessionSnapshot(
                            subject, organization, runtimeId.value, workspaceId.value,
                            snapshot, System.currentTimeMillis(),
                        )
                        val conversation = snapshot.toLegacyItems()
                        val messages = projectConversationMessages(conversation).map { it.toUi() }
                        val artifacts = conversation.asSequence()
                            .filter { it.kind == "artifact.created" }
                            .mapNotNull(::conversationArtifact)
                            .distinctBy { it.artifactId }
                            .toList()
                        messages to artifacts
                    }
                }
                val runsRequest = async {
                    collectAllPages { cursor ->
                        repository.runs(runtimeId, workspaceId, sessionId, cursor)
                    }
                }
                val approvalsRequest = async { repository.approvals(runtimeId, workspaceId) }
                val (messages, artifacts) = snapshotRequest.await()

                // Conversation is the primary screen content. Publish it as
                // soon as the authoritative Snapshot arrives; slow Run or
                // Approval metadata must not leave the chat blank.
                mutableState.update {
                    it.copy(
                        sessionTitle = session.title,
                        messages = messages,
                        artifacts = artifacts,
                        online = true,
                        connectionState = RemoteConnectionState.ONLINE,
                    )
                }

                val runs = runsRequest.await()
                val latest = runs.lastOrNull()
                val pending = approvalsRequest.await().firstOrNull {
                    it.sessionId == sessionId &&
                        (latest == null || it.runId == latest.identity.runId)
                }
                LoadedSession(session, runs, messages, artifacts, emptyList(), pending)
            }
        }.onSuccess { loaded ->
            val latest = loaded.runs.lastOrNull()
            activeRun = latest?.identity
            mutableState.value = RemoteChatUiState(
                runtimeName = runtimeName,
                workspaceName = workspaceName,
                sessionTitle = loaded.session.title,
                messages = loaded.messages,
                artifacts = loaded.artifacts,
                approval = loaded.pending?.let { approval ->
                    RemoteApprovalCard(approval.approvalId,
                        latest?.identity ?: RemoteRunIdentity(runtimeId, workspaceId, sessionId, approval.runId, approval.backendId),
                        runtimeName, workspaceName, loaded.session.title, approval.operation, approval.riskSummary,
                        approval.scope, approval.expiresAt, approval.correlationId)
                },
                running = latest?.status in setOf(RemoteRunStatus.QUEUED, RemoteRunStatus.RUNNING, RemoteRunStatus.WAITING_APPROVAL),
                online = true,
                correlationId = latest?.correlationId,
                activeRunId = latest?.identity?.runId,
                scopeKey = scopeKey,
                connectionState = RemoteConnectionState.ONLINE,
            )
            authRefreshAttempted = false
            startSessionSync()
        }.onFailure { failure ->
            when {
                handleAuthoritativeRevocation(failure) -> Unit
                recoverAuthentication(failure) -> refresh()
                mutableState.value.connectionState == RemoteConnectionState.AUTH_REQUIRED -> Unit
                else -> mutableState.update {
                    it.copy(
                        online = false,
                        running = false,
                        connectionState = RemoteConnectionState.OFFLINE,
                        messages = it.messages + RemoteMessageUi(
                            "error", "assistant", failure.message ?: "远程会话加载失败",
                        ),
                    )
                }
            }
        }
    }

    fun send(message: String) = viewModelScope.launch(Dispatchers.IO) {
        if (message.isBlank() || mutableState.value.running) return@launch
        val sourceMessageId = UUID.randomUUID().toString()
        runCatching {
            val session = repository.session(runtimeId, workspaceId, sessionId)
            if (oaepEnabled) {
                cache.saveOptimisticOaepMessage(
                    subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                    sourceMessageId, message, System.currentTimeMillis(),
                )
                renderCachedOaepItems()
            } else {
                cache.saveOptimisticMessage(
                    subject, organization, runtimeId.value, workspaceId.value, sessionId.value,
                    sourceMessageId, message, System.currentTimeMillis(),
                )
                renderCachedSessionItems()
            }
            repository.createRun(
                session, message, emptyList(), sourceMessageId,
                sourceMessageId = sourceMessageId,
            )
        }.onSuccess { if (oaepEnabled) reconcileOaepSession() else reconcileSession() }
            .onFailure { failure ->
                if (!handleAuthoritativeRevocation(failure)) {
                    mutableState.update { it.copy(messages = it.messages +
                        RemoteMessageUi("send-error-${UUID.randomUUID()}", "assistant", failure.message ?: "发送失败")) }
                }
            }
    }

    fun cancel() = viewModelScope.launch(Dispatchers.IO) {
        activeRun?.let { identity -> runCatching { repository.cancel(identity) }.onSuccess { refresh() } }
    }

    fun decide(approvalId: String, decision: String) = viewModelScope.launch(Dispatchers.IO) {
        runCatching { repository.decide(runtimeId, ApprovalId(approvalId), decision) }.onSuccess { refresh() }
    }

    fun openArtifact(artifactId: String) = viewModelScope.launch(Dispatchers.IO) {
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
            if (it.artifactId == artifactId) it.copy(downloading = false, error = failure.message ?: "Artifact 下载失败") else it
        }) } }
    }

    private suspend fun loadConversationSnapshot(): GeneratedConversationSnapshot {
        val items = mutableListOf<GeneratedSessionConversationItem>()
        var cursor: String? = null
        var snapshotSequence: Long? = null
        do {
            val page = repository.conversationSnapshot(runtimeId, workspaceId, sessionId, cursor)
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

    private suspend fun renderCachedOaepItems() {
        val messages = cache.oaepSessionItems(
            subject, organization, runtimeId.value, sessionId.value,
        ).mapNotNull { item ->
            val content = JSONObject(item.contentJson)
            val text = when (item.type) {
                "message" -> content.optString("text")
                "reasoning" -> content.optJSONArray("segments")?.let { segments ->
                    (0 until segments.length()).joinToString("\n") {
                        segments.getJSONObject(it).optString("text")
                    }
                }.orEmpty()
                "plan" -> content.optString("text")
                "command_execution" -> listOf(
                    content.optString("display_command"), content.optString("output"),
                ).filter(String::isNotBlank).joinToString("\n")
                "tool_call" -> content.optString("tool_name")
                "file_change", "artifact", "subtask" -> content.optString("summary")
                "interaction" -> content.optString("prompt")
                "notice" -> content.optString("message")
                else -> ""
            }
            val safeText = sanitizeRemoteTranscriptText(text)
            safeText.takeIf(String::isNotBlank)?.let {
                RemoteMessageUi(
                    item.itemId,
                    sanitizeRemoteTranscriptText(content.optString("role", item.type)),
                    safeText,
                    item.status,
                    kind = item.type,
                    title = oaepCachedTitle(item.type, content)?.let(::sanitizeRemoteTranscriptText),
                )
            }
        }
        mutableState.update { it.copy(messages = messages) }
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
                    repository.runs(runtimeId, workspaceId, sessionId, cursor)
                }
            }
            val approvalsRequest = async { repository.approvals(runtimeId, workspaceId) }
            Triple(
                snapshotRequest.await(),
                runsRequest.await(),
                approvalsRequest.await(),
            )
        }
        cache.replaceSessionSnapshot(
            subject, organization, runtimeId.value, workspaceId.value,
            snapshot, System.currentTimeMillis(),
        )
        renderCachedSessionItems()
        val latest = runs.lastOrNull()
        activeRun = latest?.identity
        val pending = approvals
            .firstOrNull { it.sessionId == sessionId && (latest == null || it.runId == latest.identity.runId) }
        mutableState.update { current ->
            current.copy(
                running = latest?.status in setOf(
                    RemoteRunStatus.QUEUED,
                    RemoteRunStatus.RUNNING,
                    RemoteRunStatus.WAITING_APPROVAL,
                ),
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
                online = true,
                connectionState = RemoteConnectionState.ONLINE,
            )
        }
    }

    private suspend fun reloadOaepProjection() {
        val (snapshot, runs, approvals) = coroutineScope {
            val snapshotRequest = async { repository.oaepSnapshot(runtimeId, workspaceId, sessionId) }
            val runsRequest = async {
                collectAllPages { cursor -> repository.runs(runtimeId, workspaceId, sessionId, cursor) }
            }
            val approvalsRequest = async { repository.approvals(runtimeId, workspaceId) }
            Triple(snapshotRequest.await(), runsRequest.await(), approvalsRequest.await())
        }
        cache.replaceOaepSnapshot(
            subject, organization, runtimeId.value, workspaceId.value,
            snapshot, System.currentTimeMillis(),
        )
        val latest = runs.lastOrNull()
        activeRun = latest?.identity
        val pending = approvals.firstOrNull {
            it.sessionId == sessionId && (latest == null || it.runId == latest.identity.runId)
        }
        mutableState.update { current -> current.copy(
            messages = projectOaepMessages(snapshot.items).map { it.toUi() },
            artifacts = snapshot.items.mapNotNull(::oaepArtifact).distinctBy { it.artifactId },
            running = latest?.status in setOf(
                RemoteRunStatus.QUEUED, RemoteRunStatus.RUNNING, RemoteRunStatus.WAITING_APPROVAL,
            ),
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
            online = true,
            connectionState = RemoteConnectionState.ONLINE,
        ) }
    }

    private suspend fun reconcileOaepSession() {
        var after = cache.oaepSessionCursor(
            subject, organization, runtimeId.value, sessionId.value,
        )?.lastSequence ?: 0L
        var changed = false
        while (true) {
            val page = repository.oaepEvents(runtimeId, workspaceId, sessionId, after)
            if (page.data.isEmpty()) break
            for (event in page.data) {
                when (cache.applyOaepEvent(
                    subject, organization, runtimeId.value, workspaceId.value,
                    sessionId.value, event, System.currentTimeMillis(),
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

    private suspend fun reconcileSession() {
        var after = cache.sessionCursor(
            subject, organization, runtimeId.value, sessionId.value,
        )?.lastSequence ?: 0L
        var changed = false
        while (true) {
            val page = repository.sessionEvents(runtimeId, workspaceId, sessionId, after)
            if (page.items.isEmpty()) break
            for (event in page.items.sortedBy { it.sessionSequence }) {
                when (
                    cache.applySessionEvent(
                        subject, organization, runtimeId.value, workspaceId.value,
                        sessionId.value, event, System.currentTimeMillis(),
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
        if (!connectivity.online.value) return
        streamJob?.cancel()
        streamJob = viewModelScope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive) {
                try {
                    if (oaepEnabled) {
                        reconcileOaepSession()
                        val after = cache.oaepSessionCursor(
                            subject, organization, runtimeId.value, sessionId.value,
                        )?.lastSequence ?: 0L
                        mutableState.update {
                            it.copy(online = true, connectionState = RemoteConnectionState.ONLINE)
                        }
                        attempt = 0
                        stream.oaepSessionStream(
                            runtimeId, workspaceId, sessionId, after,
                        ).collect { event ->
                            when (cache.applyOaepEvent(
                                subject, organization, runtimeId.value, workspaceId.value,
                                sessionId.value, event, System.currentTimeMillis(),
                            )) {
                                EventDecision.APPLY -> reloadOaepProjection()
                                EventDecision.GAP -> reloadOaepProjection()
                                EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> Unit
                                EventDecision.CROSS_SCOPE -> error("remote_oaep_event_scope_mismatch")
                            }
                            authRefreshAttempted = false
                        }
                        throw java.io.EOFException("relay_oaep_sse_eof")
                    }
                    reconcileSession()
                    val after = cache.sessionCursor(
                        subject, organization, runtimeId.value, sessionId.value,
                    )?.lastSequence ?: 0L
                    mutableState.update {
                        it.copy(online = true, connectionState = RemoteConnectionState.ONLINE)
                    }
                    attempt = 0
                    stream.sessionStream(runtimeId, workspaceId, sessionId, after).collect { event ->
                        when (
                            cache.applySessionEvent(
                                subject, organization, runtimeId.value, workspaceId.value,
                                sessionId.value, event, System.currentTimeMillis(),
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
                    if (handleAuthoritativeRevocation(failure)) break
                    if (failure is RelayHttpException && failure.requiresSnapshotRecovery()) {
                        reloadSessionProjection()
                        continue
                    }
                    if (recoverAuthentication(failure)) continue
                    if (mutableState.value.connectionState == RemoteConnectionState.AUTH_REQUIRED) break
                    mutableState.update {
                        it.copy(online = false, connectionState = RemoteConnectionState.DEGRADED)
                    }
                    delay((500L * (1L shl attempt.coerceAtMost(6))).coerceAtMost(30_000L))
                    attempt += 1
                }
            }
        }
    }

    private suspend fun loadAllEvents(run: RemoteRunSummary): List<RelayStreamEvent> {
        val result = mutableListOf<RelayStreamEvent>()
        var after = 0L
        do {
            val page = repository.events(run.identity, after)
            result += page.items
            after = page.nextCursor?.toLongOrNull() ?: break
        } while (true)
        return result
    }

    private suspend fun loadConversation(): List<RemoteConversationItem> {
        val result = mutableListOf<RemoteConversationItem>()
        var cursor: String? = null
        do {
            val page = repository.conversation(runtimeId, workspaceId, sessionId, cursor)
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
            fetchPage = { after -> repository.events(identity, after) },
            commit = { event ->
                cache.applyEvent(
                    cacheEntity(event), runtimeId.value, identity.runId.value,
                    event.event.sequence.toString(), System.currentTimeMillis(),
                ).also { decision ->
                    if (decision == EventDecision.APPLY) applyProjectedEvent(identity, event)
                }
            },
            replaceFromSnapshot = { rebuildProjection(identity) },
        )
        synchronizer = sequence
        streamJob = viewModelScope.launch(Dispatchers.IO) {
            var attempt = 0
            while (isActive && activeRun == identity && mutableState.value.running) {
                try {
                    sequence.reconcile()
                    mutableState.update { it.copy(online = true, connectionState = RemoteConnectionState.ONLINE) }
                    attempt = 0
                    stream.stream(identity, sequence.lastSequence).collect {
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
                    mutableState.update { it.copy(online = false, connectionState = RemoteConnectionState.DEGRADED) }
                    delay((500L * (1L shl attempt.coerceAtMost(6))).coerceAtMost(30_000L))
                    attempt += 1
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
                it.copy(online = true, connectionState = RemoteConnectionState.ONLINE)
            }
            return true
        }
        return runCatching {
            sequence.reconcile()
            val status = repository.getRun(runtimeId, identity.runId).second
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
        val status = repository.getRun(runtimeId, identity.runId).second
        val pending = repository.approvals(runtimeId, workspaceId)
            .firstOrNull { it.sessionId == sessionId && it.runId == identity.runId }
        val messages = projectConversationMessages(conversation).map { it.toUi() }
        val artifacts = conversation.asSequence()
            .filter { it.kind == "artifact.created" }
            .mapNotNull(::conversationArtifact)
            .distinctBy { it.artifactId }
            .toList()
        cache.replaceRunProjection(
            subject, organization, runtimeId.value, identity.runId.value,
            events.map(::cacheEntity), System.currentTimeMillis(),
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
                running = parsedStatus in setOf(
                    RemoteRunStatus.QUEUED, RemoteRunStatus.RUNNING, RemoteRunStatus.WAITING_APPROVAL,
                ),
                online = true,
                connectionState = RemoteConnectionState.ONLINE,
            )
        }
        return last
    }

    private suspend fun applyProjectedEvent(identity: RemoteRunIdentity, item: RelayStreamEvent) {
        when (item.event.type) {
            "message.delta" -> mutableState.update { state ->
                val id = "assistant-${identity.runId.value}"
                val existing = state.messages.indexOfFirst { it.id == id }
                val messages = state.messages.toMutableList()
                val delta = item.payload.optString("delta")
                if (existing >= 0) {
                    messages[existing] = messages[existing].copy(text = messages[existing].text + delta)
                } else {
                    messages += RemoteMessageUi(id, "assistant", delta)
                }
                state.copy(messages = messages)
            }
            "approval.requested", "approval.resolved", "artifact.created" -> rebuildProjection(identity)
            "run.completed", "run.failed", "run.cancelled" ->
                mutableState.update { it.copy(running = false) }
        }
    }

    private fun cacheEntity(item: RelayStreamEvent) = RemoteEventEntity(
        subject, organization, item.event.identity.runtimeId.value,
        item.event.identity.workspaceId.value, item.event.identity.sessionId.value,
        item.event.identity.runId.value, item.event.eventId.value, item.event.sequence,
        item.event.type, item.event.timestamp,
    )

    private suspend fun recoverAuthentication(failure: Throwable): Boolean {
        if (!failure.requiresAuthentication()) return false
        if (!authRefreshAttempted) {
            authRefreshAttempted = true
            val failedToken = runCatching { auth.current() }.getOrNull()
            if (failedToken != null && auth.refreshAfter(failedToken) != null) return true
        }
        mutableState.update {
            it.copy(online = false, running = false, connectionState = RemoteConnectionState.AUTH_REQUIRED)
        }
        return false
    }

    private suspend fun handleAuthoritativeRevocation(failure: Throwable): Boolean {
        if (failure !is RelayHttpException || failure.status != 403) return false
        RoomRemoteDirectoryCache(database).removeRuntime(
            subject,
            organization,
            runtimeId,
        )
        activeRun = null
        mutableState.update {
            it.copy(
                online = false,
                running = false,
                connectionState = RemoteConnectionState.AUTH_REQUIRED,
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
        streamJob?.cancel()
        ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        connectivity.close()
        database.close()
        super.onCleared()
    }

    private data class LoadedSession(
        val session: RemoteSessionRef,
        val runs: List<RemoteRunSummary>,
        val messages: List<RemoteMessageUi>,
        val artifacts: List<RemoteArtifactUi>,
        val latestEvents: List<RelayStreamEvent>,
        val pending: ai.drsai.remote.remote.data.RemoteApprovalRecord?,
    )

    private fun RemoteTranscriptMessage.toUi() = RemoteMessageUi(
        id = id,
        role = role,
        text = text,
        progress = progress,
        kind = kind,
        title = title,
        detail = detail,
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
