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
import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepSnapshot
import org.json.JSONObject
import java.time.Instant

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
    @ColumnInfo(defaultValue = "''") val workspaceCatalogRevision: String = "",
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
    tableName = "remote_conversation_items",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "itemId"],
    indices = [
        Index("subject", "organization", "runtimeId", "sessionId", "sessionSequence"),
        Index(
            value = ["subject", "organization", "runtimeId", "sessionId", "sourceMessageId"],
            unique = true,
        ),
    ],
)
data class RemoteConversationItemEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val itemId: String,
    val runId: String?,
    val kind: String,
    val role: String?,
    val revision: Long,
    val sessionSequence: Long,
    val sourceClient: String,
    val sourceMessageId: String?,
    val createdAt: String,
    val updatedAt: String,
    val payloadJson: String,
    val optimistic: Boolean = false,
)

@Entity(
    tableName = "remote_session_events",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "eventId"],
    indices = [
        Index(
            value = ["subject", "organization", "runtimeId", "sessionId", "sessionSequence"],
            unique = true,
        ),
    ],
)
data class RemoteSessionEventEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val eventId: String,
    val sessionSequence: Long,
    val kind: String,
    val timestamp: String,
    val payloadJson: String,
)

@Entity(
    tableName = "remote_oaep_runs",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "runId"],
    indices = [Index("subject", "organization", "runtimeId", "sessionId", "updatedAt")],
)
data class RemoteOaepRunEntity(
    val subject: String, val organization: String, val runtimeId: String,
    val workspaceId: String, val sessionId: String, val runId: String,
    val parentRunId: String?, val status: String, val createdAt: String,
    val updatedAt: String, val completedAt: String?,
)

@Entity(
    tableName = "remote_oaep_items",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "itemId"],
    indices = [
        Index("subject", "organization", "runtimeId", "sessionId", "runId", "itemSequence"),
        Index(
            value = ["subject", "organization", "runtimeId", "sessionId", "sourceMessageId"],
            unique = true,
        ),
    ],
)
data class RemoteOaepItemEntity(
    val subject: String, val organization: String, val runtimeId: String,
    val workspaceId: String, val sessionId: String, val runId: String,
    val itemId: String, val type: String, val status: String, val itemSequence: Long,
    val latestEventSequence: Long, val sourceBackend: String, val sourceClient: String?,
    val sourceMessageId: String?, val createdAt: String, val updatedAt: String,
    val contentJson: String, val optimistic: Boolean = false,
)

