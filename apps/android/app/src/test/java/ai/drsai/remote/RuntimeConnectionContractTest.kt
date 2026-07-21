package ai.drsai.remote

import ai.drsai.remote.remote.data.CreateRunCommand
import ai.drsai.remote.remote.data.CreateSessionCommand
import ai.drsai.remote.remote.data.Page
import ai.drsai.remote.remote.data.RelayRuntimeConnection
import ai.drsai.remote.remote.data.RelayRuntimeService
import ai.drsai.remote.remote.data.RuntimeCapabilities
import ai.drsai.remote.remote.data.RuntimeConnection
import ai.drsai.remote.remote.data.RuntimeConnectionKind
import ai.drsai.remote.remote.data.RuntimeIdentity
import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteRuntimeEvent
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RuntimeConnectionContractTest {
    @Test
    fun localSshFixtureAndRelayUseTheSameRuntimeContract() = runTest {
        val service = ContractService()
        val connections = listOf(
            FixtureConnection(RuntimeConnectionKind.LOCAL, service),
            FixtureConnection(RuntimeConnectionKind.SSH, service),
            RelayRuntimeConnection(service.runtimeId, service),
        )
        connections.forEach { verifyContract(it, service.runtimeId) }
    }

    private suspend fun verifyContract(connection: RuntimeConnection, runtimeId: RuntimeId) {
        assertEquals(runtimeId, connection.identity().runtimeId)
        val workspace = connection.listWorkspaces().items.single()
        val session = connection.createSession(
            CreateSessionCommand(workspace, "agent@1", "opendrsai", "session-key-${connection.kind}")
        )
        val run = connection.createRun(CreateRunCommand(session, "hello", "run-key-${connection.kind}"))
        assertEquals(runtimeId, run.runtimeId)
        assertEquals(workspace.workspaceId, run.workspaceId)
        assertEquals(session.sessionId, run.sessionId)
    }

    private class FixtureConnection(
        override val kind: RuntimeConnectionKind,
        private val service: ContractService,
    ) : RuntimeConnection {
        override suspend fun identity() = service.identity(service.runtimeId)
        override suspend fun capabilities() = service.capabilities(service.runtimeId)
        override suspend fun listWorkspaces(cursor: String?) = service.listWorkspaces(service.runtimeId, cursor)
        override suspend fun listSessions(workspaceId: WorkspaceId, cursor: String?) =
            service.listSessions(service.runtimeId, workspaceId, cursor)
        override suspend fun createSession(command: CreateSessionCommand) = service.createSession(service.runtimeId, command)
        override suspend fun createRun(command: CreateRunCommand) = service.createRun(service.runtimeId, command)
        override suspend fun getRun(runId: RunId) = service.getRun(service.runtimeId, runId)
        override fun streamEvents(runId: RunId, afterSequence: Long) =
            service.streamEvents(service.runtimeId, runId, afterSequence)
        override suspend fun cancelRun(runId: RunId) = service.cancelRun(service.runtimeId, runId)
    }

    private class ContractService : RelayRuntimeService {
        val runtimeId = RuntimeId("runtime-contract")
        private val workspace = RemoteWorkspaceRef(runtimeId, WorkspaceId("workspace-contract"), "Workspace")
        override suspend fun identity(runtimeId: RuntimeId) = RuntimeIdentity(runtimeId, "instance", "1", "1")
        override suspend fun capabilities(runtimeId: RuntimeId) = RuntimeCapabilities(setOf("workspace"))
        override suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String?) = Page(listOf(workspace))
        override suspend fun listSessions(runtimeId: RuntimeId, workspaceId: WorkspaceId, cursor: String?) = Page(emptyList<RemoteSessionRef>())
        override suspend fun createSession(runtimeId: RuntimeId, command: CreateSessionCommand) =
            RemoteSessionRef(runtimeId, command.workspace.workspaceId, SessionId("session-${command.idempotencyKey.hashCode().toUInt()}"), "Session", command.backendId)
        override suspend fun createRun(runtimeId: RuntimeId, command: CreateRunCommand) =
            RemoteRunIdentity(runtimeId, command.session.workspaceId, command.session.sessionId, RunId("run-${command.idempotencyKey.hashCode().toUInt()}"), command.session.backendId)
        override suspend fun getRun(runtimeId: RuntimeId, runId: RunId) =
            RemoteRunIdentity(runtimeId, workspace.workspaceId, SessionId("session-read"), runId, "opendrsai")
        override fun streamEvents(runtimeId: RuntimeId, runId: RunId, afterSequence: Long): Flow<RemoteRuntimeEvent> = emptyFlow()
        override suspend fun cancelRun(runtimeId: RuntimeId, runId: RunId) = Unit
    }
}

