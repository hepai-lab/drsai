package ai.drsai.remote.runtime.python

import org.json.JSONArray
import org.json.JSONObject

/** Environment facts captured once at Run start and then frozen in the Python checkpoint. */
internal object RunCapabilityDiagnostics {
    private val remoteRuntimeCapabilities = listOf(
        "tool.shell", "tool.git", "tool.worktree", "tool.codex", "mcp.stdio",
    )

    fun snapshot(
        safReadAvailable: Boolean,
        safWriteAvailable: Boolean,
        networkAvailable: Boolean,
        remoteRuntimeAvailable: Boolean,
    ): JSONObject {
        val blocked = mutableListOf<Pair<String, String>>()
        if (!networkAvailable) {
            blocked += "model.chat" to "network_unavailable"
            blocked += "tool.web.search" to "network_unavailable"
            blocked += "tool.web.fetch" to "network_unavailable"
        }
        if (!safReadAvailable) {
            blocked += "tool.workspace.read" to "saf_permission_missing"
            blocked += "tool.workspace.search" to "saf_permission_missing"
        }
        if (!safWriteAvailable) blocked += "tool.workspace.write" to "saf_write_permission_missing"
        return JSONObject()
            .put("blocked", JSONArray(blocked.sortedBy { it.first }.map { (id, reason) ->
                JSONObject().put("id", id).put("reason", reason)
            }))
            .put("remote_available", JSONArray(
                if (remoteRuntimeAvailable) remoteRuntimeCapabilities else emptyList<String>()
            ))
    }
}
