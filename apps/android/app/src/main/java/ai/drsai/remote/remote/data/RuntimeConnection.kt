package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteRuntimeEvent
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.flow.Flow

enum class RuntimeConnectionKind { LOCAL, SSH, RELAY }

data class RuntimeIdentity(
    val runtimeId: RuntimeId,
    val instanceId: String,
    val version: String,
    val protocolVersion: String,
)

data class RuntimeCapabilities(
    val values: Set<String>,
    val backendHealth: Map<String, String> = emptyMap(),
)

data class Page<T>(val items: List<T>, val nextCursor: String? = null)

data class CreateSessionCommand(
    val workspace: RemoteWorkspaceRef,
    val agentDefinitionId: String,
    val backendId: String,
    val idempotencyKey: String,
)

data class CreateRunCommand(
    val session: RemoteSessionRef,
    val message: String,
    val idempotencyKey: String,
)

interface RuntimeConnection {
    val kind: RuntimeConnectionKind
    suspend fun identity(): RuntimeIdentity
    suspend fun capabilities(): RuntimeCapabilities
    suspend fun listWorkspaces(cursor: String? = null): Page<RemoteWorkspaceRef>
    suspend fun listSessions(workspaceId: WorkspaceId, cursor: String? = null): Page<RemoteSessionRef>
    suspend fun createSession(command: CreateSessionCommand): RemoteSessionRef
    suspend fun createRun(command: CreateRunCommand): RemoteRunIdentity
    suspend fun getRun(runId: RunId): RemoteRunIdentity
    fun streamEvents(runId: RunId, afterSequence: Long): Flow<RemoteRuntimeEvent>
    suspend fun cancelRun(runId: RunId)
}

/** Provider-facing boundary. It carries Runtime semantics without owning them. */
interface RelayRuntimeService {
    suspend fun identity(runtimeId: RuntimeId): RuntimeIdentity
    suspend fun capabilities(runtimeId: RuntimeId): RuntimeCapabilities
    suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String?): Page<RemoteWorkspaceRef>
    suspend fun listSessions(runtimeId: RuntimeId, workspaceId: WorkspaceId, cursor: String?): Page<RemoteSessionRef>
    suspend fun createSession(runtimeId: RuntimeId, command: CreateSessionCommand): RemoteSessionRef
    suspend fun createRun(runtimeId: RuntimeId, command: CreateRunCommand): RemoteRunIdentity
    suspend fun getRun(runtimeId: RuntimeId, runId: RunId): RemoteRunIdentity
    fun streamEvents(runtimeId: RuntimeId, runId: RunId, afterSequence: Long): Flow<RemoteRuntimeEvent>
    suspend fun cancelRun(runtimeId: RuntimeId, runId: RunId)
}

class RelayRuntimeConnection(
    private val runtimeId: RuntimeId,
    private val relay: RelayRuntimeService,
) : RuntimeConnection {
    override val kind: RuntimeConnectionKind = RuntimeConnectionKind.RELAY

    override suspend fun identity(): RuntimeIdentity = relay.identity(runtimeId).also {
        require(it.runtimeId == runtimeId) { "relay_runtime_identity_mismatch" }
    }

    override suspend fun capabilities(): RuntimeCapabilities = relay.capabilities(runtimeId)

    override suspend fun listWorkspaces(cursor: String?): Page<RemoteWorkspaceRef> =
        relay.listWorkspaces(runtimeId, cursor).also { page ->
            require(page.items.all { it.runtimeId == runtimeId }) { "relay_workspace_runtime_mismatch" }
        }

    override suspend fun listSessions(workspaceId: WorkspaceId, cursor: String?): Page<RemoteSessionRef> =
        relay.listSessions(runtimeId, workspaceId, cursor).also { page ->
            require(page.items.all { it.runtimeId == runtimeId && it.workspaceId == workspaceId }) {
                "relay_session_scope_mismatch"
            }
        }

    override suspend fun createSession(command: CreateSessionCommand): RemoteSessionRef {
        require(command.workspace.runtimeId == runtimeId) { "relay_workspace_runtime_mismatch" }
        return relay.createSession(runtimeId, command).also {
            require(it.runtimeId == runtimeId && it.workspaceId == command.workspace.workspaceId) {
                "relay_session_scope_mismatch"
            }
        }
    }

    override suspend fun createRun(command: CreateRunCommand): RemoteRunIdentity {
        require(command.session.runtimeId == runtimeId) { "relay_session_runtime_mismatch" }
        return relay.createRun(runtimeId, command).also {
            require(it.runtimeId == runtimeId && it.workspaceId == command.session.workspaceId &&
                it.sessionId == command.session.sessionId && it.backendId == command.session.backendId) {
                "relay_run_scope_mismatch"
            }
        }
    }

    override suspend fun getRun(runId: RunId): RemoteRunIdentity = relay.getRun(runtimeId, runId).also {
        require(it.runtimeId == runtimeId && it.runId == runId) { "relay_run_scope_mismatch" }
    }

    override fun streamEvents(runId: RunId, afterSequence: Long): Flow<RemoteRuntimeEvent> {
        require(afterSequence >= 0) { "after_sequence_invalid" }
        return relay.streamEvents(runtimeId, runId, afterSequence)
    }

    override suspend fun cancelRun(runId: RunId) = relay.cancelRun(runtimeId, runId)
}

/**
 * Delegates to exactly one selected remote Runtime. There is deliberately no
 * local or alternate-backend fallback path.
 */
class RemoteRuntimeDelegator(private val connection: RuntimeConnection) {
    suspend fun createRun(command: CreateRunCommand): RemoteRunIdentity = connection.createRun(command)
    suspend fun cancel(runId: RunId) = connection.cancelRun(runId)
}

