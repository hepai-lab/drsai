package ai.drsai.remote.remote.navigation

import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId

sealed interface AppRoute {
    val path: String

    data object Chat : AppRoute {
        override val path: String = "chat"
    }

    data object RemoteHome : AppRoute {
        override val path: String = "remote"
    }

    data class WorkspaceSessions(
        val runtimeId: RuntimeId,
        val workspaceId: WorkspaceId,
    ) : AppRoute {
        override val path: String = "remote/${runtimeId.value}/workspaces/${workspaceId.value}/sessions"
    }

    data class RemoteSession(
        val runtimeId: RuntimeId,
        val workspaceId: WorkspaceId,
        val sessionId: SessionId,
    ) : AppRoute {
        override val path: String =
            "remote/${runtimeId.value}/workspaces/${workspaceId.value}/sessions/${sessionId.value}"
    }

    data class WorkspaceFiles(
        val runtimeId: RuntimeId,
        val workspaceId: WorkspaceId,
    ) : AppRoute {
        override val path: String = "remote/${runtimeId.value}/workspaces/${workspaceId.value}/files"
    }

    data class WorkspaceGit(
        val runtimeId: RuntimeId,
        val workspaceId: WorkspaceId,
    ) : AppRoute {
        override val path: String = "remote/${runtimeId.value}/workspaces/${workspaceId.value}/git"
    }

    data class RunAudit(
        val runtimeId: RuntimeId,
        val workspaceId: WorkspaceId,
        val sessionId: SessionId,
        val runId: RunId,
    ) : AppRoute {
        override val path: String =
            "remote/${runtimeId.value}/workspaces/${workspaceId.value}/sessions/${sessionId.value}/runs/${runId.value}/audit"
    }

    companion object {
        fun parse(path: String): AppRoute? {
            if (path == Chat.path) return Chat
            if (path == RemoteHome.path) return RemoteHome
            val parts = path.split('/').filter(String::isNotBlank)
            if (parts.size < 5 || parts[0] != "remote" || parts[2] != "workspaces") return null
            return runCatching {
                val runtimeId = RuntimeId(parts[1])
                val workspaceId = WorkspaceId(parts[3])
                when {
                    parts.size == 5 && parts[4] == "sessions" -> WorkspaceSessions(runtimeId, workspaceId)
                    parts.size == 6 && parts[4] == "sessions" ->
                        RemoteSession(runtimeId, workspaceId, SessionId(parts[5]))
                    parts.size == 5 && parts[4] == "files" -> WorkspaceFiles(runtimeId, workspaceId)
                    parts.size == 5 && parts[4] == "git" -> WorkspaceGit(runtimeId, workspaceId)
                    parts.size == 9 && parts[4] == "sessions" && parts[6] == "runs" && parts[8] == "audit" ->
                        RunAudit(runtimeId, workspaceId, SessionId(parts[5]), RunId(parts[7]))
                    else -> null
                }
            }.getOrNull()
        }
    }
}

