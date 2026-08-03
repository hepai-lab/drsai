package ai.drsai.remote.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import ai.drsai.remote.remote.data.PendingRemoteApprovalEntity
import ai.drsai.remote.remote.data.RemoteCacheDao
import ai.drsai.remote.remote.data.RemoteEventCursorEntity
import ai.drsai.remote.remote.data.RemoteEventEntity
import ai.drsai.remote.remote.data.RemoteConversationItemEntity
import ai.drsai.remote.remote.data.RemoteSessionEventEntity
import ai.drsai.remote.remote.data.RemoteOaepRunEntity
import ai.drsai.remote.remote.data.RemoteOaepItemEntity
import ai.drsai.remote.remote.data.RemoteOaepEventEntity
import ai.drsai.remote.remote.data.RemoteRunEntity
import ai.drsai.remote.remote.data.RemoteRuntimeEntity
import ai.drsai.remote.remote.data.RemoteSessionEntity
import ai.drsai.remote.remote.data.RemoteWorkspaceEntity
import ai.drsai.remote.workbench.data.WorkbenchApprovalEntity
import ai.drsai.remote.workbench.data.WorkbenchApprovalGrantEntity
import ai.drsai.remote.workbench.data.WorkbenchAuditEntity
import ai.drsai.remote.workbench.data.WorkbenchDao
import ai.drsai.remote.workbench.data.WorkbenchEventEntity
import ai.drsai.remote.workbench.data.WorkbenchRunEntity
import ai.drsai.remote.workbench.data.WorkbenchSessionEntity
import ai.drsai.remote.workbench.data.WorkbenchWorkspaceEntity

