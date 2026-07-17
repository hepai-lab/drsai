package ai.drsai.remote

import ai.drsai.remote.remote.data.CreateRunCommand
import ai.drsai.remote.remote.data.CreateSessionCommand
import ai.drsai.remote.remote.data.Page
import ai.drsai.remote.remote.data.RelayRuntimeConnection
import ai.drsai.remote.remote.data.RelayRuntimeService
import ai.drsai.remote.remote.data.RemoteRuntimeDelegator
import ai.drsai.remote.remote.data.RuntimeCapabilities
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

class RelayRuntimeConnectionTest {
    @Test
    fun relayConnectionPreservesRuntimeWorkspaceSessionAndBackendScope() = runTest {
        val service = FakeRelayService()
        val connection = RelayRuntimeConnection(service.runtimeId, service)
        val workspace = connection.listWorkspaces().items.single()
        val session = connection.createSession(
            CreateSessionCommand(workspace, "agent@1", "codex", "session-key")
        )
        val run = RemoteRuntimeDelegator(connection).createRun(CreateRunCommand(session, "hello", "run-key"))
        assertEquals(service.runtimeId, run.runtimeId)
        assertEquals(workspace.workspaceId, run.workspaceId)
        assertEquals(session.sessionId, run.sessionId)
        assertEquals("codex", run.backendId)
    }

    @Test
    fun remoteFailureHasNoFallbackPath() = runTest {
        var relayCalls = 0
        var localCalls = 0
        val failed = object : RelayRuntimeService by FakeRelayService() {
            override suspend fun createRun(runtimeId: RuntimeId, command: CreateRunCommand): RemoteRunIdentity {
                relayCalls++
                throw IllegalStateException("relay_offline")
            }
        }
        val connection = RelayRuntimeConnection(RuntimeId("runtime-a"), failed)
        val session = RemoteSessionRef(
            RuntimeId("runtime-a"), WorkspaceId("workspace-a"), SessionId("session-a"), "title", "opendrsai"
        )
        runCatching {
            RemoteRuntimeDelegator(connection).createRun(CreateRunCommand(session, "hello", "key"))
        }
        assertEquals(1, relayCalls)
        assertEquals(0, localCalls)
    }

    private open class FakeRelayService : RelayRuntimeService {
        val runtimeId = RuntimeId("runtime-a")
        private val workspace = RemoteWorkspaceRef(runtimeId, WorkspaceId("workspace-a"), "Workspace A")

        override suspend fun identity(runtimeId: RuntimeId) = RuntimeIdentity(runtimeId, "instance-a", "1.0", "1.0")
        override suspend fun capabilities(runtimeId: RuntimeId) = RuntimeCapabilities(setOf("workspace", "events"))
        override suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String?) = Page(listOf(workspace))
        override suspend fun listSessions(runtimeId: RuntimeId, workspaceId: WorkspaceId, cursor: String?) = Page(emptyList<RemoteSessionRef>())
        override suspend fun createSession(runtimeId: RuntimeId, command: CreateSessionCommand) =
            RemoteSessionRef(runtimeId, command.workspace.workspaceId, SessionId("session-a"), "New session", command.backendId)
        override suspend fun createRun(runtimeId: RuntimeId, command: CreateRunCommand) =
            RemoteRunIdentity(runtimeId, command.session.workspaceId, command.session.sessionId, RunId("run-a"), command.session.backendId)
        override suspend fun getRun(runtimeId: RuntimeId, runId: RunId) =
            RemoteRunIdentity(runtimeId, workspace.workspaceId, SessionId("session-a"), runId, "opendrsai")
        override fun streamEvents(runtimeId: RuntimeId, runId: RunId, afterSequence: Long): Flow<RemoteRuntimeEvent> = emptyFlow()
        override suspend fun cancelRun(runtimeId: RuntimeId, runId: RunId) = Unit
    }
}

