package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.remote.generated.OaepSnapshot
import org.json.JSONArray
import org.json.JSONObject

data class AndroidOaepRelaySession(
    val workspaceId: String,
    val sessionId: String,
) {
    init {
        require(workspaceId.isNotBlank()) { "oaep_relay_workspace_required" }
        require(sessionId.isNotBlank()) { "oaep_relay_session_required" }
    }
}

/** OAEP-only authority used by the Android Runtime outbound connector. */
interface AndroidOaepRelayAuthority {
    suspend fun snapshot(session: AndroidOaepRelaySession): OaepSnapshot?
    suspend fun events(session: AndroidOaepRelaySession, afterSequence: Long, limit: Int): AndroidOaepReplayResult
}

class RoomAndroidOaepRelayAuthority(
    private val store: RoomAndroidOaepStore,
    private val owner: AndroidOaepOwner,
    private val runtimeId: String,
) : AndroidOaepRelayAuthority {
    override suspend fun snapshot(session: AndroidOaepRelaySession): OaepSnapshot? =
        store.snapshot(owner, runtimeId, session.workspaceId, session.sessionId)

    override suspend fun events(
        session: AndroidOaepRelaySession,
        afterSequence: Long,
        limit: Int,
    ): AndroidOaepReplayResult = store.replay(
        owner, runtimeId, session.workspaceId, session.sessionId, afterSequence, limit,
    )
}

/**
 * Strict wire boundary shared by the WebSocket implementation and deterministic tests.
 * It serializes the authoritative Room OAEP projection; private Runtime events are never accepted.
 */