@Entity(tableName = "conversations", indices = [Index("userId")])
data class ConversationEntity(
    @PrimaryKey val id: String,
    val userId: String,
    val title: String,
    val agentId: String,
    @ColumnInfo(defaultValue = "'OpenDrSai'") val agentName: String = "OpenDrSai",
    @ColumnInfo(defaultValue = "'local'") val agentSource: String = "local",
    val modelId: String,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(tableName = "agent_catalog", primaryKeys = ["id", "userId"], indices = [Index("userId")])
data class AgentCatalogEntity(
    val id: String,
    val userId: String,
    val platformId: String,
    val name: String,
    val description: String,
    val mode: String,
    val available: Boolean,
    val chatSupported: Boolean,
    val isDefault: Boolean,
    val owner: String?,
    val capabilitiesJson: String,
    val logoUrl: String?,
    val examplesJson: String,
    val savedAt: Long,
)

@Entity(
    tableName = "messages",
    foreignKeys = [ForeignKey(
        entity = ConversationEntity::class,
        parentColumns = ["id"],
        childColumns = ["conversationId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("conversationId")],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val role: String,
    val content: String,
    val toolCallId: String? = null,
    val toolName: String? = null,
    val toolPayload: String? = null,
    @ColumnInfo(defaultValue = "1") val visible: Boolean = true,
    val status: String = "complete",
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "message_attachments",
    foreignKeys = [ForeignKey(
        entity = MessageEntity::class,
        parentColumns = ["id"],
        childColumns = ["messageId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("messageId"), Index("conversationId"), Index(value = ["remoteId"], unique = false)],
)
data class MessageAttachmentEntity(
    @PrimaryKey val id: String,
    val messageId: String,
    val conversationId: String,
    val remoteId: String?,
    val name: String,
    val mimeType: String,
    val size: Long,
    val kind: String,
    val localPath: String?,
    val thumbnailPath: String?,
    val sha256: String,
    val status: String = "sent",
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "memories", indices = [Index("userId")])
data class MemoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val userId: String,
    val content: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "conversation_summaries", indices = [Index("conversationId")])
data class ConversationSummaryEntity(
    @PrimaryKey val conversationId: String,
    val fromMessageId: String,
    val toMessageId: String,
    val content: String,
    val sourceCount: Int,
    val updatedAt: Long,
)

@Entity(tableName = "tool_artifacts", indices = [Index("userId", "runId")])
data class ToolArtifactEntity(
    @PrimaryKey val id: String,
    val userId: String,
    val runId: String,
    val sessionId: String,
    val toolCallId: String,
    val toolId: String,
    val content: String,
    val createdAt: Long,
)

@Dao
interface ChatDao {
    @Query("SELECT * FROM conversations WHERE userId=:userId ORDER BY updatedAt DESC")
    fun conversations(userId: String): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM conversations WHERE userId=:userId ORDER BY updatedAt DESC")
    suspend fun conversationSnapshot(userId: String): List<ConversationEntity>

    @Query("SELECT * FROM messages WHERE conversationId=:id AND visible=1 ORDER BY createdAt")
    suspend fun visibleMessageSnapshot(id: String): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE conversationId=:id ORDER BY createdAt")
    suspend fun runtimeMessageSnapshot(id: String): List<MessageEntity>

    @Query("SELECT messages.* FROM messages INNER JOIN conversations ON conversations.id=messages.conversationId WHERE conversations.userId=:userId AND messages.visible=1 AND messages.content LIKE '%' || :escapedQuery || '%' ESCAPE '\\' ORDER BY messages.createdAt DESC LIMIT :limit")
    suspend fun searchVisibleMessages(userId: String, escapedQuery: String, limit: Int): List<MessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveConversation(item: ConversationEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMessage(item: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMessages(items: List<MessageEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveAttachments(items: List<MessageAttachmentEntity>)

    @Query("SELECT * FROM message_attachments WHERE conversationId=:id ORDER BY createdAt")
    suspend fun attachmentSnapshot(id: String): List<MessageAttachmentEntity>

    @Query("SELECT a.* FROM message_attachments a INNER JOIN conversations c ON c.id=a.conversationId WHERE c.userId=:userId ORDER BY a.createdAt DESC")
    suspend fun allAttachmentsForUser(userId: String): List<MessageAttachmentEntity>

    @Query("DELETE FROM message_attachments WHERE id=:id")
    suspend fun deleteAttachment(id: String)

    @Query("UPDATE conversations SET title=:title, updatedAt=:updatedAt WHERE id=:id")
    suspend fun updateConversation(id: String, title: String, updatedAt: Long)

    @Query("DELETE FROM conversations WHERE id=:id")
    suspend fun deleteConversation(id: String)

    @Insert
    suspend fun saveMemory(item: MemoryEntity): Long

    @Query("SELECT * FROM memories WHERE userId=:userId AND content LIKE '%' || :query || '%' ORDER BY createdAt DESC LIMIT :limit")
    suspend fun searchMemories(userId: String, query: String, limit: Int): List<MemoryEntity>

    @Query("SELECT * FROM memories WHERE userId=:userId ORDER BY createdAt DESC LIMIT :limit")
    suspend fun memorySnapshot(userId: String, limit: Int = 100): List<MemoryEntity>

    @Query("DELETE FROM memories WHERE userId=:userId AND id=:id")
    suspend fun deleteMemory(userId: String, id: Long): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveConversationSummary(item: ConversationSummaryEntity)

    @Query("SELECT * FROM conversation_summaries WHERE conversationId=:conversationId")
    suspend fun conversationSummary(conversationId: String): ConversationSummaryEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun saveToolArtifact(item: ToolArtifactEntity)

    @Query("SELECT * FROM tool_artifacts WHERE userId=:userId AND runId=:runId ORDER BY createdAt")
    suspend fun toolArtifacts(userId: String, runId: String): List<ToolArtifactEntity>

    @Query("SELECT * FROM tool_artifacts WHERE userId=:userId ORDER BY createdAt DESC")
    suspend fun allToolArtifacts(userId: String): List<ToolArtifactEntity>

    @Query("DELETE FROM tool_artifacts WHERE userId=:userId AND id IN (:ids)")
    suspend fun deleteToolArtifacts(userId: String, ids: List<String>): Int

    @Query("DELETE FROM tool_artifacts WHERE userId=:userId AND createdAt < :before AND runId NOT IN (:activeRunIds)")
    suspend fun pruneToolArtifacts(userId: String, before: Long, activeRunIds: List<String>): Int

    @Query("SELECT * FROM agent_catalog WHERE userId=:userId ORDER BY isDefault DESC, name COLLATE NOCASE")
    suspend fun agentCatalogSnapshot(userId: String): List<AgentCatalogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveAgentCatalog(items: List<AgentCatalogEntity>)

    @Query("DELETE FROM agent_catalog WHERE userId=:userId")
    suspend fun clearAgentCatalog(userId: String)
}

@Database(
    entities = [ConversationEntity::class, MessageEntity::class, MessageAttachmentEntity::class, MemoryEntity::class,
        ConversationSummaryEntity::class, ToolArtifactEntity::class, AgentCatalogEntity::class,
        RemoteRuntimeEntity::class, RemoteWorkspaceEntity::class, RemoteSessionEntity::class, RemoteRunEntity::class,
        RemoteEventCursorEntity::class, RemoteEventEntity::class, PendingRemoteApprovalEntity::class,
        RemoteConversationItemEntity::class, RemoteSessionEventEntity::class,
        RemoteOaepRunEntity::class, RemoteOaepItemEntity::class, RemoteOaepEventEntity::class,
        WorkbenchWorkspaceEntity::class, WorkbenchSessionEntity::class, WorkbenchRunEntity::class,
        WorkbenchEventEntity::class, WorkbenchApprovalEntity::class, WorkbenchApprovalGrantEntity::class,
        WorkbenchAuditEntity::class],
    version = 11,
    exportSchema = false,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun dao(): ChatDao
    abstract fun remoteDao(): RemoteCacheDao
    abstract fun workbenchDao(): WorkbenchDao
}

val MIGRATION_10_11 = object : Migration(10, 11) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_oaep_runs (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, parentRunId TEXT, status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, completedAt TEXT, PRIMARY KEY(subject,organization,runtimeId,sessionId,runId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_oaep_runs_subject_organization_runtimeId_sessionId_updatedAt ON remote_oaep_runs(subject,organization,runtimeId,sessionId,updatedAt)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_oaep_items (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, itemId TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, itemSequence INTEGER NOT NULL, latestEventSequence INTEGER NOT NULL, sourceBackend TEXT NOT NULL, sourceClient TEXT, sourceMessageId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, contentJson TEXT NOT NULL, optimistic INTEGER NOT NULL, PRIMARY KEY(subject,organization,runtimeId,sessionId,itemId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_oaep_items_subject_organization_runtimeId_sessionId_runId_itemSequence ON remote_oaep_items(subject,organization,runtimeId,sessionId,runId,itemSequence)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_remote_oaep_items_subject_organization_runtimeId_sessionId_sourceMessageId ON remote_oaep_items(subject,organization,runtimeId,sessionId,sourceMessageId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_oaep_events (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT, itemId TEXT, eventId TEXT NOT NULL, eventSequence INTEGER NOT NULL, type TEXT NOT NULL, timestamp TEXT NOT NULL, dedupeKey TEXT NOT NULL, eventJson TEXT NOT NULL, PRIMARY KEY(subject,organization,runtimeId,sessionId,eventId))")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_remote_oaep_events_subject_organization_runtimeId_sessionId_eventSequence ON remote_oaep_events(subject,organization,runtimeId,sessionId,eventSequence)")
    }
}

val MIGRATION_9_10 = object : Migration(9, 10) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE workbench_runs ADD COLUMN pythonStateJson TEXT NOT NULL DEFAULT '{}'")
    }
}

val MIGRATION_8_9 = object : Migration(8, 9) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            "ALTER TABLE remote_runtimes ADD COLUMN workspaceCatalogRevision TEXT NOT NULL DEFAULT ''"
        )
    }
}

val MIGRATION_7_8 = object : Migration(7, 8) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_conversation_items (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, itemId TEXT NOT NULL, runId TEXT, kind TEXT NOT NULL, role TEXT, revision INTEGER NOT NULL, sessionSequence INTEGER NOT NULL, sourceClient TEXT NOT NULL, sourceMessageId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, payloadJson TEXT NOT NULL, optimistic INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, sessionId, itemId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_conversation_items_subject_organization_runtimeId_sessionId_sessionSequence ON remote_conversation_items(subject, organization, runtimeId, sessionId, sessionSequence)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_remote_conversation_items_subject_organization_runtimeId_sessionId_sourceMessageId ON remote_conversation_items(subject, organization, runtimeId, sessionId, sourceMessageId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_session_events (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT, eventId TEXT NOT NULL, sessionSequence INTEGER NOT NULL, kind TEXT NOT NULL, timestamp TEXT NOT NULL, payloadJson TEXT NOT NULL, PRIMARY KEY(subject, organization, runtimeId, sessionId, eventId))")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_remote_session_events_subject_organization_runtimeId_sessionId_sessionSequence ON remote_session_events(subject, organization, runtimeId, sessionId, sessionSequence)")
    }
}

val MIGRATION_6_7 = object : Migration(6, 7) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE remote_workspaces ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
        db.execSQL("ALTER TABLE remote_workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        db.execSQL("ALTER TABLE remote_workspaces ADD COLUMN updatedAt TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE remote_sessions ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
        db.execSQL("ALTER TABLE remote_sessions ADD COLUMN updatedAt TEXT NOT NULL DEFAULT ''")
    }
}

class MemorySettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("opendrsai_memory_settings", Context.MODE_PRIVATE)
    fun enabled(subject: String): Boolean = preferences.getBoolean(subject.hashCode().toUInt().toString(16), true)
    fun setEnabled(subject: String, enabled: Boolean) {
        preferences.edit().putBoolean(subject.hashCode().toUInt().toString(16), enabled).apply()
    }
}

val MIGRATION_5_6 = object : Migration(5, 6) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_workspaces (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, displayName TEXT NOT NULL, kind TEXT NOT NULL, authority TEXT NOT NULL, lastSyncedAt INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, workspaceId))")
        db.execSQL("CREATE TABLE IF NOT EXISTS conversation_summaries (conversationId TEXT NOT NULL, fromMessageId TEXT NOT NULL, toMessageId TEXT NOT NULL, content TEXT NOT NULL, sourceCount INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(conversationId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_conversation_summaries_conversationId ON conversation_summaries(conversationId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS tool_artifacts (id TEXT NOT NULL, userId TEXT NOT NULL, runId TEXT NOT NULL, sessionId TEXT NOT NULL, toolCallId TEXT NOT NULL, toolId TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_tool_artifacts_userId_runId ON tool_artifacts(userId, runId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_workspaces_subject_organization_runtimeId ON workbench_workspaces(subject, organization, runtimeId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_sessions (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, title TEXT NOT NULL, backendId TEXT NOT NULL, authority TEXT NOT NULL, sourceConversationId TEXT, pinned INTEGER NOT NULL, archived INTEGER NOT NULL, unread INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, workspaceId, sessionId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_sessions_subject_organization_runtimeId_workspaceId ON workbench_sessions(subject, organization, runtimeId, workspaceId)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_workbench_sessions_sourceConversationId ON workbench_sessions(sourceConversationId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_runs (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, backendId TEXT NOT NULL, authority TEXT NOT NULL, status TEXT NOT NULL, lastSequence INTEGER NOT NULL, idempotencyKey TEXT NOT NULL, input TEXT NOT NULL, skillVersionsJson TEXT NOT NULL DEFAULT '{}', completedSideEffectsJson TEXT NOT NULL, failureCode TEXT, updatedAt INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, runId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_runs_subject_organization_runtimeId_workspaceId_sessionId ON workbench_runs(subject, organization, runtimeId, workspaceId, sessionId)")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_workbench_runs_subject_idempotencyKey ON workbench_runs(subject, idempotencyKey)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_events (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, eventId TEXT NOT NULL, sequence INTEGER NOT NULL, timestamp TEXT NOT NULL, kind TEXT NOT NULL, payloadVersion INTEGER NOT NULL, payloadJson TEXT NOT NULL, PRIMARY KEY(subject, organization, runtimeId, eventId))")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_workbench_events_subject_organization_runtimeId_runId_sequence ON workbench_events(subject, organization, runtimeId, runId, sequence)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_approvals (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, approvalId TEXT NOT NULL, toolCallId TEXT NOT NULL, operation TEXT NOT NULL, argumentsDigest TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL, expiresAt TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, approvalId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_approvals_subject_organization_runtimeId_runId ON workbench_approvals(subject, organization, runtimeId, runId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_approval_grants (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, sessionId TEXT NOT NULL, toolId TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER, PRIMARY KEY(subject, organization, runtimeId, sessionId, toolId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_approval_grants_subject_organization_runtimeId_sessionId ON workbench_approval_grants(subject, organization, runtimeId, sessionId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS workbench_audit (subject TEXT NOT NULL, organization TEXT NOT NULL, auditId TEXT NOT NULL, runtimeId TEXT NOT NULL, runId TEXT, action TEXT NOT NULL, outcome TEXT NOT NULL, createdAt INTEGER NOT NULL, detailsJson TEXT NOT NULL, PRIMARY KEY(subject, organization, auditId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_workbench_audit_subject_organization_runtimeId_runId ON workbench_audit(subject, organization, runtimeId, runId)")

        // Preserve current local conversations as Sessions in a stable virtual Workspace.
        db.execSQL("INSERT OR IGNORE INTO workbench_workspaces SELECT userId, '', 'android-local', 'local', 'OpenDrSai 本地', 'LOCAL', 'LOCAL_DEVICE', MAX(updatedAt) FROM conversations GROUP BY userId")
        db.execSQL("INSERT OR IGNORE INTO workbench_sessions SELECT userId, '', 'android-local', 'local', id, title, 'opendrsai', 'LOCAL_DEVICE', id, 0, 0, 0, updatedAt FROM conversations")

        // Preserve remote projections. These remain non-authoritative caches even
        // though they are now available through the unified read model.
        db.execSQL("INSERT OR IGNORE INTO workbench_workspaces SELECT subject, organization, runtimeId, workspaceId, displayName, 'REMOTE', 'REMOTE_RUNTIME', lastSyncedAt FROM remote_workspaces")
        db.execSQL("INSERT OR IGNORE INTO workbench_sessions SELECT subject, organization, runtimeId, workspaceId, sessionId, title, backendId, 'REMOTE_RUNTIME', NULL, 0, 0, 0, lastSyncedAt FROM remote_sessions")
        db.execSQL("""
            INSERT OR IGNORE INTO workbench_runs (
                subject, organization, runtimeId, workspaceId, sessionId, runId, backendId,
                authority, status, lastSequence, idempotencyKey, input, skillVersionsJson,
                completedSideEffectsJson, failureCode, updatedAt
            )
            SELECT subject, organization, runtimeId, workspaceId, sessionId, runId, backendId,
                'REMOTE_RUNTIME', status, lastSequence, 'legacy:' || runtimeId || ':' || runId,
                'legacy remote run', '{}', '[]', NULL, lastSyncedAt
            FROM remote_runs
        """.trimIndent())
        db.execSQL("INSERT OR IGNORE INTO workbench_events SELECT subject, organization, runtimeId, workspaceId, sessionId, runId, eventId, sequence, timestamp, type, 1, '{}' FROM remote_events")
        db.execSQL("INSERT OR IGNORE INTO workbench_approvals SELECT subject, organization, runtimeId, sessionId, runId, approvalId, approvalId, operation, 'legacy-unavailable', 'once', 'PENDING', expiresAt, lastSyncedAt FROM pending_remote_approvals")
    }
}

