package ai.drsai.remote.remote.device

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteWorkspaceNotificationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun opaquePayloadOpensOnlyItsAuthorizedSessionIdentity() {
        val incoming = Intent(ACTION_REMOTE_WORKSPACE_NOTIFICATION)
            .putExtra("version", "1")
            .putExtra("kind", "approval_required")
            .putExtra("runtime_id", "runtime-one")
            .putExtra("workspace_id", "workspace-one")
            .putExtra("session_id", "session-one")
            .putExtra("event_id", "event-one")
            .putExtra("item_id", "item-one")
        val payload = RemoteNotificationPayload.from(incoming)
        val open = remoteNotificationOpenIntent(context, payload)
        assertEquals(
            "opendrsai://session/runtime-one/workspace-one/session-one?event_id=event-one&item_id=item-one",
            open.data.toString(),
        )
        assertFalse(incoming.extras!!.keySet().any { it in setOf("message", "body", "command", "path") })
    }

    @Test fun providerDataRejectsAnyNonOpaqueEnvelopeField() {
        val failure = assertThrows(IllegalArgumentException::class.java) { RemoteNotificationPayload.from(mapOf(
            "version" to "1",
            "kind" to "run_completed",
            "runtime_id" to "runtime-one",
            "workspace_id" to "workspace-one",
            "session_id" to "session-one",
            "event_id" to "event-one",
            "message" to "must be ignored",
            "command" to "must be ignored",
        )) }

        assertEquals("remote_notification_envelope_invalid", failure.message)
    }

    @Test fun providerDataRejectsUnboundedOrNonOpaqueIdentity() {
        val base = mapOf(
            "version" to "1", "kind" to "run_completed", "runtime_id" to "runtime-one",
            "workspace_id" to "workspace-one", "session_id" to "session-one",
        )
        assertEquals(
            "remote_notification_event_id_invalid",
            assertThrows(IllegalArgumentException::class.java) {
                RemoteNotificationPayload.from(base + ("event_id" to "not/opaque"))
            }.message,
        )
    }
}
