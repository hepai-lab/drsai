package ai.drsai.remote

import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedRuntimeSessionEventFrame
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import ai.drsai.remote.remote.generated.RelayContractGenerated
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SessionConversationContractTest {
    private fun fixtureFile(): File {
        val candidates = listOf(
            File("../../../cores/protocol/relay/session-conversation-fixtures.json"),
            File("../../cores/protocol/relay/session-conversation-fixtures.json"),
            File("cores/protocol/relay/session-conversation-fixtures.json"),
        )
        return candidates.firstOrNull(File::isFile)
            ?: error("session-conversation-fixtures.json was not found")
    }

    @Test
    fun `session event capability profile remains fail closed until runtime advertises it`() {
        val profile = RelayContractGenerated.CAPABILITY_PROFILES.getValue("session-events/1")
        assertEquals(
            setOf(
                "conversation.snapshot",
                "session.event.cursor_expired",
                "session.event.resume",
                "session.event.stream",
            ),
            profile,
        )
        assertTrue(profile.intersect(RelayContractGenerated.CAPABILITIES).isEmpty())
        assertEquals(
            "1.5.3",
            RelayContractGenerated.MINIMUM_VERSIONS
                .getValue("session-events/1")
                .getValue("runtime"),
        )
        assertTrue(
            RelayContractGenerated.ENDPOINTS
                .getValue("session_event_stream")
                .endsWith("/sessions/{session_id}/events/stream"),
        )
        val oaep = RelayContractGenerated.CAPABILITY_PROFILES.getValue("oaep/1")
        assertEquals(
            setOf(
                "event.cursor_expired",
                "oaep.session.events",
                "oaep.session.events.stream",
                "oaep.session.snapshot",
                "oaep.v1",
            ),
            oaep,
        )
        assertTrue(oaep.all { it in RelayContractGenerated.CAPABILITIES })
        assertTrue(
            RelayContractGenerated.ENDPOINTS
                .getValue("oaep_event_stream")
                .endsWith("/sessions/{session_id}/oaep-events/stream"),
        )
    }

    @Test
    fun `shared fixture decodes into generated snapshot event and frame models`() {
        val root = JSONObject(fixtureFile().readText())
        val snapshotJson = root.getJSONObject("snapshot")
        val itemJson = snapshotJson.getJSONArray("items").getJSONObject(0)
        val item = GeneratedSessionConversationItem(
            itemId = itemJson.getString("item_id"),
            sessionId = itemJson.getString("session_id"),
            runId = itemJson.optString("run_id").ifBlank { null },
            kind = itemJson.getString("kind"),
            role = itemJson.optString("role").ifBlank { null },
            revision = itemJson.getLong("revision"),
            sessionSequence = itemJson.getLong("session_sequence"),
            sourceClient = itemJson.getString("source_client"),
            sourceMessageId = itemJson.optString("source_message_id").ifBlank { null },
            createdAt = itemJson.getString("created_at"),
            updatedAt = itemJson.getString("updated_at"),
            payload = emptyMap(),
        )
        val snapshot = GeneratedConversationSnapshot(
            sessionId = snapshotJson.getString("session_id"),
            snapshotSequence = snapshotJson.getLong("snapshot_sequence"),
            items = listOf(item),
            nextCursor = null,
        )

        val eventJson = root.getJSONArray("events_after_snapshot").getJSONObject(0)
        val event = GeneratedSessionEvent(
            eventId = eventJson.getString("event_id"),
            runtimeId = eventJson.getString("runtime_id"),
            workspaceId = eventJson.getString("workspace_id"),
            sessionId = eventJson.getString("session_id"),
            runId = eventJson.getString("run_id"),
            sessionSequence = eventJson.getLong("session_sequence"),
            kind = eventJson.getString("kind"),
            timestamp = eventJson.getString("timestamp"),
            payload = emptyMap(),
        )
        val frame = GeneratedRuntimeSessionEventFrame(
            sessionId = event.sessionId,
            sessionSequence = event.sessionSequence,
            event = event,
        )

        assertEquals(3L, snapshot.snapshotSequence)
        assertEquals(4L, frame.sessionSequence)
        assertEquals("session", frame.scope)
        assertEquals("event", frame.type)
        assertFalse(RelayContractGenerated.SESSION_EVENT_KINDS.contains("unknown"))
    }
}
