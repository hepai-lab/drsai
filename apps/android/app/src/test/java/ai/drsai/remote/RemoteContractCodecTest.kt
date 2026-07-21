package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteContractCodec
import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class RemoteContractCodecTest {
    private val runtimeId = RuntimeId("runtime-a")
    private val workspaceId = WorkspaceId("workspace-a")
    private val sessionId = SessionId("session-a")

    @Test
    fun sharedRuntimeWorkspaceSessionRunContractsRoundTripExactly() {
        val workspace = RemoteWorkspaceRef(runtimeId, workspaceId, "Workspace A")
        val session = RemoteSessionRef(runtimeId, workspaceId, sessionId, "Session A", "codex")
        val run = RemoteRunIdentity(runtimeId, workspaceId, sessionId, RunId("run-a"), "codex")

        assertEquals(workspace, RemoteContractCodec.decodeWorkspace(RemoteContractCodec.encodeWorkspace(workspace)))
        assertEquals(session, RemoteContractCodec.decodeSession(RemoteContractCodec.encodeSession(session)))
        assertEquals(run, RemoteContractCodec.decodeRun(RemoteContractCodec.encodeRun(run)))
        assertFalse(RemoteContractCodec.encodeRun(run).keys().asSequence().any { it.startsWith("mobile_") })
    }

    @Test(expected = IllegalArgumentException::class)
    fun unknownMobileSpecificFieldFailsClosed() {
        RemoteContractCodec.decodeRun(
            JSONObject()
                .put("runtime_id", "runtime-a")
                .put("workspace_id", "workspace-a")
                .put("session_id", "session-a")
                .put("run_id", "run-a")
                .put("backend_id", "codex")
                .put("mobile_run_id", "forbidden")
        )
    }
}

