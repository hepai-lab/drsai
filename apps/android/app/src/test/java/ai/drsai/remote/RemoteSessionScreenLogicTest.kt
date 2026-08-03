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
    private fun item(
        id: String,
        lifecycle: RemoteResourceLifecycle = RemoteResourceLifecycle.ACTIVE,
        updatedAt: String = "now",
    ) = RemoteSessionUi(
        RemoteSessionRef(
            RuntimeId("rt"),
            WorkspaceId("ws"),
            SessionId(id),
            id,
            "opendrsai",
            lifecycle,
        ),
        null,
        updatedAt,
        lifecycle.toWire(),
    )

    @Test fun `screen projection excludes archived and removed sessions`() {
        val visible = activeRemoteSessions(listOf(
            item("active", RemoteResourceLifecycle.ACTIVE),
            item("archived", RemoteResourceLifecycle.ARCHIVED),
            item("removed", RemoteResourceLifecycle.REMOVED),
        ))

        assertEquals(listOf("active"), visible.map { it.reference.sessionId.value })
    }

    @Test fun `screen projection deduplicates and orders sessions by newest update`() {
        val visible = activeRemoteSessions(
            listOf(
                item("thread-old", updatedAt = "2026-07-20T14:45:11.241Z"),
                item(
                    "thread-d38fbfa5-73a9-4fd5-a860-65b20b89f4a5",
                    updatedAt = "2026-07-23T18:16:54.495Z",
                ),
                item(
                    "thread-d38fbfa5-73a9-4fd5-a860-65b20b89f4a5",
                    updatedAt = "2026-07-26T16:50:19.255Z",
                ),
            ),
        )

        assertEquals(
            listOf(
                "thread-d38fbfa5-73a9-4fd5-a860-65b20b89f4a5",
                "thread-old",
            ),
            visible.map { it.reference.sessionId.value },
        )
        assertEquals("2026-07-26T16:50:19.255Z", visible.first().updatedAtLabel)
    }
}
