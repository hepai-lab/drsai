package ai.drsai.remote

import ai.drsai.remote.remote.model.RunId
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.navigation.AppRoute
import ai.drsai.remote.remote.navigation.WorkbenchDeepLinkParser
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
            AppRoute.Chat,
            AppRoute.Search,
            AppRoute.Scheduled,
            AppRoute.Results,
            AppRoute.AgentsAndSkills,
            AppRoute.Approvals,
            AppRoute.Archived,
            AppRoute.Settings,
            AppRoute.ModelSettings,
            AppRoute.RemoteHome,
            AppRoute.WorkspaceSessions(runtime, workspace),
            AppRoute.RemoteSession(runtime, workspace, session),
            AppRoute.WorkspaceFiles(runtime, workspace),
            AppRoute.WorkspaceGit(runtime, workspace),
            AppRoute.RunAudit(runtime, workspace, session, RunId("run-a")),
        )
        routes.forEach { assertEquals(it, AppRoute.parse(it.path)) }
    }

    @Test fun workbenchDeepLinksAreStrictAndMapToSingleExistingRoutes() {
        assertEquals(AppRoute.RemoteHome, WorkbenchDeepLinkParser.route("opendrsai://remote"))
        assertEquals(
            AppRoute.WorkspaceSessions(RuntimeId("runtime"), WorkspaceId("workspace")),
            WorkbenchDeepLinkParser.route("opendrsai://workspace/runtime/workspace"),
        )
        assertEquals(
            AppRoute.RemoteSession(RuntimeId("runtime"), WorkspaceId("workspace"), SessionId("session")),
            WorkbenchDeepLinkParser.route("opendrsai://session/runtime/workspace/session"),
        )
        assertEquals(
            AppRoute.RemoteSession(RuntimeId("runtime"), WorkspaceId("workspace"), SessionId("session")),
            WorkbenchDeepLinkParser.route("opendrsai://run/id?runtime_id=runtime&workspace_id=workspace&session_id=session"),
        )
        assertEquals(AppRoute.Approvals, WorkbenchDeepLinkParser.route("opendrsai://approval/approval-1"))
        assertEquals(AppRoute.Results, WorkbenchDeepLinkParser.route("opendrsai://artifact/artifact-1"))
        assertEquals(null, WorkbenchDeepLinkParser.route("opendrsai://session/runtime/missing"))
        assertEquals(null, WorkbenchDeepLinkParser.route("opendrsai://workspace/runtime"))
        assertEquals(null, WorkbenchDeepLinkParser.route("opendrsai://remote/unexpected"))
        assertEquals(null, WorkbenchDeepLinkParser.route("https://session/runtime/workspace/session"))
    }

    @Test
    fun displayNamesAndPathsCannotBecomeRoutes() {
        assertNull(AppRoute.parse("remote/My Computer/workspaces/C:/secret/sessions"))
        assertNull(AppRoute.parse("remote/runtime-a/workspaces/../sessions"))
    }
}