val MIGRATION_4_5 = object : Migration(4, 5) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_runtimes (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, displayName TEXT NOT NULL, instanceId TEXT NOT NULL, version TEXT NOT NULL, connectionState TEXT NOT NULL, capabilitiesJson TEXT NOT NULL, lastSyncedAt INTEGER NOT NULL, authoritative INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_runtimes_subject_organization ON remote_runtimes(subject, organization)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_workspaces (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, displayName TEXT NOT NULL, lastSyncedAt INTEGER NOT NULL, authoritative INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, workspaceId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_workspaces_subject_organization_runtimeId ON remote_workspaces(subject, organization, runtimeId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_sessions (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, title TEXT NOT NULL, backendId TEXT NOT NULL, lastSyncedAt INTEGER NOT NULL, authoritative INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, workspaceId, sessionId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_sessions_subject_organization_runtimeId_workspaceId ON remote_sessions(subject, organization, runtimeId, workspaceId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_runs (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, backendId TEXT NOT NULL, status TEXT NOT NULL, connectionState TEXT NOT NULL, lastSequence INTEGER NOT NULL, lastSyncedAt INTEGER NOT NULL, authoritative INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, workspaceId, sessionId, runId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_remote_runs_subject_organization_runtimeId_workspaceId_sessionId ON remote_runs(subject, organization, runtimeId, workspaceId, sessionId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_event_cursors (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, resourceType TEXT NOT NULL, resourceId TEXT NOT NULL, lastSequence INTEGER NOT NULL, cursor TEXT, updatedAt INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, resourceType, resourceId))")
        db.execSQL("CREATE TABLE IF NOT EXISTS remote_events (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, eventId TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, timestamp TEXT NOT NULL, PRIMARY KEY(subject, organization, runtimeId, eventId))")
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS index_remote_events_subject_organization_runtimeId_runId_sequence ON remote_events(subject, organization, runtimeId, runId, sequence)")
        db.execSQL("CREATE TABLE IF NOT EXISTS pending_remote_approvals (subject TEXT NOT NULL, organization TEXT NOT NULL, runtimeId TEXT NOT NULL, workspaceId TEXT NOT NULL, sessionId TEXT NOT NULL, runId TEXT NOT NULL, approvalId TEXT NOT NULL, operation TEXT NOT NULL, expiresAt TEXT NOT NULL, lastSyncedAt INTEGER NOT NULL, authoritative INTEGER NOT NULL, PRIMARY KEY(subject, organization, runtimeId, approvalId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_pending_remote_approvals_subject_organization_runtimeId_runId ON pending_remote_approvals(subject, organization, runtimeId, runId)")
    }
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // The v1 cache contained server-owned numeric IDs. It cannot safely be
        // mixed with the local, user-scoped Runtime, so it is discarded once.
        db.execSQL("DROP TABLE IF EXISTS messages")
        db.execSQL("DROP TABLE IF EXISTS conversations")
        db.execSQL("CREATE TABLE IF NOT EXISTS conversations (id TEXT NOT NULL, userId TEXT NOT NULL, title TEXT NOT NULL, agentId TEXT NOT NULL, modelId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(id))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_conversations_userId ON conversations(userId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS messages (id TEXT NOT NULL, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolCallId TEXT, toolName TEXT, toolPayload TEXT, visible INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id), FOREIGN KEY(conversationId) REFERENCES conversations(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_messages_conversationId ON messages(conversationId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, userId TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_memories_userId ON memories(userId)")
    }
}

class SecureTokenStore(context: Context) : AuthTokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "opendrsai_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override var accessToken: String?
        get() = prefs.getString("access", null)
        set(value) { check(prefs.edit().putString("access", value).commit()) { "auth-store-write-failed" } }
    override var refreshToken: String?
        get() = prefs.getString("refresh", null)
        set(value) { check(prefs.edit().putString("refresh", value).commit()) { "auth-store-write-failed" } }
    var userId: String?
        get() = prefs.getString("user", null)
        set(value) { check(prefs.edit().putString("user", value).commit()) { "auth-store-write-failed" } }
    var userName: String?
        get() = prefs.getString("user_name", null)
        set(value) { check(prefs.edit().putString("user_name", value).commit()) { "auth-store-write-failed" } }
    var avatarUrl: String?
        get() = prefs.getString("avatar", null)
        set(value) { check(prefs.edit().putString("avatar", value).commit()) { "auth-store-write-failed" } }
    var selectedModelId: String?
        get() = prefs.getString("model", null)
        set(value) { check(prefs.edit().putString("model", value).commit()) { "auth-store-write-failed" } }
    var selectedAgentId: String?
        get() = prefs.getString("agent", null)
        set(value) { check(prefs.edit().putString("agent", value).commit()) { "auth-store-write-failed" } }
    var oidcClientId: String?
        get() = prefs.getString("oidc_client_id", null)
        set(value) { check(prefs.edit().putString("oidc_client_id", value).commit()) { "auth-store-write-failed" } }
    var relayTicket: String?
        get() = prefs.getString("relay_ticket", null)
        set(value) { check(prefs.edit().putString("relay_ticket", value).commit()) { "auth-store-write-failed" } }

    override fun save(auth: AuthTokens) {
        accessToken = auth.accessToken
        refreshToken = auth.refreshToken
        userId = auth.user.id
        userName = auth.user.name
        avatarUrl = auth.user.avatarUrl
    }

    fun user(): User? = userId?.let { User(it, userName ?: it, avatarUrl) }
    fun clear() { check(prefs.edit().clear().commit()) { "auth-store-clear-failed" } }
}

val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS message_attachments (id TEXT NOT NULL, messageId TEXT NOT NULL, conversationId TEXT NOT NULL, remoteId TEXT, name TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, localPath TEXT, thumbnailPath TEXT, sha256 TEXT NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id), FOREIGN KEY(messageId) REFERENCES messages(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_message_attachments_messageId ON message_attachments(messageId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_message_attachments_conversationId ON message_attachments(conversationId)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_message_attachments_remoteId ON message_attachments(remoteId)")
    }
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE conversations ADD COLUMN agentName TEXT NOT NULL DEFAULT 'OpenDrSai'")
        db.execSQL("ALTER TABLE conversations ADD COLUMN agentSource TEXT NOT NULL DEFAULT 'local'")
        db.execSQL("UPDATE conversations SET agentId='local:opendrsai' WHERE agentId='opendrsai-android'")
        db.execSQL("CREATE TABLE IF NOT EXISTS agent_catalog (id TEXT NOT NULL, userId TEXT NOT NULL, platformId TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, available INTEGER NOT NULL, chatSupported INTEGER NOT NULL, isDefault INTEGER NOT NULL, owner TEXT, capabilitiesJson TEXT NOT NULL, logoUrl TEXT, examplesJson TEXT NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(id, userId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_agent_catalog_userId ON agent_catalog(userId)")
    }
}

class OidcTransactionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "opendrsai_oidc_transaction",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(transaction: OidcLoginTransaction) {
        prefs.edit()
            .putString("client_id", transaction.clientId)
            .putString("redirect_uri", transaction.redirectUri)
            .putString("verifier", transaction.verifier)
            .putString("state", transaction.state)
            .putString("nonce", transaction.nonce)
            .putLong("created_at", transaction.createdAt)
            .commit()
    }

    fun load(): OidcLoginTransaction? {
        val transaction = OidcLoginTransaction(
            clientId = prefs.getString("client_id", null).orEmpty(),
            redirectUri = prefs.getString("redirect_uri", null).orEmpty(),
            verifier = prefs.getString("verifier", null).orEmpty(),
            state = prefs.getString("state", null).orEmpty(),
            nonce = prefs.getString("nonce", null).orEmpty(),
            createdAt = prefs.getLong("created_at", 0L),
        )
        return transaction.takeIf {
            it.clientId.isNotBlank() && it.redirectUri.isNotBlank() && it.verifier.isNotBlank() &&
                it.state.isNotBlank() && it.nonce.isNotBlank() && it.createdAt > 0
        } ?: run { clear(); null }
    }

    fun clear() {
        prefs.edit().clear().commit()
    }
}
