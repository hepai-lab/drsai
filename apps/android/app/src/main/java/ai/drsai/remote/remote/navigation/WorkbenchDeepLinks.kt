package ai.drsai.remote.remote.navigation

import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

object WorkbenchDeepLinkParser {
    fun route(value: String): AppRoute? = runCatching {
        val uri = URI(value)
        if (uri.scheme != "opendrsai") return null
        val segments = uri.path.orEmpty().split('/').filter(String::isNotBlank)
        when (uri.host) {
            "remote" -> AppRoute.RemoteHome.takeIf { segments.isEmpty() }
            "workspace" -> {
                require(segments.size == 2) { "workspace_deep_link_identity_required" }
                AppRoute.WorkspaceSessions(RuntimeId(segments[0]), WorkspaceId(segments[1]))
            }
            "session" -> {
                require(segments.size == 3) { "session_deep_link_identity_required" }
                AppRoute.RemoteSession(RuntimeId(segments[0]), WorkspaceId(segments[1]), SessionId(segments[2]))
            }
            "run" -> {
                val query = query(uri.rawQuery)
                AppRoute.RemoteSession(
                    RuntimeId(query.getValue("runtime_id")),
                    WorkspaceId(query.getValue("workspace_id")),
                    SessionId(query.getValue("session_id")),
                )
            }
            "approval" -> AppRoute.Approvals.takeIf { segments.singleOrNull()?.isNotBlank() == true }
            "artifact" -> AppRoute.Results.takeIf { segments.singleOrNull()?.isNotBlank() == true }
            else -> null
        }
    }.getOrNull()

    private fun query(raw: String?): Map<String, String> = raw.orEmpty().split('&')
        .filter(String::isNotBlank).associate { part ->
            val pieces = part.split('=', limit = 2)
            require(pieces.size == 2) { "deep_link_query_invalid" }
            URLDecoder.decode(pieces[0], StandardCharsets.UTF_8.name()) to
                URLDecoder.decode(pieces[1], StandardCharsets.UTF_8.name())
        }
}