@Entity(
    tableName = "remote_oaep_events",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "eventId"],
    indices = [Index(
        value = ["subject", "organization", "runtimeId", "sessionId", "eventSequence"],
        unique = true,
    )],
)
data class RemoteOaepEventEntity(
    val subject: String, val organization: String, val runtimeId: String,
    val workspaceId: String, val sessionId: String, val runId: String?,
    val itemId: String?, val eventId: String, val eventSequence: Long,
    val type: String, val timestamp: String, val dedupeKey: String,
    val eventJson: String,
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
    @Query("UPDATE remote_runtimes SET workspaceCatalogRevision=:catalogRevision, lastSyncedAt=:syncedAt WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun saveWorkspaceCatalogRevision(
        subject: String,
        organization: String,
        runtimeId: String,
        catalogRevision: String,
        syncedAt: Long,
    )
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveSessions(items: List<RemoteSessionEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveRun(item: RemoteRunEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertEvent(item: RemoteEventEntity): Long
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveCursor(item: RemoteEventCursorEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveApproval(item: PendingRemoteApprovalEntity)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveConversationItems(items: List<RemoteConversationItemEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveConversationItem(item: RemoteConversationItemEntity)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertSessionEvent(item: RemoteSessionEventEntity): Long
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveOaepRuns(items: List<RemoteOaepRunEntity>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun saveOaepItems(items: List<RemoteOaepItemEntity>)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertOlderOaepRuns(items: List<RemoteOaepRunEntity>)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertOlderOaepItems(items: List<RemoteOaepItemEntity>)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertOaepEvent(item: RemoteOaepEventEntity): Long
    @Query("SELECT * FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId ORDER BY runId,itemSequence,itemId")
    suspend fun oaepItems(subject: String, organization: String, runtimeId: String, sessionId: String): List<RemoteOaepItemEntity>
    @Query("SELECT * FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND itemId=:itemId")
    suspend fun oaepItem(subject: String, organization: String, runtimeId: String, sessionId: String, itemId: String): RemoteOaepItemEntity?
    @Query("SELECT * FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND sourceMessageId=:sourceMessageId AND optimistic=1 LIMIT 1")
    suspend fun optimisticOaepItem(subject: String, organization: String, runtimeId: String, sessionId: String, sourceMessageId: String): RemoteOaepItemEntity?
    @Query("SELECT * FROM remote_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND eventId=:eventId")
    suspend fun oaepEvent(subject: String, organization: String, runtimeId: String, sessionId: String, eventId: String): RemoteOaepEventEntity?
    @Query("DELETE FROM remote_oaep_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId")
    suspend fun clearOaepRuns(subject: String, organization: String, runtimeId: String, sessionId: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND optimistic=0")
    suspend fun clearAuthoritativeOaepItems(subject: String, organization: String, runtimeId: String, sessionId: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND sourceMessageId=:sourceMessageId AND optimistic=1")
    suspend fun clearOptimisticOaepMessage(subject: String, organization: String, runtimeId: String, sessionId: String, sourceMessageId: String)
    @Query("DELETE FROM remote_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND eventSequence<=:throughSequence")
    suspend fun clearOaepEventsThrough(subject: String, organization: String, runtimeId: String, sessionId: String, throughSequence: Long)
    @Query("DELETE FROM remote_oaep_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeOaepRuns(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeOaepItems(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeOaepEvents(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_oaep_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceOaepRuns(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceOaepItems(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceOaepEvents(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_oaep_runs WHERE subject=:subject AND organization=:organization")
    suspend fun clearOaepRuns(subject: String, organization: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject AND organization=:organization")
    suspend fun clearOaepItems(subject: String, organization: String)
    @Query("DELETE FROM remote_oaep_events WHERE subject=:subject AND organization=:organization")
    suspend fun clearOaepEvents(subject: String, organization: String)
    @Query("DELETE FROM remote_oaep_runs WHERE subject=:subject") suspend fun clearSubjectOaepRuns(subject: String)
    @Query("DELETE FROM remote_oaep_items WHERE subject=:subject") suspend fun clearSubjectOaepItems(subject: String)
    @Query("DELETE FROM remote_oaep_events WHERE subject=:subject") suspend fun clearSubjectOaepEvents(subject: String)

    @Query("SELECT * FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND resourceType=:resourceType AND resourceId=:resourceId")
    suspend fun cursor(subject: String, organization: String, runtimeId: String, resourceType: String, resourceId: String): RemoteEventCursorEntity?

    @Query("SELECT * FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND eventId=:eventId")
    suspend fun event(subject: String, organization: String, runtimeId: String, eventId: String): RemoteEventEntity?
    @Query("SELECT * FROM remote_session_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND eventId=:eventId")
    suspend fun sessionEvent(subject: String, organization: String, runtimeId: String, sessionId: String, eventId: String): RemoteSessionEventEntity?
    @Query("SELECT * FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId ORDER BY sessionSequence, createdAt, itemId")
    suspend fun conversationItems(subject: String, organization: String, runtimeId: String, sessionId: String): List<RemoteConversationItemEntity>
    @Query("SELECT * FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND itemId=:itemId")
    suspend fun conversationItem(subject: String, organization: String, runtimeId: String, sessionId: String, itemId: String): RemoteConversationItemEntity?
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND optimistic=0")
    suspend fun clearAuthoritativeConversationItems(subject: String, organization: String, runtimeId: String, sessionId: String)
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND sourceMessageId=:sourceMessageId AND optimistic=1")
    suspend fun clearOptimisticMessage(subject: String, organization: String, runtimeId: String, sessionId: String, sourceMessageId: String)
    @Query("DELETE FROM remote_session_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND sessionSequence<=:throughSequence")
    suspend fun clearSessionEventsThrough(subject: String, organization: String, runtimeId: String, sessionId: String, throughSequence: Long)
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
    @Query("SELECT * FROM remote_workspaces WHERE subject=:subject AND organization=:organization ORDER BY displayName,workspaceId")
    suspend fun allSubjectWorkspaces(subject: String, organization: String): List<RemoteWorkspaceEntity>
    @Query("SELECT * FROM remote_sessions WHERE subject=:subject AND organization=:organization ORDER BY title,sessionId")
    suspend fun allSubjectSessions(subject: String, organization: String): List<RemoteSessionEntity>
    @Query("SELECT * FROM remote_oaep_items WHERE subject=:subject AND organization=:organization ORDER BY updatedAt DESC LIMIT :limit")
    suspend fun recentSubjectOaepItems(subject: String, organization: String, limit: Int): List<RemoteOaepItemEntity>
    @Query("SELECT * FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId ORDER BY approvalId")
    suspend fun approvals(subject: String, organization: String, runtimeId: String): List<PendingRemoteApprovalEntity>
    @Query("SELECT * FROM remote_runs WHERE subject=:subject AND organization=:organization ORDER BY lastSyncedAt DESC")
    suspend fun recoverableRuns(subject: String, organization: String): List<RemoteRunEntity>

    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization") suspend fun clearEvents(subject: String, organization: String)
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject AND organization=:organization") suspend fun clearConversationItems(subject: String, organization: String)
    @Query("DELETE FROM remote_session_events WHERE subject=:subject AND organization=:organization") suspend fun clearSessionEvents(subject: String, organization: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization") suspend fun clearCursors(subject: String, organization: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization") suspend fun clearApprovals(subject: String, organization: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject AND organization=:organization") suspend fun clearRuns(subject: String, organization: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject AND organization=:organization") suspend fun clearSessions(subject: String, organization: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject AND organization=:organization") suspend fun clearWorkspaces(subject: String, organization: String)
    @Query("DELETE FROM remote_runtimes WHERE subject=:subject AND organization=:organization") suspend fun clearRuntimes(subject: String, organization: String)
    @Query("DELETE FROM remote_runtimes WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntime(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkspaces(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeSessions(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeRuns(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeEvents(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeConversationItems(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_session_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeSessionEvents(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeCursors(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeApprovals(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchWorkspaces(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchSessions(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchRuns(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchEvents(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchApprovals(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_approval_grants WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchApprovalGrants(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM workbench_audit WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId")
    suspend fun clearRuntimeWorkbenchAudit(subject: String, organization: String, runtimeId: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspace(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceSessions(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceRuns(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceEvents(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceConversationItems(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_session_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceSessionEvents(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceApprovals(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM workbench_workspaces WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceWorkbenchWorkspace(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM workbench_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceWorkbenchSessions(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM workbench_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun clearWorkspaceWorkbenchRuns(subject: String, organization: String, runtimeId: String, workspaceId: String)
    @Query("DELETE FROM remote_events WHERE timestamp < :before") suspend fun pruneEvents(before: String)
    @Query("DELETE FROM remote_events WHERE subject=:subject AND organization=:organization AND timestamp < :before")
    suspend fun pruneAccountEventsBefore(subject: String, organization: String, before: String)
    @Query("DELETE FROM remote_events WHERE rowid IN (SELECT rowid FROM remote_events WHERE subject=:subject AND organization=:organization ORDER BY timestamp DESC, sequence DESC LIMIT -1 OFFSET :capacity)")
    suspend fun trimAccountEvents(subject: String, organization: String, capacity: Int)
    @Query("DELETE FROM remote_session_events WHERE rowid IN (SELECT rowid FROM remote_session_events WHERE subject=:subject AND organization=:organization ORDER BY sessionSequence DESC LIMIT -1 OFFSET :capacity)")
    suspend fun trimAccountSessionEvents(subject: String, organization: String, capacity: Int)
    @Query("DELETE FROM remote_oaep_events WHERE rowid IN (SELECT rowid FROM remote_oaep_events WHERE subject=:subject AND organization=:organization ORDER BY timestamp DESC, eventSequence DESC LIMIT -1 OFFSET :capacity)")
    suspend fun trimAccountOaepEvents(subject: String, organization: String, capacity: Int)
    @Query("DELETE FROM remote_oaep_items WHERE rowid IN (SELECT rowid FROM remote_oaep_items WHERE subject=:subject AND organization=:organization AND optimistic=0 AND status IN ('completed','failed','cancelled') ORDER BY updatedAt DESC, latestEventSequence DESC, itemId DESC LIMIT -1 OFFSET :capacity)")
    suspend fun trimAccountTerminalOaepItems(subject: String, organization: String, capacity: Int)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization AND expiresAt < :before")
    suspend fun pruneExpiredApprovals(subject: String, organization: String, before: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject AND organization=:organization AND updatedAt < :beforeMillis")
    suspend fun pruneStaleCursors(subject: String, organization: String, beforeMillis: Long)
    @Query("SELECT COUNT(*) FROM remote_events WHERE subject=:subject AND organization=:organization")
    suspend fun eventCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM remote_session_events WHERE subject=:subject AND organization=:organization")
    suspend fun sessionEventCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM remote_oaep_events WHERE subject=:subject AND organization=:organization")
    suspend fun oaepEventCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM remote_oaep_items WHERE subject=:subject AND organization=:organization")
    suspend fun oaepItemCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM pending_remote_approvals WHERE subject=:subject AND organization=:organization")
    suspend fun approvalCount(subject: String, organization: String): Int
    @Query("SELECT COUNT(*) FROM remote_event_cursors WHERE subject=:subject AND organization=:organization")
    suspend fun cursorCount(subject: String, organization: String): Int
    @Query("DELETE FROM remote_events WHERE subject=:subject") suspend fun clearSubjectEvents(subject: String)
    @Query("DELETE FROM remote_conversation_items WHERE subject=:subject") suspend fun clearSubjectConversationItems(subject: String)
    @Query("DELETE FROM remote_session_events WHERE subject=:subject") suspend fun clearSubjectSessionEvents(subject: String)
    @Query("DELETE FROM remote_event_cursors WHERE subject=:subject") suspend fun clearSubjectCursors(subject: String)
    @Query("DELETE FROM pending_remote_approvals WHERE subject=:subject") suspend fun clearSubjectApprovals(subject: String)
    @Query("DELETE FROM remote_runs WHERE subject=:subject") suspend fun clearSubjectRuns(subject: String)
    @Query("DELETE FROM remote_sessions WHERE subject=:subject") suspend fun clearSubjectSessions(subject: String)
    @Query("DELETE FROM remote_workspaces WHERE subject=:subject") suspend fun clearSubjectWorkspaces(subject: String)
    @Query("DELETE FROM remote_runtimes WHERE subject=:subject") suspend fun clearSubjectRuntimes(subject: String)
    @Query("DELETE FROM workbench_approval_grants WHERE subject=:subject") suspend fun clearSubjectWorkbenchApprovalGrants(subject: String)
    @Query("DELETE FROM workbench_approvals WHERE subject=:subject") suspend fun clearSubjectWorkbenchApprovals(subject: String)
    @Query("DELETE FROM workbench_audit WHERE subject=:subject") suspend fun clearSubjectWorkbenchAudit(subject: String)
    @Query("DELETE FROM workbench_events WHERE subject=:subject") suspend fun clearSubjectWorkbenchEvents(subject: String)
    @Query("DELETE FROM workbench_runs WHERE subject=:subject") suspend fun clearSubjectWorkbenchRuns(subject: String)
    @Query("DELETE FROM workbench_sessions WHERE subject=:subject") suspend fun clearSubjectWorkbenchSessions(subject: String)
    @Query("DELETE FROM workbench_workspaces WHERE subject=:subject") suspend fun clearSubjectWorkbenchWorkspaces(subject: String)
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
    private val maintenanceLock = Any()
    private val lastMaintenanceByAccount = mutableMapOf<Pair<String, String>, Long>()
    suspend fun oaepSessionCursor(
        subject: String, organization: String, runtimeId: String, sessionId: String,
    ): RemoteEventCursorEntity? =
        database.remoteDao().cursor(subject, organization, runtimeId, "oaep-session", sessionId)

    suspend fun oaepSessionItems(
        subject: String, organization: String, runtimeId: String, sessionId: String,
    ): List<RemoteOaepItemEntity> =
        database.remoteDao().oaepItems(subject, organization, runtimeId, sessionId)

    suspend fun uncertainOaepSourceMessageIds(
        subject: String, organization: String, runtimeId: String, sessionId: String,
    ): List<String> = database.remoteDao().oaepItems(subject, organization, runtimeId, sessionId)
        .asSequence()
        .filter(RemoteOaepItemEntity::optimistic)
        .filter { item ->
            runCatching { JSONObject(item.contentJson).optString("delivery_state") == "uncertain" }
                .getOrDefault(false)
        }
        .mapNotNull(RemoteOaepItemEntity::sourceMessageId)
        .distinct()
        .toList()

    suspend fun replaceOaepSnapshot(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        snapshot: OaepSnapshot,
        syncedAt: Long,
    ) = database.withTransaction {
        require(snapshot.session.workspaceId == workspaceId) { "remote_workspace_scope_mismatch" }
        val dao = database.remoteDao()
        val committed = dao.cursor(
            subject, organization, runtimeId, "oaep-session", snapshot.session.id,
        )?.lastSequence ?: 0L
        require(snapshot.snapshotSequence >= committed) { "oaep_snapshot_sequence_regression" }
        // A windowed Snapshot contains only the newest page. Clearing the
        // projection here would discard older pages the user already loaded
        // every time a live Event triggers a leading-window refresh. OAEP
        // Items are stable identities and the following upserts replace newer
        // revisions safely, so retain older windows. A non-windowed Snapshot
        // is explicitly complete and may replace the whole projection.
        if (snapshot.window == null) {
            dao.clearOaepRuns(subject, organization, runtimeId, snapshot.session.id)
            dao.clearAuthoritativeOaepItems(subject, organization, runtimeId, snapshot.session.id)
        }
        snapshot.items.forEach { item ->
            item.source.messageId?.let {
                dao.clearOptimisticOaepMessage(subject, organization, runtimeId, snapshot.session.id, it)
            }
        }
        dao.saveOaepRuns(snapshot.runs.map { run ->
            RemoteOaepRunEntity(
                subject, organization, runtimeId, workspaceId, snapshot.session.id,
                run.id, run.parentRunId, run.status, run.createdAt, run.updatedAt, run.completedAt,
            )
        })
        dao.saveOaepItems(snapshot.items.map { item ->
            item.toOaepEntity(
                subject, organization, runtimeId, workspaceId, snapshot.snapshotSequence,
            )
        })
        dao.clearOaepEventsThrough(
            subject, organization, runtimeId, snapshot.session.id, snapshot.snapshotSequence,
        )
        dao.saveCursor(RemoteEventCursorEntity(
            subject, organization, runtimeId, "oaep-session", snapshot.session.id,
            snapshot.snapshotSequence, snapshot.snapshotSequence.toString(), syncedAt,
        ))
    }

    suspend fun mergeOaepSnapshotWindow(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        snapshot: OaepSnapshot,
    ) = database.withTransaction {
        require(snapshot.session.workspaceId == workspaceId) { "remote_workspace_scope_mismatch" }
        val dao = database.remoteDao()
        val committed = dao.cursor(
            subject, organization, runtimeId, "oaep-session", snapshot.session.id,
        )?.lastSequence ?: error("oaep_snapshot_base_missing")
        require(snapshot.snapshotSequence == committed) { "oaep_snapshot_window_waterline_mismatch" }
        // An older pagination window shares the latest snapshot waterline. It
        // may fill gaps, but must never replace a newer Run or Item already
        // projected from the leading window or the live event stream. REPLACE
        // is especially unsafe here because the sourceMessageId unique index
        // would let an older duplicate evict the newer authoritative Item.
        dao.insertOlderOaepRuns(snapshot.runs.map { run ->
            RemoteOaepRunEntity(
                subject, organization, runtimeId, workspaceId, snapshot.session.id,
                run.id, run.parentRunId, run.status, run.createdAt, run.updatedAt, run.completedAt,
            )
        })
        dao.insertOlderOaepItems(snapshot.items.map { item ->
            item.toOaepEntity(subject, organization, runtimeId, workspaceId, snapshot.snapshotSequence)
        })
    }

    suspend fun saveOptimisticOaepMessage(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
        sourceMessageId: String,
        text: String,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        val sequence = (dao.oaepItems(subject, organization, runtimeId, sessionId)
            .filter { it.runId == "optimistic:$sourceMessageId" }
            .maxOfOrNull { it.itemSequence } ?: 0L) + 1
        dao.saveOaepItems(listOf(RemoteOaepItemEntity(
            subject, organization, runtimeId, workspaceId, sessionId,
            "optimistic:$sourceMessageId", "optimistic:$sourceMessageId",
            "message", "pending", sequence,
            dao.cursor(subject, organization, runtimeId, "oaep-session", sessionId)?.lastSequence ?: 0L,
            "android", "android", sourceMessageId, syncedAt.toString(), syncedAt.toString(),
            JSONObject().put("role", "user").put("text", text).put("delivery_state", "optimistic").toString(), true,
        )))
    }

    suspend fun markOptimisticOaepDelivery(
        subject: String, organization: String, runtimeId: String, sessionId: String,
        sourceMessageId: String, delivery: RemoteDeliveryState, syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        val item = dao.optimisticOaepItem(subject, organization, runtimeId, sessionId, sourceMessageId)
            ?: return@withTransaction
        val content = JSONObject(item.contentJson)
        val current = runCatching {
            RemoteDeliveryState.valueOf(content.getString("delivery_state").uppercase())
        }.getOrElse { error("remote_delivery_state_invalid") }
        // Network callbacks, idempotency recovery and OAEP projection updates
        // can arrive out of order. Never let a late callback regress a user
        // message to an older state inside the authoritative Room transaction.
        if (!canTransitionDelivery(current, delivery)) return@withTransaction
        content.put("delivery_state", delivery.name.lowercase())
        dao.saveOaepItems(listOf(item.copy(contentJson = content.toString(), updatedAt = syncedAt.toString())))
    }

    suspend fun applyOaepEvent(
        subject: String,
        organization: String,
        expectedRuntimeId: String,
        expectedWorkspaceId: String,
        expectedSessionId: String,
        event: OaepEvent,
        syncedAt: Long,
    ): EventDecision = database.withTransaction {
        require(event.sessionId == expectedSessionId) { "remote_session_event_scope_mismatch" }
        event.source.runtimeId?.let {
            require(it == expectedRuntimeId) { "remote_runtime_event_scope_mismatch" }
        }
        val dao = database.remoteDao()
        val cursor = dao.cursor(
            subject, organization, expectedRuntimeId, "oaep-session", expectedSessionId,
        )
        val last = cursor?.lastSequence ?: 0L
        val existing = dao.oaepEvent(
            subject, organization, expectedRuntimeId, expectedSessionId, event.eventId,
        )
        when {
            existing != null && existing.eventSequence != event.sequence ->
                error("oaep_event_id_collision")
            existing != null || event.sequence <= last -> EventDecision.DUPLICATE
            event.sequence != last + 1 -> EventDecision.GAP
            else -> {
                check(dao.insertOaepEvent(RemoteOaepEventEntity(
                    subject, organization, expectedRuntimeId, expectedWorkspaceId,
                    expectedSessionId, event.runId, event.itemId, event.eventId,
                    event.sequence, event.type, event.timestamp, event.dedupeKey,
                    OaepJsonCodec.eventJson(event).toString(),
                )) != -1L) { "oaep_event_insert_conflict" }
                event.data.item?.let { item ->
                    item.source.messageId?.let {
                        dao.clearOptimisticOaepMessage(
                            subject, organization, expectedRuntimeId, expectedSessionId, it,
                        )
                    }
                    dao.saveOaepItems(listOf(item.toOaepEntity(
                        subject, organization, expectedRuntimeId, expectedWorkspaceId, event.sequence,
                    )))
                }
                if (event.data.item == null && event.type == "event.item.delta") {
                    event.itemId?.let { itemId ->
                        dao.oaepItem(
                            subject, organization, expectedRuntimeId, expectedSessionId, itemId,
                        )?.applyOaepDelta(event)?.let { updated ->
                            dao.saveOaepItems(listOf(updated))
                        }
                    }
                }
                dao.saveCursor(RemoteEventCursorEntity(
                    subject, organization, expectedRuntimeId, "oaep-session", expectedSessionId,
                    event.sequence, event.sequence.toString(), syncedAt,
                ))
                EventDecision.APPLY
            }
        }
    }

    suspend fun sessionCursor(
        subject: String,
        organization: String,
        runtimeId: String,
        sessionId: String,
    ): RemoteEventCursorEntity? =
        database.remoteDao().cursor(subject, organization, runtimeId, "session", sessionId)

    suspend fun sessionItems(
        subject: String,
        organization: String,
        runtimeId: String,
        sessionId: String,
    ): List<RemoteConversationItemEntity> =
        database.remoteDao().conversationItems(subject, organization, runtimeId, sessionId)

    suspend fun replaceSessionSnapshot(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        snapshot: GeneratedConversationSnapshot,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        require(snapshot.items.all { it.sessionId == snapshot.sessionId }) { "remote_session_scope_mismatch" }
        val committed = dao.cursor(subject, organization, runtimeId, "session", snapshot.sessionId)
            ?.lastSequence ?: 0L
        require(snapshot.snapshotSequence >= committed) { "remote_session_snapshot_sequence_regression" }
        val normalized = snapshot.items
            .groupBy { it.itemId }
            .map { (_, revisions) -> revisions.maxBy { it.revision } }
            .sortedWith(compareBy<GeneratedSessionConversationItem> { it.sessionSequence }.thenBy { it.itemId })
        dao.clearAuthoritativeConversationItems(subject, organization, runtimeId, snapshot.sessionId)
        normalized.forEach { item ->
            item.sourceMessageId?.let {
                dao.clearOptimisticMessage(subject, organization, runtimeId, snapshot.sessionId, it)
            }
        }
        dao.saveConversationItems(normalized.map {
            it.toEntity(subject, organization, runtimeId, workspaceId)
        })
        dao.clearSessionEventsThrough(subject, organization, runtimeId, snapshot.sessionId, snapshot.snapshotSequence)
        dao.saveCursor(
            RemoteEventCursorEntity(
                subject, organization, runtimeId, "session", snapshot.sessionId,
                snapshot.snapshotSequence, snapshot.nextCursor, syncedAt,
            ),
        )
    }

    suspend fun saveOptimisticMessage(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
        sourceMessageId: String,
        text: String,
        syncedAt: Long,
    ) = database.withTransaction {
        val dao = database.remoteDao()
        val sequence = (dao.cursor(subject, organization, runtimeId, "session", sessionId)?.lastSequence ?: 0L) + 1
        dao.saveConversationItem(
            RemoteConversationItemEntity(
                subject, organization, runtimeId, workspaceId, sessionId,
                "optimistic:$sourceMessageId", null, "message", "user", 0, sequence,
                "android", sourceMessageId, syncedAt.toString(), syncedAt.toString(),
                JSONObject().put("text", text).put("status", "sending").toString(), true,
            ),
        )
    }

    suspend fun applySessionEvent(
        subject: String,
        organization: String,
        expectedRuntimeId: String,
        expectedWorkspaceId: String,
        expectedSessionId: String,
        event: GeneratedSessionEvent,
        syncedAt: Long,
    ): EventDecision = database.withTransaction {
        val dao = database.remoteDao()
        if (event.runtimeId != expectedRuntimeId || event.workspaceId != expectedWorkspaceId ||
            event.sessionId != expectedSessionId
        ) error("remote_session_event_scope_mismatch")
        val cursor = dao.cursor(subject, organization, expectedRuntimeId, "session", expectedSessionId)
        val last = cursor?.lastSequence ?: 0L
        val existing = dao.sessionEvent(subject, organization, expectedRuntimeId, expectedSessionId, event.eventId)
        when {
            existing != null && existing.sessionSequence != event.sessionSequence ->
                error("remote_session_event_id_collision")
            existing != null || event.sessionSequence <= last -> EventDecision.DUPLICATE
            event.sessionSequence != last + 1 -> EventDecision.GAP
            else -> {
                check(dao.insertSessionEvent(event.toEntity(subject, organization)) != -1L) {
                    "remote_session_event_insert_conflict"
                }
                event.payload["source_message_id"]?.toString()?.takeIf(String::isNotBlank)?.let {
                    dao.clearOptimisticMessage(subject, organization, expectedRuntimeId, expectedSessionId, it)
                }
                dao.saveCursor(
                    RemoteEventCursorEntity(
                        subject, organization, expectedRuntimeId, "session", expectedSessionId,
                        event.sessionSequence, event.sessionSequence.toString(), syncedAt,
                    ),
                )
                EventDecision.APPLY
            }
        }
    }
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
            clearOaepEvents(subject, organization); clearOaepItems(subject, organization); clearOaepRuns(subject, organization)
            clearConversationItems(subject, organization)
            clearSessionEvents(subject, organization)
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
            clearSubjectOaepEvents(subject); clearSubjectOaepItems(subject); clearSubjectOaepRuns(subject)
            clearSubjectConversationItems(subject); clearSubjectSessionEvents(subject)
            clearSubjectEvents(subject); clearSubjectCursors(subject); clearSubjectApprovals(subject)
            clearSubjectRuns(subject); clearSubjectSessions(subject); clearSubjectWorkspaces(subject); clearSubjectRuntimes(subject)
            clearSubjectWorkbenchApprovalGrants(subject); clearSubjectWorkbenchApprovals(subject)
            clearSubjectWorkbenchAudit(subject); clearSubjectWorkbenchEvents(subject)
            clearSubjectWorkbenchRuns(subject); clearSubjectWorkbenchSessions(subject); clearSubjectWorkbenchWorkspaces(subject)
        }
    }

    suspend fun maintainAccount(
        subject: String,
        organization: String,
        eventBeforeTimestamp: String,
        cursorBeforeMillis: Long,
        maxEvents: Int,
        maxTerminalItems: Int = RemoteCachePolicy.MAX_TERMINAL_ITEMS_PER_ACCOUNT,
    ) = database.withTransaction {
        require(maxEvents >= 0 && maxTerminalItems >= 0) { "remote_cache_capacity_invalid" }
        database.remoteDao().apply {
            pruneAccountEventsBefore(subject, organization, eventBeforeTimestamp)
            trimAccountEvents(subject, organization, maxEvents)
            trimAccountSessionEvents(subject, organization, maxEvents)
            trimAccountOaepEvents(subject, organization, maxEvents)
            trimAccountTerminalOaepItems(subject, organization, maxTerminalItems)
            pruneExpiredApprovals(subject, organization, eventBeforeTimestamp)
            pruneStaleCursors(subject, organization, cursorBeforeMillis)
        }
    }

    suspend fun maintainAccountIfDue(
        subject: String,
        organization: String,
        nowMillis: Long = System.currentTimeMillis(),
        intervalMillis: Long = RemoteCachePolicy.MAINTENANCE_INTERVAL_MS,
        maxEvents: Int = RemoteCachePolicy.MAX_EVENTS_PER_ACCOUNT,
        maxTerminalItems: Int = RemoteCachePolicy.MAX_TERMINAL_ITEMS_PER_ACCOUNT,
    ): Boolean {
        require(subject.isNotBlank() && nowMillis >= 0 && intervalMillis > 0) {
            "remote_cache_maintenance_input_invalid"
        }
        val account = subject to organization
        val reserved = synchronized(maintenanceLock) {
            val previous = lastMaintenanceByAccount[account]
            if (previous != null && nowMillis - previous < intervalMillis) {
                false
            } else {
                // Reserve before suspension so concurrent Session refreshes do
                // not launch duplicate global Room pruning transactions. A
                // failed attempt remains rate-limited instead of causing a hot
                // retry loop; the next interval retries normally.
                lastMaintenanceByAccount[account] = nowMillis
                true
            }
        }
        if (!reserved) return false
        val cutoffMillis = nowMillis - RemoteCachePolicy.JOURNAL_RETENTION_MS
        maintainAccount(
            subject,
            organization,
            Instant.ofEpochMilli(cutoffMillis).toString(),
            cutoffMillis,
            maxEvents,
            maxTerminalItems,
        )
        return true
    }
}

private fun GeneratedSessionConversationItem.toEntity(
    subject: String,
    organization: String,
    runtimeId: String,
    workspaceId: String,
) = RemoteConversationItemEntity(
    subject, organization, runtimeId, workspaceId, sessionId, itemId, runId, kind, role,
    revision, sessionSequence, sourceClient, sourceMessageId, createdAt, updatedAt,
    JSONObject(payload).toString(), false,
)

private fun GeneratedSessionEvent.toEntity(
    subject: String,
    organization: String,
) = RemoteSessionEventEntity(
    subject, organization, runtimeId, workspaceId, sessionId, runId, eventId,
    sessionSequence, kind, timestamp, JSONObject(payload).toString(),
)

private fun OaepItem.toOaepEntity(
    subject: String,
    organization: String,
    runtimeId: String,
    workspaceId: String,
    eventSequence: Long,
) = RemoteOaepItemEntity(
    subject, organization, runtimeId, workspaceId, sessionId, runId, id, type,
    status, sequence, eventSequence, source.backend, source.client, source.messageId,
    createdAt, updatedAt, OaepJsonCodec.contentJson(content), false,
)

private fun RemoteOaepItemEntity.applyOaepDelta(event: OaepEvent): RemoteOaepItemEntity? {
    val delta = event.data.delta ?: return null
    val text = delta.text.orEmpty()
    if (text.isEmpty() && delta.kind != "reasoning.segment.added") return this.copy(
        latestEventSequence = event.sequence,
        updatedAt = event.timestamp,
    )
    val content = JSONObject(contentJson)
    when (delta.kind) {
        "message.text.append" -> content.put("text", content.optString("text") + text)
        "reasoning.text.append" -> {
            val segments = content.optJSONArray("segments") ?: org.json.JSONArray().also {
                content.put("segments", it)
            }
            if (segments.length() == 0) {
                segments.put(JSONObject().put("id", delta.segmentId ?: "stream").put("text", text))
            } else {
                val last = segments.getJSONObject(segments.length() - 1)
                last.put("text", last.optString("text") + text)
            }
        }
        "reasoning.segment.added" -> {
            val segments = content.optJSONArray("segments") ?: org.json.JSONArray().also {
                content.put("segments", it)
            }
            segments.put(JSONObject().put("id", delta.segmentId ?: "segment-${event.sequence}").put("text", text))
        }
        "plan.text.append" -> content.put("text", content.optString("text") + text)
        "command.output.append" -> content.put("output", content.optString("output") + text)
        "tool.output.append" -> content.put("result", content.optString("result") + text)
        "subtask.summary.append" -> content.put("summary", content.optString("summary") + text)
        else -> return this.copy(latestEventSequence = event.sequence, updatedAt = event.timestamp)
    }
    return copy(
        latestEventSequence = event.sequence,
        updatedAt = event.timestamp,
        contentJson = content.toString(),
    )
}
