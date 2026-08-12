package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import java.util.LinkedHashMap
import org.json.JSONObject

data class WorkspaceSessionCatalogEvent(
    val eventId: String,
    val sessionId: String,
    val type: String,
    val sequence: Long,
)

enum class WorkspaceSessionCatalogDecision { APPLY, DUPLICATE, STALE }

fun decodeWorkspaceSessionCatalogEvent(value: JSONObject): WorkspaceSessionCatalogEvent {
    require(value.keys().asSequence().toSet() == setOf("event_id", "session_id", "type", "sequence")) {
        "session_catalog_event_shape_invalid"
    }
    val event = WorkspaceSessionCatalogEvent(
        eventId = value.getString("event_id"),
        sessionId = value.getString("session_id"),
        type = value.getString("type"),
        sequence = value.getLong("sequence"),
    )
    require(event.eventId.isNotBlank() && event.eventId.length <= 240) { "session_catalog_event_id_invalid" }
    require(event.sessionId.isNotBlank() && event.sessionId.length <= 200) { "session_catalog_session_id_invalid" }
    require(event.type in setOf(
        "event.session.created", "event.session.updated", "event.session.archived",
        "event.session.unarchived", "event.session.deleted",
    )) { "session_catalog_event_type_invalid" }
    require(event.sequence >= 1) { "session_catalog_event_sequence_invalid" }
    return event
}

/** Content-free duplicate/collision guard. Sequence gaps are safe because every APPLY reloads authority. */
class WorkspaceSessionCatalogGate(
    private val eventCapacity: Int = 4_096,
    private val sessionCapacity: Int = 20_000,
) {
    private val events = LinkedHashMap<String, String>()
    private val sessions = LinkedHashMap<String, Long>()

    init {
        require(eventCapacity in 1..65_536 && sessionCapacity in 1..100_000) {
            "session_catalog_gate_capacity_invalid"
        }
    }

    @Synchronized
    fun accept(event: WorkspaceSessionCatalogEvent): WorkspaceSessionCatalogDecision {
        val signature = "${event.sessionId}\u0000${event.type}\u0000${event.sequence}"
        events[event.eventId]?.let {
            require(it == signature) { "session_catalog_event_id_collision" }
            return WorkspaceSessionCatalogDecision.DUPLICATE
        }
        val last = sessions[event.sessionId]
        if (last != null && event.sequence <= last) {
            require(event.sequence < last) { "session_catalog_event_sequence_collision" }
            return WorkspaceSessionCatalogDecision.STALE
        }
        events[event.eventId] = signature
        sessions[event.sessionId] = event.sequence
        while (events.size > eventCapacity) events.remove(events.keys.first())
        while (sessions.size > sessionCapacity) sessions.remove(sessions.keys.first())
        return WorkspaceSessionCatalogDecision.APPLY
    }
}

object WorkspaceSessionCatalogProjection {
    fun project(
        rows: List<RemoteSessionSummary>,
        runtimeId: RuntimeId,
        workspaceId: WorkspaceId,
        lifecycle: RemoteResourceLifecycle,
    ): List<RemoteSessionSummary> {
        require(rows.size <= 100_000) { "session_catalog_size_exceeded" }
        val seen = HashSet<String>(rows.size)
        rows.forEach { row ->
            require(row.reference.runtimeId == runtimeId && row.reference.workspaceId == workspaceId) {
                "remote_session_scope_mismatch"
            }
            require(row.reference.lifecycle == lifecycle && row.lifecycle == lifecycle.toWire()) {
                "session_catalog_lifecycle_mismatch"
            }
            require(seen.add(row.reference.sessionId.value)) { "session_catalog_duplicate_session" }
        }
        return rows.sortedWith(
            compareByDescending<RemoteSessionSummary> { it.updatedAt }
                .thenBy { it.reference.sessionId.value },
        )
    }
}
