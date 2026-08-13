package ai.drsai.remote.remote.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import ai.drsai.remote.remote.data.RemoteAuditEntry
import ai.drsai.remote.remote.data.RemoteWorkspaceContainer
import ai.drsai.remote.remote.data.safeRemoteFailureMessage
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
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
    private val repository = RemoteWorkspaceContainer.get(app).boundaries.approval.client
    private val mutableState = MutableStateFlow(RemoteAuditUiState(runtimeName, workspaceName))
    val state: StateFlow<RemoteAuditUiState> = mutableState.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch(Dispatchers.IO) {
        mutableState.update { it.copy(loading = true, error = null) }
        runCatching { repository.audit(runtimeId, workspaceId, runId) }
            .onSuccess { entries -> mutableState.update { it.copy(entries = entries, loading = false) } }
            .onFailure { failure -> mutableState.update { it.copy(loading = false, error = safeRemoteFailureMessage(failure)) } }
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
