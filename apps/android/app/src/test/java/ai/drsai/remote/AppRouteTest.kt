package ai.drsai.remote

import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.navigation.AppRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppRouteTest {
    @Test
    fun everyRemoteRouteRoundTripsAuthoritativeIds() {
        val runtime = RuntimeId("runtime-a")
        val workspace = WorkspaceId("workspace-a")
        val session = SessionId("session-a")
        val routes = listOf(
            AppRoute.RemoteHome,
            AppRoute.WorkspaceSessions(runtime, workspace),
            AppRoute.RemoteSession(runtime, workspace, session),
            AppRoute.WorkspaceFiles(runtime, workspace),
            AppRoute.WorkspaceGit(runtime, workspace),
            AppRoute.RunAudit(runtime, workspace, session, RunId("run-a")),
        )
        routes.forEach { assertEquals(it, AppRoute.parse(it.path)) }
    }

    @Test
    fun displayNamesAndPathsCannotBecomeRoutes() {
        assertNull(AppRoute.parse("remote/My Computer/workspaces/C:/secret/sessions"))
        assertNull(AppRoute.parse("remote/runtime-a/workspaces/../sessions"))
    }
}