class AndroidOaepRelayProtocol(
    private val runtimeId: String,
    private val subject: String,
    private val authority: AndroidOaepRelayAuthority,
) {
    init {
        require(runtimeId.isNotBlank()) { "oaep_relay_runtime_required" }
        require(subject.isNotBlank()) { "oaep_relay_subject_required" }
    }

    suspend fun snapshot(session: AndroidOaepRelaySession): JSONObject {
        val value = authority.snapshot(session) ?: error("oaep_relay_session_missing")
        validateSnapshotScope(session, value)
        return OaepJsonCodec.snapshotJson(value)
    }

    suspend fun eventPage(
        session: AndroidOaepRelaySession,
        afterSequence: Long,
        limit: Int = 500,
    ): JSONObject {
        require(afterSequence >= 0) { "oaep_cursor_invalid" }
        require(limit in 1..500) { "oaep_page_limit_invalid" }
        return when (val replay = authority.events(session, afterSequence, limit)) {
            is AndroidOaepReplayResult.Page -> {
                validateEventPageScope(session, afterSequence, replay.value)
                OaepJsonCodec.eventPageJson(replay.value)
            }
            is AndroidOaepReplayResult.CursorExpired -> throw IllegalStateException("cursor_expired")
        }
    }

    suspend fun frames(
        session: AndroidOaepRelaySession,
        afterSequence: Long,
        limit: Int = 500,
    ): List<JSONObject> {
        val page = authority.events(session, afterSequence, limit)
        if (page is AndroidOaepReplayResult.CursorExpired) throw IllegalStateException("cursor_expired")
        val value = (page as AndroidOaepReplayResult.Page).value
        validateEventPageScope(session, afterSequence, value)
        return value.data.map { event -> JSONObject()
            .put("type", "event")
            .put("protocol", "oaep/1")
            .put("scope", "session")
            .put("runtime_id", runtimeId)
            .put("workspace_id", session.workspaceId)
            .put("session_id", session.sessionId)
            .put("sequence", event.sequence)
            .put("event", OaepJsonCodec.eventJson(event))
        }
    }

    /** Handles the legacy-operation Runtime channel used by the reference Relay. */
    suspend fun handleRuntimeRequest(request: JSONObject): JSONObject {
        require(request.getString("type") == "runtime.request") { "runtime_request_type_invalid" }
        val requestId = request.getString("request_id").also { require(it.isNotBlank()) }
        val operation = request.getString("operation")
        val arguments = request.getJSONObject("arguments")
        val args = arguments.getJSONArray("args")
        val kwargs = arguments.optJSONObject("kwargs") ?: JSONObject()
        return try {
            val result = when (operation) {
                "oaep_snapshot_for_subject" -> {
                    val session = authorizedSession(args)
                    snapshot(session)
                }
                "oaep_events_for_subject" -> {
                    val session = authorizedSession(args)
                    eventPage(
                        session,
                        kwargs.optLong("after_sequence", 0L),
                        kwargs.optInt("limit", 500),
                    )
                }
                else -> error("runtime_operation_unsupported")
            }
            JSONObject().put("type", "runtime.response").put("request_id", requestId)
                .put("ok", true).put("result", result)
        } catch (error: Throwable) {
            JSONObject().put("type", "runtime.response").put("request_id", requestId)
                .put("ok", false).put("error", JSONObject()
                    .put("code", error.message ?: "runtime_request_failed")
                    .put("message", error.message ?: "Runtime request failed")
                    .put("retryable", false))
        }
    }

    private fun authorizedSession(args: JSONArray): AndroidOaepRelaySession {
        require(args.length() == 3) { "runtime_request_arguments_invalid" }
        require(args.getString(0) == subject) { "oaep_relay_subject_mismatch" }
        return AndroidOaepRelaySession(args.getString(1), args.getString(2))
    }

    private fun validateSnapshotScope(session: AndroidOaepRelaySession, value: OaepSnapshot) {
        require(value.version == "1.0") { "oaep_version_invalid" }
        require(value.session.id == session.sessionId && value.session.workspaceId == session.workspaceId) {
            "oaep_relay_snapshot_scope_mismatch"
        }
        // Historical Items may retain the pre-enrollment local Runtime source.
        // Snapshot identity is its Session/Workspace scope; newly published
        // Event frames below must always use the enrolled Runtime identity.
    }

    private fun validateEventPageScope(
        session: AndroidOaepRelaySession,
        afterSequence: Long,
        value: OaepEventPage,
    ) {
        require(value.version == "1.0" && value.objectType == "list") { "oaep_relay_page_invalid" }
        require(value.data.all { event ->
            event.sessionId == session.sessionId && event.source.runtimeId == runtimeId
        }) { "oaep_relay_event_scope_mismatch" }
        require(value.data.firstOrNull()?.sequence == afterSequence + 1 || value.data.isEmpty()) {
            "oaep_relay_sequence_gap"
        }
        require(value.data.zipWithNext().all { (left, right) -> right.sequence == left.sequence + 1 }) {
            "oaep_relay_sequence_gap"
        }
        require(value.nextSequence == (value.data.lastOrNull()?.sequence ?: afterSequence)) {
            "oaep_relay_watermark_mismatch"
        }
    }
}

/**
 * Establishes a Snapshot watermark for Sessions created before Runtime enrollment.
 * Historical Events keep their original local source and are served by Snapshot;
 * only later Events use and publish under the enrolled Runtime identity.
 */
class AndroidOaepRelayBootstrap(
    private val authority: AndroidOaepRelayAuthority,
    private val cursors: AndroidOaepRelayCursorStore,
) {
    suspend fun seedExistingSessions(sessions: List<AndroidOaepRelaySession>): Map<String, Long> {
        val seeded = linkedMapOf<String, Long>()
        sessions.distinctBy { it.sessionId }.forEach { session ->
            if (cursors.afterSequence(session.sessionId) == 0L) {
                val snapshot = authority.snapshot(session) ?: return@forEach
                require(snapshot.session.id == session.sessionId &&
                    snapshot.session.workspaceId == session.workspaceId) {
                    "oaep_relay_snapshot_scope_mismatch"
                }
                if (snapshot.snapshotSequence > 0) {
                    cursors.commit(session.sessionId, snapshot.snapshotSequence)
                    seeded[session.sessionId] = snapshot.snapshotSequence
                }
            }
        }
        return seeded
    }
}
