package ai.drsai.remote.remote.data

import androidx.room.Dao
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase

@Entity(
    tableName = "remote_runtimes",
    primaryKeys = ["subject", "organization", "runtimeId"],
    indices = [Index("subject", "organization")],
)
data class RemoteRuntimeEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val displayName: String,
    val instanceId: String,
    val version: String,
    val connectionState: String,
    val capabilitiesJson: String,
    val lastSyncedAt: Long,
    val authoritative: Boolean = false,
)

@Entity(
    tableName = "remote_workspaces",
    primaryKeys = ["subject", "organization", "runtimeId", "workspaceId"],
    indices = [Index("subject", "organization", "runtimeId")],
)
data class RemoteWorkspaceEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val displayName: String,
    val lastSyncedAt: Long,
    val authoritative: Boolean = false,
    @ColumnInfo(defaultValue = "'active'") val lifecycle: String = "active",
    @ColumnInfo(defaultValue = "1") val revision: Long = 1,
    @ColumnInfo(defaultValue = "''") val updatedAt: String = "",
)

@Entity(
    tableName = "remote_sessions",
    primaryKeys = ["subject", "organization", "runtimeId", "workspaceId", "sessionId"],
    indices = [Index("subject", "organization", "runtimeId", "workspaceId")],
)
data class RemoteSessionEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val title: String,
    val backendId: String,
    val lastSyncedAt: Long,
    val authoritative: Boolean = false,
    @ColumnInfo(defaultValue = "'active'") val lifecycle: String = "active",
    @ColumnInfo(defaultValue = "''") val updatedAt: String = "",
)

@Entity(
    tableName = "remote_runs",
    primaryKeys = ["subject", "organization", "runtimeId", "workspaceId", "sessionId", "runId"],
    indices = [Index("subject", "organization", "runtimeId", "workspaceId", "sessionId")],
)
data class RemoteRunEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val backendId: String,
    val status: String,
    val connectionState: String,
    val lastSequence: Long,
    val lastSyncedAt: Long,
    val authoritative: Boolean = false,
)

@Entity(
    tableName = "remote_event_cursors",
    primaryKeys = ["subject", "organization", "runtimeId", "resourceType", "resourceId"],
)
data class RemoteEventCursorEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val resourceType: String,
    val resourceId: String,
    val lastSequence: Long,
    val cursor: String?,
    val updatedAt: Long,
)

@Entity(
    tableName = "remote_events",
    primaryKeys = ["subject", "organization", "runtimeId", "eventId"],
    indices = [Index("subject", "organization", "runtimeId", "runId", "sequence", unique = true)],
)
data class RemoteEventEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val eventId: String,
    val sequence: Long,
    val type: String,
    val timestamp: String,
)

@Entity(
    tableName = "pending_remote_approvals",
    primaryKeys = ["subject", "organization", "runtimeId", "approvalId"],
    indices = [Index("subject", "organization", "runtimeId", "runId")],
)
data class PendingRemoteApprovalEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val approvalId: String,
    val operation: String,
    val expiresAt: String,
    val lastSyncedAt: Long,
    val authoritative: Boolean = false,
)

