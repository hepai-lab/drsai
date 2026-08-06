package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepReasoningContent
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest

/** Deterministic OAEP Journal reducer used for replay and consistency verification. */
class AndroidOaepProjector(private val initialSession: OaepSession) {
    private var session = initialSession
    private val runs = linkedMapOf<String, OaepRun>()
    private val items = linkedMapOf<String, OaepItem>()
    private var sequence = 0L

    fun apply(event: OaepEvent) {
        require(event.sessionId == session.id) { "oaep_replay_session_mismatch" }
        require(event.sequence == sequence + 1) { "oaep_replay_sequence_gap" }
        when (event.type) {
            "event.session.created", "event.session.updated" -> {
                val raw = event.data.extra["session"] ?: error("oaep_replay_session_missing")
                val value = OaepJsonCodec.session(when (raw) {
                    is JSONObject -> raw
                    is Map<*, *> -> JSONObject(raw)
                    else -> error("oaep_replay_session_invalid")
                })
                require(value.id == session.id && value.workspaceId == session.workspaceId) {
                    "oaep_replay_session_scope_mismatch"
                }
                session = value
            }
            "event.run.created" -> {
                val raw = event.data.extra["run"] ?: error("oaep_replay_run_missing")
                val run = OaepJsonCodec.run(when (raw) {
                    is JSONObject -> raw
                    is Map<*, *> -> JSONObject(raw)
                    else -> error("oaep_replay_run_invalid")
                })
                require(run.sessionId == session.id && run.id == event.runId) { "oaep_replay_run_scope_mismatch" }
                require(runs.putIfAbsent(run.id, run) == null) { "oaep_replay_run_duplicate" }
            }
            "event.run.started" -> updateRun(event, "running")
            "event.run.waiting" -> updateRun(event, "waiting")
            "event.run.resumed" -> updateRun(event, "running")
            "event.run.completed" -> updateRun(event, "completed", terminal = true)
            "event.run.failed" -> updateRun(event, "failed", terminal = true)
            "event.run.cancelled" -> updateRun(event, "cancelled", terminal = true)
            "event.item.created", "event.item.started", "event.item.updated",
            "event.item.completed", "event.item.failed", "event.item.cancelled" -> {
                val item = event.data.item ?: error("oaep_replay_item_missing")
                require(item.id == event.itemId && item.runId == event.runId && item.sessionId == session.id) {
                    "oaep_replay_item_scope_mismatch"
                }
                val current = items[item.id]
                require(current == null || current.type == item.type) { "oaep_replay_item_type_changed" }
                items[item.id] = item
            }
            "event.item.delta" -> applyDelta(event)
            else -> error("oaep_replay_event_type_unsupported")
        }
        sequence = event.sequence
        session = session.copy(updatedAt = event.timestamp)
    }

    fun applyAll(events: Iterable<OaepEvent>): AndroidOaepProjector = apply { events.forEach(::apply) }

    fun snapshot(): OaepSnapshot = OaepSnapshot(
        "1.0",
        session,
        runs.values.sortedWith(compareBy<OaepRun> { it.sequence ?: Long.MAX_VALUE }.thenBy { it.id }),
        items.values.sortedWith(compareBy<OaepItem> { it.runId }.thenBy { it.sequence }.thenBy { it.id }),
        sequence,
    )

    private fun updateRun(event: OaepEvent, status: String, terminal: Boolean = false) {
        val id = event.runId ?: error("oaep_replay_run_id_missing")
        val current = runs[id] ?: error("oaep_replay_run_missing")
        runs[id] = current.copy(
            status = status,
            updatedAt = event.timestamp,
            completedAt = if (terminal) event.timestamp else null,
        )
    }

    private fun applyDelta(event: OaepEvent) {
        val id = event.itemId ?: error("oaep_replay_item_id_missing")
        val current = items[id] ?: error("oaep_replay_delta_before_item")
        val delta = event.data.delta ?: error("oaep_replay_delta_missing")
        val text = delta.text.orEmpty()
        val content = when (val value = current.content) {
            is OaepMessageContent -> value.copy(text = value.text + text)
            is OaepSubtaskContent -> value.copy(summary = value.summary + text)
            is OaepPlanContent -> value.copy(text = value.text + text)
            is OaepReasoningContent -> value.copy(
                segments = value.segments + mapOf("kind" to delta.kind, "text" to text),
            )
            is OaepCommandExecutionContent -> value.copy(
                output = value.output + text,
                stdoutTail = if (delta.stream == "stdout") value.stdoutTail.orEmpty() + text else value.stdoutTail,
                stderrTail = if (delta.stream == "stderr") value.stderrTail.orEmpty() + text else value.stderrTail,
            )
            else -> error("oaep_replay_delta_content_unsupported")
        }
        items[id] = current.copy(updatedAt = event.timestamp, content = content)
    }
}

fun androidOaepSnapshotDigest(snapshot: OaepSnapshot): String {
    val root = JSONObject()
        .put("version", snapshot.version)
        .put("session", JSONObject()
            .put("id", snapshot.session.id).put("workspace_id", snapshot.session.workspaceId)
            .putOpt("title", snapshot.session.title).put("status", snapshot.session.status)
            .putOpt("backend", snapshot.session.backend).put("created_at", snapshot.session.createdAt)
            .put("updated_at", snapshot.session.updatedAt))
        .put("runs", JSONArray(snapshot.runs.sortedBy { it.id }.map(OaepJsonCodec::runJson)))
        .put("items", JSONArray(snapshot.items.sortedBy { it.id }.map(OaepJsonCodec::itemJson)))
        .put("snapshot_sequence", snapshot.snapshotSequence)
    return MessageDigest.getInstance("SHA-256").digest(root.toString().encodeToByteArray())
        .joinToString("") { "%02x".format(it) }
}
