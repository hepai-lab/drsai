package ai.drsai.remote

import ai.drsai.remote.remote.ui.normalizedWorkspaceSessionQuery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WorkspaceSessionsQueryTest {
    @Test
    fun blankQueryIsOmittedFromRelayRequest() {
        assertNull(normalizedWorkspaceSessionQuery(null))
        assertNull(normalizedWorkspaceSessionQuery(""))
        assertNull(normalizedWorkspaceSessionQuery(" \t "))
    }

    @Test
    fun nonBlankQueryIsTrimmed() {
        assertEquals("session title", normalizedWorkspaceSessionQuery("  session title  "))
    }
}
