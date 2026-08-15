package ai.drsai.remote.remote.data

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId

enum class RemoteSearchSource { ONLINE, CACHE }
enum class RemoteSearchKind { HOST, WORKSPACE, SESSION, MESSAGE }

data class RemoteSearchResult(
    val kind: RemoteSearchKind,
    val title: String,
    val source: RemoteSearchSource,
    val runtimeId: RuntimeId,
    val workspaceId: WorkspaceId? = null,
    val sessionId: SessionId? = null,
)

class RemoteUnifiedSearch(private val database: ChatDatabase) {
    suspend fun cached(subject: String, query: String, limit: Int = 50): List<RemoteSearchResult> {
        val normalized = query.trim()
        if (normalized.isEmpty()) return emptyList()
        val dao = database.remoteDao()
        val workspaces = dao.allSubjectWorkspaces(subject, "")
        val sessions = dao.allSubjectSessions(subject, "")
        val sessionByScope = sessions.associateBy { Triple(it.runtimeId, it.workspaceId, it.sessionId) }
        val workspaceResults = workspaces.asSequence()
            .filter { it.displayName.contains(normalized, ignoreCase = true) }
            .map { RemoteSearchResult(RemoteSearchKind.WORKSPACE, it.displayName,
                RemoteSearchSource.CACHE, RuntimeId(it.runtimeId), WorkspaceId(it.workspaceId)) }
        val sessionResults = sessions.asSequence()
            .filter { it.title.contains(normalized, ignoreCase = true) }
            .map { RemoteSearchResult(RemoteSearchKind.SESSION, it.title,
                RemoteSearchSource.CACHE, RuntimeId(it.runtimeId), WorkspaceId(it.workspaceId), SessionId(it.sessionId)) }
        val messageResults = dao.recentSubjectOaepItems(subject, "", 5_000).asSequence()
            .filter { it.contentJson.contains(normalized, ignoreCase = true) }
            .mapNotNull { item ->
                val session = sessionByScope[Triple(item.runtimeId, item.workspaceId, item.sessionId)] ?: return@mapNotNull null
                RemoteSearchResult(RemoteSearchKind.MESSAGE, session.title,
                    RemoteSearchSource.CACHE, RuntimeId(item.runtimeId), WorkspaceId(item.workspaceId), SessionId(item.sessionId))
            }
        return (workspaceResults + sessionResults + messageResults)
            .distinctBy { listOf(it.kind, it.runtimeId.value, it.workspaceId?.value, it.sessionId?.value) }
            .take(limit.coerceIn(1, 100))
            .toList()
    }
}
