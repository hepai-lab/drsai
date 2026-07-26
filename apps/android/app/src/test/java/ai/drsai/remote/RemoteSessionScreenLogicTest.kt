package ai.drsai.remote

import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.ui.RemoteSessionUi
import ai.drsai.remote.remote.ui.activeRemoteSessions
import org.junit.Assert.assertEquals
import org.junit.Test

class RemoteSessionScreenLogicTest {
    @Test fun `screen projection excludes archived and removed sessions`() {
        fun item(id: String, lifecycle: RemoteResourceLifecycle) = RemoteSessionUi(
            RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId(id), id, "opendrsai", lifecycle),
            null,
            "now",
            lifecycle.toWire(),
        )

        val visible = activeRemoteSessions(listOf(
            item("active", RemoteResourceLifecycle.ACTIVE),
            item("archived", RemoteResourceLifecycle.ARCHIVED),
            item("removed", RemoteResourceLifecycle.REMOVED),
        ))

        assertEquals(listOf("active"), visible.map { it.reference.sessionId.value })
    }
}
