package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayAuthority
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayProtocol
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayBootstrap
import ai.drsai.remote.runtime.oaep.AndroidOaepRelaySession
import ai.drsai.remote.runtime.oaep.AndroidOaepReplayResult
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.InMemoryAndroidOaepRelayCursorStore
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOaepRelayProtocolTest {
    private val session = AndroidOaepRelaySession("workspace-1", "session-1")

    @Test
    fun publishes_authoritative_snapshot_and_strict_native_event_frames() = runTest {
        val writer = writer()
        writer.apply("run-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        writer.apply(
            "message",
            NormalizedAgentEvent.ItemCompleted(
                "assistant-message", "message",
                ai.drsai.remote.remote.generated.OaepMessageContent("assistant", "done", "final"),
            ),
            "2026-08-04T00:00:02Z",
        )
        val protocol = AndroidOaepRelayProtocol("runtime-android", "subject-1", authority(writer))

        val snapshot = protocol.snapshot(session)
        assertEquals("1.0", snapshot.getString("version"))
        assertEquals("session-1", snapshot.getJSONObject("session").getString("id"))
        assertEquals(writer.state.lastSequence, snapshot.getLong("snapshot_sequence"))
        assertEquals("message", snapshot.getJSONArray("items").getJSONObject(0).getString("type"))

        val frames = protocol.frames(session, afterSequence = 0)
        assertEquals((1L..writer.state.lastSequence).toList(), frames.map { it.getLong("sequence") })
        frames.forEach { frame ->
            assertEquals(setOf(
                "type", "protocol", "scope", "runtime_id", "workspace_id",
                "session_id", "sequence", "event",
            ), frame.keys().asSequence().toSet())
            assertEquals("oaep/1", frame.getString("protocol"))
            assertEquals("runtime-android", frame.getString("runtime_id"))
            assertEquals(frame.getLong("sequence"), frame.getJSONObject("event").getLong("sequence"))
            assertEquals(
                "runtime-android",
                frame.getJSONObject("event").getJSONObject("source").getString("runtime_id"),
            )
        }
    }

    @Test
    fun serves_snapshot_and_event_page_to_relay_runtime_requests() = runTest {
        val writer = writer()
        writer.apply("run-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val protocol = AndroidOaepRelayProtocol("runtime-android", "subject-1", authority(writer))

        val snapshotResponse = protocol.handleRuntimeRequest(request(
            "request-snapshot", "oaep_snapshot_for_subject", JSONObject(),
        ))
        assertTrue(snapshotResponse.getBoolean("ok"))
        assertEquals(writer.state.lastSequence, snapshotResponse.getJSONObject("result").getLong("snapshot_sequence"))

        val eventsResponse = protocol.handleRuntimeRequest(request(
            "request-events", "oaep_events_for_subject",
            JSONObject().put("after_sequence", 0).put("limit", 100),
        ))
        assertTrue(eventsResponse.getBoolean("ok"))
        val page = eventsResponse.getJSONObject("result")
        assertEquals("list", page.getString("object"))
        assertEquals(writer.state.events.size, page.getJSONArray("data").length())
        assertEquals(writer.state.lastSequence, page.getLong("next_sequence"))
    }

    @Test
    fun rejects_subject_runtime_scope_and_sequence_drift_before_publish() = runTest {
        val writer = writer()
        writer.apply("run-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val valid = authority(writer)

        val wrongSubject = AndroidOaepRelayProtocol("runtime-android", "subject-1", valid)
            .handleRuntimeRequest(JSONObject()
                .put("type", "runtime.request").put("request_id", "bad-subject")
                .put("operation", "oaep_snapshot_for_subject")
                .put("arguments", JSONObject().put("args", JSONArray(listOf(
                    "subject-2", "workspace-1", "session-1",
                ))).put("kwargs", JSONObject())))
        assertFalse(wrongSubject.getBoolean("ok"))
        assertEquals("oaep_relay_subject_mismatch", wrongSubject.getJSONObject("error").getString("code"))

        val wrongRuntime = AndroidOaepRelayProtocol("runtime-other", "subject-1", valid)
        val runtimeFailure = runCatching { wrongRuntime.frames(session, 0) }.exceptionOrNull()
        assertEquals("oaep_relay_event_scope_mismatch", runtimeFailure?.message)

        val gapAuthority = object : AndroidOaepRelayAuthority by valid {
            override suspend fun events(
                session: AndroidOaepRelaySession,
                afterSequence: Long,
                limit: Int,
            ): AndroidOaepReplayResult {
                val event = writer.state.events.first().copy(sequence = 2)
                return AndroidOaepReplayResult.Page(OaepEventPage("1.0", "list", listOf(event), 2, false))
            }
        }
        val gapFailure = runCatching {
            AndroidOaepRelayProtocol("runtime-android", "subject-1", gapAuthority).frames(session, 0)
        }.exceptionOrNull()
        assertEquals("oaep_relay_sequence_gap", gapFailure?.message)
    }

    @Test
    fun enrollment_seeds_historical_snapshot_then_publishes_only_new_enrolled_identity_events() = runTest {
        val historical = AndroidOaepWriter(
            AndroidOaepScope(
                "workspace-1", "session-1", "run-old", "opendrsai", "android-local",
            ),
            "2026-08-04T00:00:00Z",
        )
        historical.apply("old-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val cursor = InMemoryAndroidOaepRelayCursorStore()
        val oldAuthority = authority(historical)
        val seeded = AndroidOaepRelayBootstrap(oldAuthority, cursor).seedExistingSessions(listOf(session))
        assertEquals(historical.state.lastSequence, seeded.getValue("session-1"))

        val enrolled = AndroidOaepWriter(
            AndroidOaepScope(
                workspaceId = "workspace-1", sessionId = "session-1", runId = "run-new",
                backend = "opendrsai", runtimeId = "android-local",
                sourceRuntimeId = "runtime-android",
            ),
            "2026-08-04T00:00:02Z",
            initialState = historical.state.copy(
                run = historical.state.run.copy(id = "run-new", status = "queued"),
                items = emptyMap(), itemBindings = emptyMap(), itemRevisions = emptyMap(),
            ),
        )
        enrolled.apply("new-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:03Z")
        val frames = AndroidOaepRelayProtocol(
            "runtime-android", "subject-1", authority(enrolled),
        ).frames(session, cursor.afterSequence("session-1"))
        assertTrue(frames.isNotEmpty())
        assertTrue(frames.all {
            it.getJSONObject("event").getJSONObject("source").getString("runtime_id") == "runtime-android"
        })
    }

    private fun writer() = AndroidOaepWriter(
        AndroidOaepScope(
            "workspace-1", "session-1", "run-1", "opendrsai", "runtime-android",
        ),
        "2026-08-04T00:00:00Z",
    )

    private fun authority(writer: AndroidOaepWriter) = object : AndroidOaepRelayAuthority {
        override suspend fun snapshot(session: AndroidOaepRelaySession) = writer.state.snapshot()

        override suspend fun events(
            session: AndroidOaepRelaySession,
            afterSequence: Long,
            limit: Int,
        ): AndroidOaepReplayResult {
            val selected = writer.state.events.filter { it.sequence > afterSequence }.take(limit)
            return AndroidOaepReplayResult.Page(OaepEventPage(
                "1.0", "list", selected,
                selected.lastOrNull()?.sequence ?: afterSequence,
                writer.state.lastSequence > (selected.lastOrNull()?.sequence ?: afterSequence),
            ))
        }
    }

    private fun request(id: String, operation: String, kwargs: JSONObject) = JSONObject()
        .put("type", "runtime.request")
        .put("request_id", id)
        .put("operation", operation)
        .put("arguments", JSONObject()
            .put("args", JSONArray(listOf("subject-1", "workspace-1", "session-1")))
            .put("kwargs", kwargs))
}
