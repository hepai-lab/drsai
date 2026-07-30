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
import ai.drsai.remote.remote.data.RemoteAuditEntry
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.security.androidRelayDeviceProof
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RemoteAuditUiState(
    val runtimeName: String,
    val workspaceName: String,
    val entries: List<RemoteAuditEntry> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

class RemoteAuditViewModel(
    app: Application,
    private val runtimeId: RuntimeId,
    private val workspaceId: WorkspaceId,
    private val runId: RunId,
    runtimeName: String,
    workspaceName: String,
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
    private val mutableState = MutableStateFlow(RemoteAuditUiState(runtimeName, workspaceName))
    val state: StateFlow<RemoteAuditUiState> = mutableState.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(loading = true, error = null) }
        runCatching { repository.audit(runtimeId, workspaceId, runId) }
            .onSuccess { entries -> mutableState.update { it.copy(entries = entries, loading = false) } }
            .onFailure { failure -> mutableState.update { it.copy(loading = false, error = failure.message ?: "审计记录加载失败") } }
    }

    companion object {
        fun factory(app: Application, runtimeId: RuntimeId, workspaceId: WorkspaceId, runId: RunId,
                    runtimeName: String, workspaceName: String): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    RemoteAuditViewModel(app, runtimeId, workspaceId, runId, runtimeName, workspaceName) as T
            }
    }
}
