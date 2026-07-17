package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.BuildConfig
import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.data.RelayStreamEvent
import ai.drsai.remote.remote.data.RemoteRunSummary
import ai.drsai.remote.remote.data.collectAllPages
import ai.drsai.remote.remote.data.ArtifactDownloader
import ai.drsai.remote.remote.data.ArtifactMetadata
import ai.drsai.remote.remote.data.HttpOwopRelayTransport
import ai.drsai.remote.remote.data.RelayWorkspaceOperationsClient
import ai.drsai.remote.remote.data.OwopResult
import ai.drsai.remote.remote.data.artifactOpenIntent
import android.content.Intent
import android.util.Base64
import java.io.File
import ai.drsai.remote.remote.model.*
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
    private val repository = RelayRemoteRepository(BuildConfig.RELAY_BASE_URL, auth::current)
    private val stream = RelaySseClient(BuildConfig.RELAY_BASE_URL, auth::current)
    private val workspace = RelayWorkspaceOperationsClient(HttpOwopRelayTransport(BuildConfig.RELAY_BASE_URL, runtimeId, auth::current))
    private val scopeKey = "${runtimeId.value}/${workspaceId.value}/${sessionId.value}"
    private val mutableState = MutableStateFlow(RemoteChatUiState(runtimeName, workspaceName, sessionId.value, scopeKey = scopeKey))
    val state: StateFlow<RemoteChatUiState> = mutableState.asStateFlow()
    private var streamJob: Job? = null
    private var activeRun: RemoteRunIdentity? = null

    init { refresh() }

    fun refresh() = viewModelScope.launch(Dispatchers.IO) {
        runCatching {
            val session = repository.session(runtimeId, workspaceId, sessionId)
            val runs = collectAllPages { cursor -> repository.runs(runtimeId, workspaceId, sessionId, cursor) }
            val messages = mutableListOf<RemoteMessageUi>()
            val artifacts = mutableListOf<RemoteArtifactUi>()
            var latestEvents = emptyList<RelayStreamEvent>()
            runs.forEach { run ->
                if (run.message.isNotBlank()) messages += RemoteMessageUi("user-${run.identity.runId.value}", "user", run.message)
                val events = loadAllEvents(run)
                if (run == runs.lastOrNull()) latestEvents = events
                val text = events.filter { it.event.type == "message.delta" }
                    .joinToString("") { it.payload.optString("delta") }
                val progress = events.lastOrNull { it.event.type.startsWith("tool.") }?.event?.type
                if (text.isNotBlank() || progress != null) {
                    messages += RemoteMessageUi("assistant-${run.identity.runId.value}", "assistant", text, progress)
                }
                events.filter { it.event.type == "artifact.created" }.forEach { event ->
                    artifacts += RemoteArtifactUi(
                        event.payload.getString("artifact_id"), event.payload.optString("display_name", "Artifact"),
                        event.payload.optString("mime_type", "application/octet-stream"), event.payload.getLong("size"),
                        event.payload.getString("sha256"),
                    )
                }
            }
            val latest = runs.lastOrNull()
            val pending = repository.approvals(runtimeId, workspaceId)
                .firstOrNull { it.sessionId == sessionId && (latest == null || it.runId == latest.identity.runId) }
            LoadedSession(session, runs, messages, artifacts.distinctBy { it.artifactId }, latestEvents, pending)
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
            )
            if (latest != null && mutableState.value.running) {
                startStream(latest.identity, loaded.latestEvents.maxOfOrNull { it.event.sequence } ?: 0)
            }
        }.onFailure { failure -> mutableState.update { it.copy(online = false, running = false,
            messages = it.messages + RemoteMessageUi("error", "assistant", failure.message ?: "远程会话加载失败")) } }
    }

    fun send(message: String) = viewModelScope.launch(Dispatchers.IO) {
        if (message.isBlank() || mutableState.value.running) return@launch
        runCatching {
            val session = repository.session(runtimeId, workspaceId, sessionId)
            repository.createRun(session, message, emptyList(), UUID.randomUUID().toString())
        }.onSuccess { refresh() }
            .onFailure { failure -> mutableState.update { it.copy(messages = it.messages +
                RemoteMessageUi("send-error-${UUID.randomUUID()}", "assistant", failure.message ?: "发送失败")) } }
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

    private fun startStream(identity: RemoteRunIdentity, afterSequence: Long) {
        streamJob?.cancel()
        streamJob = viewModelScope.launch {
            runCatching {
                stream.stream(identity, afterSequence).collect { item ->
                    when (item.event.type) {
                        "message.delta" -> mutableState.update { state ->
                            val id = "assistant-${identity.runId.value}"
                            val existing = state.messages.indexOfFirst { it.id == id }
                            val delta = item.payload.optString("delta")
                            val messages = state.messages.toMutableList()
                            if (existing >= 0) messages[existing] = messages[existing].copy(text = messages[existing].text + delta)
                            else messages += RemoteMessageUi(id, "assistant", delta)
                            state.copy(messages = messages)
                        }
                        "approval.requested", "approval.resolved" -> refresh()
                        "artifact.created" -> refresh()
                        "run.completed", "run.failed", "run.cancelled" -> mutableState.update { it.copy(running = false) }
                    }
                }
            }.onFailure { mutableState.update { it.copy(online = false) } }
        }
    }

    override fun onCleared() { streamJob?.cancel(); super.onCleared() }

    private data class LoadedSession(
        val session: RemoteSessionRef,
        val runs: List<RemoteRunSummary>,
        val messages: List<RemoteMessageUi>,
        val artifacts: List<RemoteArtifactUi>,
        val latestEvents: List<RelayStreamEvent>,
        val pending: ai.drsai.remote.remote.data.RemoteApprovalRecord?,
    )

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
