package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteRunIdentity
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import org.json.JSONObject

/** Strict wire codecs for the shared Runtime domain. Unknown fields fail closed. */
object RemoteContractCodec {
    private val workspaceFields = setOf("runtime_id", "workspace_id", "display_name")
    private val sessionFields = setOf(
        "runtime_id", "workspace_id", "session_id", "title", "backend_id"
    )
    private val runFields = setOf(
        "runtime_id", "workspace_id", "session_id", "run_id", "backend_id"
    )

    fun encodeWorkspace(value: RemoteWorkspaceRef): JSONObject = JSONObject()
        .put("runtime_id", value.runtimeId.value)
        .put("workspace_id", value.workspaceId.value)
        .put("display_name", value.displayName)

    fun decodeWorkspace(json: JSONObject): RemoteWorkspaceRef {
        requireExactFields(json, workspaceFields)
        return RemoteWorkspaceRef(
            runtimeId = RuntimeId(json.getString("runtime_id")),
            workspaceId = WorkspaceId(json.getString("workspace_id")),
            displayName = json.getString("display_name"),
        )
    }

    fun encodeSession(value: RemoteSessionRef): JSONObject = JSONObject()
        .put("runtime_id", value.runtimeId.value)
        .put("workspace_id", value.workspaceId.value)
        .put("session_id", value.sessionId.value)
        .put("title", value.title)
        .put("backend_id", value.backendId)

    fun decodeSession(json: JSONObject): RemoteSessionRef {
        requireExactFields(json, sessionFields)
        return RemoteSessionRef(
            runtimeId = RuntimeId(json.getString("runtime_id")),
            workspaceId = WorkspaceId(json.getString("workspace_id")),
            sessionId = SessionId(json.getString("session_id")),
            title = json.getString("title"),
            backendId = json.getString("backend_id"),
        )
    }

    fun encodeRun(value: RemoteRunIdentity): JSONObject = JSONObject()
        .put("runtime_id", value.runtimeId.value)
        .put("workspace_id", value.workspaceId.value)
        .put("session_id", value.sessionId.value)
        .put("run_id", value.runId.value)
        .put("backend_id", value.backendId)

    fun decodeRun(json: JSONObject): RemoteRunIdentity {
        requireExactFields(json, runFields)
        return RemoteRunIdentity(
            runtimeId = RuntimeId(json.getString("runtime_id")),
            workspaceId = WorkspaceId(json.getString("workspace_id")),
            sessionId = SessionId(json.getString("session_id")),
            runId = RunId(json.getString("run_id")),
            backendId = json.getString("backend_id"),
        )
    }

    private fun requireExactFields(json: JSONObject, expected: Set<String>) {
        val actual = buildSet { json.keys().forEachRemaining(::add) }
        require(actual == expected) { "remote_contract_fields_invalid" }
    }
}