@Dao
interface RemoteCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveRuntimes(items: List<RemoteRuntimeEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveWorkspaces(items: List<RemoteWorkspaceEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveSessions(items: List<RemoteSessionEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveRun(item: RemoteRunEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertEvent(item: RemoteEventEntity): Long
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveCursor(item: RemoteEventCursorEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveApproval(item: PendingRemoteApprovalEntity)

    @Query("SELECT * FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND resourceType=:resourceType AND resourceId=:resourceId")
    suspend fun cursor(subject: String, organization: String, runtimeId: String, resourceType: String, resourceId: String): RemoteEventCursorEntity?

    @Query("SELECT * FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND eventId=:eventId")
    suspend fun event(subject: String, organization: String, runtimeId: String, eventId: String): RemoteEventEntity?
    @Query("SELECT * FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND runId=:runId ORDER BY sequence")
    suspend fun runEvents(subject: String, organization: String, runtimeId: String, runId: String): List<RemoteEventEntity>
    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND runId=:runId")
    suspend fun clearRunEvents(subject: String, organization: String, runtimeId: String, runId: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND resourceType='run' AND resourceId=:runId")
    suspend fun clearRunCursor(subject: String, organization: String, runtimeId: String, runId: String)

    @Query("SELECT * FROM remote_runtimes WHERE subject=:subject AND organization=:organization ORDER BY displayName")
    suspend fun runtimes(subject: String, organization: String): List<RemoteRuntimeEntity>
    @Query("SELECT * FROM remote_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND lifecycle='active' ORDER BY workspaceId")
    suspend fun workspaces(subject: String, organization: String, runtimeId: String): List<RemoteWorkspaceEntity>
    @Query("SELECT * FROM remote_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId AND lifecycle='active' ORDER BY sessionId")
    suspend fun sessions(subject: String, organization: String, runtimeId: String, workspaceId: String): List<RemoteSessionEntity>
    @Query("SELECT * FROM remote_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId ORDER BY workspaceId")
    suspend fun allWorkspaces(subject: String, organization: String, runtimeId: String): List<RemoteWorkspaceEntity>
    @Query("SELECT * FROM remote_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId ORDER BY sessionId")
    suspend fun allSessions(subject: String, organization: String, runtimeId: String, workspaceId: String): List<RemoteSessionEntity>
    @Query("SELECT * FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId ORDER BY approvalId")
    suspend fun approvals(subject: String, organization: String, runtimeId: String): List<PendingRemoteApprovalEntity>
    @Query("SELECT * FROM remote_runs WHERE subject=:subject AND organization=:organization ORDER BY lastSyncedAt DESC")
    suspend fun recoverableRuns(subject: String, organization: String): List<RemoteRunEntity>

    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization") suspend fun clearEvents(subject: String, organization: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization") suspend fun clearCursors(subject: String, organization: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization") suspend fun clearApprovals(subject: String, organization: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject AND organization=:organization") suspend fun clearRuns(subject: String, organization: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject AND organization=:organization") suspend fun clearSessions(subject: String, organization: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject AND organization=:organization") suspend fun clearWorkspaces(subject: String, organization: String)
    @Query("DELETE FROM remote_runtimes WHERE subject=:subject AND organization=:organization") suspend fun clearRuntimes(subject: String, organization: String)
    @Query("DELETE FROM remote_events WHERE timestamp < :before") suspend fun pruneEvents(before: String)
    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization AND timestamp < :before")
    suspend fun pruneAccountEventsBefore(subject: String, organization: String, before: String)
    @Query("DELETE FROM remote_events WHERE rowid IN (SELECT rowid FROM remote_events WHERE subject=:subject AND organization=:organization ORDER BY timestamp DESC, sequence DESC LIMIT -1 OFFSET :capacity)")
    suspend fun trimAccountEvents(subject: String, organization: String, capacity: Int)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND expiresAt < :before")
    suspend fun pruneExpiredApprovals(subject: String, organization: String, before: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND updatedAt < :beforeMillis")
    suspend fun pruneStaleCursors(subject: String, organization: String, beforeMillis: Long)
    @Query("SELECT COUNT(*) FROM remote_events WHERE subject=:subject AND organization=:organization")
    suspend fun eventCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization")
    suspend fun approvalCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM remote_event_cursors WHERE subject=:subject AND organization=:organization")
    suspend fun cursorCount(subject: String, organization: String): Int
    @Query("DELETE FROM remote_events WHERE subject=:subject") suspend fun clearSubjectEvents(subject: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject") suspend fun clearSubjectCursors(subject: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject") suspend fun clearSubjectApprovals(subject: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject") suspend fun clearSubjectRuns(subject: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject") suspend fun clearSubjectSessions(subject: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject") suspend fun clearSubjectWorkspaces(subject: String)
    @Query("DELETE FROM remote_runtimes WHERE subject=:subject") suspend fun clearSubjectRuntimes(subject: String)
}

enum class EventDecision { APPLY, DUPLICATE, OUT_OF_ORDER, GAP, CROSS_SCOPE }

object RemoteEventReducer {
    fun decide(currentSequence: Long, event: RemoteEventEntity, expectedRuntime: String, expectedRun: String,
               existingEventId: Boolean): EventDecision = when {
        event.runtimeId != expectedRuntime || event.runId != expectedRun -> EventDecision.CROSS_SCOPE
        existingEventId -> EventDecision.DUPLICATE
        event.sequence <= currentSequence -> EventDecision.OUT_OF_ORDER
        event.sequence != currentSequence + 1 -> EventDecision.GAP
        else -> EventDecision.APPLY
    }
}

data class OfflineRemotePolicy(val cachedHistoryVisible: Boolean, val sendEnabled: Boolean,
                               val approvalEnabled: Boolean, val controlEnabled: Boolean, val createsOutbox: Boolean)

fun offlineRemotePolicy(online: Boolean): OfflineRemotePolicy = if (online) {
    OfflineRemotePolicy(true, true, true, true, false)
} else {
    OfflineRemotePolicy(true, false, false, false, false)
}

class RemoteCacheRepository(private val database: ChatDatabase) {
    suspend fun runCursor(
        subject: String,
        organization: String,
        runtimeId: String,
        runId: String,
    ): RemoteEventCursorEntity? =
        database.remoteDao().cursor(subject, organization, runtimeId, "run", runId)

    suspend fun applyEvent(event: RemoteEventEntity, expectedRuntimeId: String, expectedRunId: String,
                           cursorValue: String?, syncedAt: Long): EventDecision =
        database.withTransaction {
            val dao = database.remoteDao()
            val cursor = dao.cursor(event.subject, event.organization, expectedRuntimeId, "run", expectedRunId)
            val exists = dao.event(event.subject, event.organization, event.runtimeId, event.eventId) != null
            val decision = RemoteEventReducer.decide(cursor?.lastSequence ?: 0, event, expectedRuntimeId, expectedRunId, exists)
            when (decision) {
                EventDecision.APPLY -> {
                    check(dao.insertEvent(event) != -1L) { "remote_event_insert_conflict" }
                    dao.saveCursor(RemoteEventCursorEntity(event.subject, event.organization, event.runtimeId,
                        "run", event.runId, event.sequence, cursorValue, syncedAt))
                }
                EventDecision.DUPLICATE, EventDecision.OUT_OF_ORDER -> Unit
                EventDecision.GAP -> error("remote_event_sequence_gap")
                EventDecision.CROSS_SCOPE -> error("remote_event_scope_mismatch")
            }
            decision
        }

    suspend fun replaceRunProjection(
        subject: String,
        organization: String,
        runtimeId: String,
        runId: String,
        events: List<RemoteEventEntity>,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        dao.clearRunEvents(subject, organization, runtimeId, runId)
        dao.clearRunCursor(subject, organization, runtimeId, runId)
        val ordered = events.distinctBy { it.eventId }.sortedBy { it.sequence }
        var expected = ordered.firstOrNull()?.sequence?.minus(1) ?: 0L
        ordered.forEach { event ->
            require(event.subject == subject && event.organization == organization &&
                event.runtimeId == runtimeId && event.runId == runId) { "remote_event_scope_mismatch" }
            require(event.sequence == expected + 1) { "remote_event_sequence_gap" }
            check(dao.insertEvent(event) != -1L) { "remote_event_insert_conflict" }
            expected = event.sequence
        }
        dao.saveCursor(RemoteEventCursorEntity(
            subject, organization, runtimeId, "run", runId, expected,
            expected.takeIf { it > 0 }?.toString(), syncedAt,
        ))
    }

    suspend fun clearAccount(subject: String, organization: String) = database.withTransaction {
        database.remoteDao().apply {
            clearEvents(subject, organization)
            clearCursors(subject, organization)
            clearApprovals(subject, organization)
            clearRuns(subject, organization)
            clearSessions(subject, organization)
            clearWorkspaces(subject, organization)
            clearRuntimes(subject, organization)
        }
    }

    suspend fun clearSubject(subject: String) = database.withTransaction {
        database.remoteDao().apply {
            clearSubjectEvents(subject); clearSubjectCursors(subject); clearSubjectApprovals(subject)
            clearSubjectRuns(subject); clearSubjectSessions(subject); clearSubjectWorkspaces(subject); clearSubjectRuntimes(subject)
        }
    }

    suspend fun maintainAccount(
        subject: String,
        organization: String,
        eventBeforeTimestamp: String,
        cursorBeforeMillis: Long,
        maxEvents: Int,
    ) = database.withTransaction {
        require(maxEvents >= 0) { "remote_cache_capacity_invalid" }
        database.remoteDao().apply {
            pruneAccountEventsBefore(subject, organization, eventBeforeTimestamp)
            trimAccountEvents(subject, organization, maxEvents)
            pruneExpiredApprovals(subject, organization, eventBeforeTimestamp)
            pruneStaleCursors(subject, organization, cursorBeforeMillis)
        }
    }
}
