package ai.drsai.remote.workbench.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.runtime.v2.EventAppendDecision
import ai.drsai.remote.runtime.v2.EventSequencePolicy
import ai.drsai.remote.runtime.v2.RunCheckpoint
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.runtime.v2.RunJournal
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import ai.drsai.remote.remote.model.RemoteSessionRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.flow.Flow

const val ANDROID_LOCAL_RUNTIME_ID = "android-local"

@Entity(
    tableName = "workbench_workspaces",
    primaryKeys = ["subject", "organization", "runtimeId", "workspaceId"],
    indices = [Index("subject", "organization", "runtimeId")],
)
data class WorkbenchWorkspaceEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val displayName: String,
    val kind: String,
    val authority: String,
    val lastSyncedAt: Long,
)

@Entity(
    tableName = "workbench_sessions",
    primaryKeys = ["subject", "organization", "runtimeId", "workspaceId", "sessionId"],
    indices = [
        Index("subject", "organization", "runtimeId", "workspaceId"),
        Index(value = ["sourceConversationId"], unique = true),
    ],
)
data class WorkbenchSessionEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val title: String,
    val backendId: String,
    val authority: String,
    val sourceConversationId: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val unread: Boolean = false,
    val updatedAt: Long,
)

@Entity(
    tableName = "workbench_runs",
    primaryKeys = ["subject", "organization", "runtimeId", "runId"],
    indices = [
        Index("subject", "organization", "runtimeId", "workspaceId", "sessionId"),
        Index(value = ["subject", "idempotencyKey"], unique = true),
    ],
)
data class WorkbenchRunEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val backendId: String,
    val authority: String,
    val status: String,
    val lastSequence: Long,
    val idempotencyKey: String,
    val input: String,
    val skillVersionsJson: String = "{}",
    val completedSideEffectsJson: String = "[]",
    val pythonStateJson: String = "{}",
    val failureCode: String? = null,
    val updatedAt: Long,
)

@Entity(
    tableName = "workbench_events",
    primaryKeys = ["subject", "organization", "runtimeId", "eventId"],
    indices = [Index(value = ["subject", "organization", "runtimeId", "runId", "sequence"], unique = true)],
)
data class WorkbenchEventEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val eventId: String,
    val sequence: Long,
    val timestamp: String,
    val kind: String,
    val payloadVersion: Int,
    val payloadJson: String,
)

@Entity(
    tableName = "workbench_approvals",
    primaryKeys = ["subject", "organization", "runtimeId", "approvalId"],
    indices = [Index("subject", "organization", "runtimeId", "runId")],
)
data class WorkbenchApprovalEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val sessionId: String,
    val runId: String,
    val approvalId: String,
    val toolCallId: String,
    val operation: String,
    val argumentsDigest: String,
    val scope: String,
    val status: String,
    val expiresAt: String,
    val updatedAt: Long,
)

@Entity(
    tableName = "workbench_approval_grants",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "toolId"],
    indices = [Index("subject", "organization", "runtimeId", "sessionId")],
)
data class WorkbenchApprovalGrantEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val sessionId: String,
    val toolId: String,
    val createdAt: Long,
    val expiresAt: Long?,
)

@Entity(
    tableName = "workbench_audit",
    primaryKeys = ["subject", "organization", "auditId"],
    indices = [Index("subject", "organization", "runtimeId", "runId")],
)
data class WorkbenchAuditEntity(
    val subject: String,
    val organization: String,
    val auditId: String,
    val runtimeId: String,
    val runId: String?,
    val action: String,
    val outcome: String,
    val createdAt: Long,
    val detailsJson: String,
)

@Dao
interface WorkbenchDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveWorkspaces(items: List<WorkbenchWorkspaceEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSessions(items: List<WorkbenchSessionEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveRun(item: WorkbenchRunEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertEvent(item: WorkbenchEventEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveApproval(item: WorkbenchApprovalEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveApprovalGrant(item: WorkbenchApprovalGrantEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun appendAudit(item: WorkbenchAuditEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun appendAuditIfAbsent(item: WorkbenchAuditEntity): Long

    @Query("SELECT * FROM workbench_workspaces WHERE subject=:subject AND organization=:organization ORDER BY kind, displayName COLLATE NOCASE")
    suspend fun workspaces(subject: String, organization: String): List<WorkbenchWorkspaceEntity>

    @Query("SELECT * FROM workbench_workspaces WHERE subject=:subject ORDER BY kind, displayName COLLATE NOCASE, runtimeId, workspaceId")
    suspend fun allWorkspaces(subject: String): List<WorkbenchWorkspaceEntity>

    @Query("SELECT * FROM workbench_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId AND archived=0 ORDER BY pinned DESC, updatedAt DESC")
    suspend fun sessions(subject: String, organization: String, runtimeId: String, workspaceId: String): List<WorkbenchSessionEntity>

    @Query("SELECT * FROM workbench_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId AND archived=0 ORDER BY pinned DESC, updatedAt DESC, sessionId ASC LIMIT :limit OFFSET :offset")
    suspend fun sessionPage(subject: String, organization: String, runtimeId: String, workspaceId: String, limit: Int, offset: Int): List<WorkbenchSessionEntity>

    @Query("SELECT COUNT(*) FROM workbench_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId AND archived=0")
    suspend fun sessionCount(subject: String, organization: String, runtimeId: String, workspaceId: String): Int

    @Query("SELECT * FROM workbench_sessions WHERE subject=:subject AND archived=:archived ORDER BY pinned DESC, updatedAt DESC, sessionId ASC")
    suspend fun allSessions(subject: String, archived: Boolean = false): List<WorkbenchSessionEntity>

    @Query("SELECT * FROM workbench_sessions WHERE subject=:subject AND sessionId=:sessionId LIMIT 1")
    suspend fun session(subject: String, sessionId: String): WorkbenchSessionEntity?

    @Query("SELECT * FROM workbench_sessions WHERE subject=:subject AND archived=0 AND title LIKE '%' || :escapedQuery || '%' ESCAPE '\\' ORDER BY pinned DESC, updatedAt DESC, sessionId ASC LIMIT :limit")
    suspend fun searchSessions(subject: String, escapedQuery: String, limit: Int): List<WorkbenchSessionEntity>

    @Query("UPDATE workbench_sessions SET title=:title, updatedAt=:updatedAt WHERE subject=:subject AND sessionId=:sessionId")
    suspend fun renameSession(subject: String, sessionId: String, title: String, updatedAt: Long): Int

    @Query("UPDATE workbench_sessions SET pinned=:pinned, updatedAt=:updatedAt WHERE subject=:subject AND sessionId=:sessionId")
    suspend fun setSessionPinned(subject: String, sessionId: String, pinned: Boolean, updatedAt: Long): Int

    @Query("UPDATE workbench_sessions SET archived=:archived, updatedAt=:updatedAt WHERE subject=:subject AND sessionId=:sessionId")
    suspend fun setSessionArchived(subject: String, sessionId: String, archived: Boolean, updatedAt: Long): Int

    @Query("UPDATE workbench_sessions SET unread=:unread WHERE subject=:subject AND sessionId=:sessionId")
    suspend fun setSessionUnread(subject: String, sessionId: String, unread: Boolean): Int

    @Query("SELECT * FROM workbench_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND runId=:runId")
    suspend fun run(subject: String, organization: String, runtimeId: String, runId: String): WorkbenchRunEntity?

    @Query("SELECT * FROM workbench_runs WHERE subject=:subject AND idempotencyKey=:idempotencyKey LIMIT 1")
    suspend fun runByIdempotencyKey(subject: String, idempotencyKey: String): WorkbenchRunEntity?

    @Query("SELECT * FROM workbench_runs WHERE runId=:runId LIMIT 1")
    suspend fun runById(runId: String): WorkbenchRunEntity?

    @Query("SELECT pythonStateJson FROM workbench_runs WHERE runId=:runId LIMIT 1")
    suspend fun pythonState(runId: String): String?

    @Query("UPDATE workbench_runs SET pythonStateJson=:stateJson, updatedAt=:updatedAt WHERE runId=:runId")
    suspend fun updatePythonState(runId: String, stateJson: String, updatedAt: Long): Int

    @Query("SELECT * FROM workbench_runs WHERE subject=:subject AND status IN ('QUEUED','RUNNING','WAITING_APPROVAL','PAUSED') ORDER BY updatedAt")
    suspend fun recoverableRuns(subject: String): List<WorkbenchRunEntity>

    @Query("SELECT * FROM workbench_runs WHERE subject=:subject ORDER BY updatedAt DESC, runId ASC")
    suspend fun allRuns(subject: String): List<WorkbenchRunEntity>

    @Query("SELECT * FROM workbench_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND runId=:runId ORDER BY sequence")
    suspend fun events(subject: String, organization: String, runtimeId: String, runId: String): List<WorkbenchEventEntity>

    @Query("SELECT COUNT(*) > 0 FROM workbench_events WHERE eventId=:eventId")
    suspend fun eventExists(eventId: String): Boolean

    @Query("SELECT * FROM workbench_approvals WHERE subject=:subject AND organization=:organization AND status='PENDING' ORDER BY updatedAt DESC")
    suspend fun pendingApprovals(subject: String, organization: String): List<WorkbenchApprovalEntity>

    @Query("SELECT * FROM workbench_approvals WHERE subject=:subject AND status='PENDING' ORDER BY updatedAt DESC")
    suspend fun pendingApprovalsForSubject(subject: String): List<WorkbenchApprovalEntity>

    @Query("SELECT * FROM workbench_approvals WHERE subject=:subject AND status='PENDING' ORDER BY updatedAt DESC")
    fun pendingApprovalsFlow(subject: String): Flow<List<WorkbenchApprovalEntity>>

    @Query("SELECT * FROM workbench_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND approvalId=:approvalId")
    fun approvalFlow(subject: String, organization: String, runtimeId: String, approvalId: String): Flow<WorkbenchApprovalEntity?>

    @Query("SELECT * FROM workbench_approvals WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND approvalId=:approvalId")
    suspend fun approval(subject: String, organization: String, runtimeId: String, approvalId: String): WorkbenchApprovalEntity?

    @Query("UPDATE workbench_approvals SET status=:status, updatedAt=:updatedAt WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND approvalId=:approvalId AND status='PENDING'")
    suspend fun decideApprovalIfPending(subject: String, organization: String, runtimeId: String, approvalId: String, status: String, updatedAt: Long): Int

    @Query("SELECT COUNT(*) > 0 FROM workbench_approval_grants WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND toolId=:toolId AND (expiresAt IS NULL OR expiresAt >= :now)")
    suspend fun hasApprovalGrant(subject: String, organization: String, runtimeId: String, sessionId: String, toolId: String, now: Long): Boolean

    @Query("SELECT * FROM workbench_audit WHERE subject=:subject AND organization=:organization ORDER BY createdAt DESC")
    suspend fun audit(subject: String, organization: String): List<WorkbenchAuditEntity>

    @Query("SELECT * FROM workbench_audit WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND runId=:runId ORDER BY createdAt, auditId")
    suspend fun auditForRun(subject: String, organization: String, runtimeId: String, runId: String): List<WorkbenchAuditEntity>
}

class RoomRunJournal(private val database: ChatDatabase) : RunJournal {
    override suspend fun createIfAbsent(command: RunCommand): RunCheckpoint = database.withTransaction {
        val dao = database.workbenchDao()
        dao.runByIdempotencyKey(command.accountSubject, command.idempotencyKey)?.let { return@withTransaction it.toCheckpoint() }
        val created = RunCheckpoint(command, WorkbenchRunStatus.QUEUED)
        dao.saveRun(created.toEntity(System.currentTimeMillis()))
        created
    }

    override suspend fun findByIdempotencyKey(accountSubject: String, idempotencyKey: String): RunCheckpoint? =
        database.workbenchDao().runByIdempotencyKey(accountSubject, idempotencyKey)?.toCheckpoint()

    override suspend fun checkpoint(runId: WorkbenchId): RunCheckpoint? =
        database.workbenchDao().runById(runId.value)?.toCheckpoint()

    override suspend fun eventExists(eventId: WorkbenchId): Boolean =
        database.workbenchDao().eventExists(eventId.value)

    override suspend fun append(event: WorkbenchEvent, next: RunCheckpoint): EventAppendDecision =
        database.withTransaction {
            val dao = database.workbenchDao()
            val currentEntity = dao.runById(next.command.runId.value) ?: error("run_checkpoint_missing")
            val current = currentEntity.toCheckpoint()
            val decision = EventSequencePolicy.decide(current, event, dao.eventExists(event.eventId.value))
            if (decision == EventAppendDecision.APPEND) {
                dao.insertEvent(event.toEntity(next.command))
                dao.saveRun(next.toEntity(System.currentTimeMillis(), currentEntity.pythonStateJson))
            }
            decision
        }

    override suspend fun recoverable(accountSubject: String): List<RunCheckpoint> =
        database.workbenchDao().recoverableRuns(accountSubject).map { it.toCheckpoint() }

    private fun WorkbenchRunEntity.toCheckpoint(): RunCheckpoint {
        val binding = RuntimeBinding(WorkbenchId(runtimeId), RuntimeAuthority.valueOf(authority))
        val sideEffects = JSONArray(completedSideEffectsJson).let { array ->
            buildSet { repeat(array.length()) { add(array.getString(it)) } }
        }
        val skills = JSONObject(skillVersionsJson).let { value ->
            value.keys().asSequence().associateWith(value::getInt)
        }
        return RunCheckpoint(
            command = RunCommand(
                subject, organization, binding, WorkbenchId(workspaceId), WorkbenchId(sessionId),
                WorkbenchId(runId), backendId, idempotencyKey, input, skills,
            ),
            status = WorkbenchRunStatus.valueOf(status),
            lastSequence = lastSequence,
            completedSideEffects = sideEffects,
            failureCode = failureCode,
        )
    }

    private fun RunCheckpoint.toEntity(updatedAt: Long, pythonStateJson: String = "{}") = WorkbenchRunEntity(
        subject = command.accountSubject,
        organization = command.organization,
        runtimeId = command.binding.runtimeId.value,
        workspaceId = command.workspaceId.value,
        sessionId = command.sessionId.value,
        runId = command.runId.value,
        backendId = command.backendId,
        authority = command.binding.authority.name,
        status = status.name,
        lastSequence = lastSequence,
        idempotencyKey = command.idempotencyKey,
        input = command.input,
        skillVersionsJson = JSONObject(command.skillVersions).toString(),
        completedSideEffectsJson = JSONArray(completedSideEffects.toList()).toString(),
        pythonStateJson = pythonStateJson,
        failureCode = failureCode,
        updatedAt = updatedAt,
    )

    private fun WorkbenchEvent.toEntity(command: RunCommand) = WorkbenchEventEntity(
        subject = command.accountSubject,
        organization = command.organization,
        runtimeId = runtimeId.value,
        workspaceId = command.workspaceId.value,
        sessionId = command.sessionId.value,
        runId = runId.value,
        eventId = eventId.value,
        sequence = sequence,
        timestamp = timestamp,
        kind = kind,
        payloadVersion = payloadVersion,
        payloadJson = payloadJson,
    )
}

class WorkbenchProjectionRepository(private val dao: WorkbenchDao) {
    suspend fun projectLocalConversations(subject: String, conversations: List<ConversationEntity>) {
        val newest = conversations.maxOfOrNull(ConversationEntity::updatedAt) ?: System.currentTimeMillis()
        dao.saveWorkspaces(
            listOf(
                WorkbenchWorkspaceEntity(
                    subject = subject,
                    organization = "",
                    runtimeId = ANDROID_LOCAL_RUNTIME_ID,
                    workspaceId = localWorkspaceId(subject),
                    displayName = "OpenDrSai 本地",
                    kind = "LOCAL",
                    authority = "LOCAL_DEVICE",
                    lastSyncedAt = newest,
                ),
            ),
        )
        dao.saveSessions(conversations.map { it.toWorkbenchSession() })
    }

    suspend fun projectLocalConversation(conversation: ConversationEntity) =
        projectLocalConversations(conversation.userId, listOf(conversation))

    suspend fun projectRemoteWorkspaces(
        subject: String,
        items: List<Pair<String, RemoteWorkspaceRef>>,
        syncedAt: Long,
    ) {
        dao.saveWorkspaces(items.map { (runtimeName, workspace) ->
            WorkbenchWorkspaceEntity(
                subject, "", workspace.runtimeId.value, workspace.workspaceId.value,
                "${runtimeName} · ${workspace.displayName}", "REMOTE", RuntimeAuthority.REMOTE_RUNTIME.name, syncedAt,
            )
        })
    }

    suspend fun projectRemoteSessions(subject: String, items: List<RemoteSessionRef>, syncedAt: Long) {
        dao.saveSessions(items.map { session ->
            WorkbenchSessionEntity(
                subject, "", session.runtimeId.value, session.workspaceId.value, session.sessionId.value,
                session.title, session.backendId, RuntimeAuthority.REMOTE_RUNTIME.name, null,
                pinned = false, archived = false, unread = false, updatedAt = syncedAt,
            )
        })
    }

    private fun ConversationEntity.toWorkbenchSession() = WorkbenchSessionEntity(
        subject = userId,
        organization = "",
        runtimeId = ANDROID_LOCAL_RUNTIME_ID,
        workspaceId = localWorkspaceId(userId),
        sessionId = id,
        title = title,
        backendId = "opendrsai",
        authority = "LOCAL_DEVICE",
        sourceConversationId = id,
        updatedAt = updatedAt,
    )

    companion object {
        fun localWorkspaceId(subject: String): String {
            require(subject.isNotBlank()) { "account_subject_required" }
            // Account is already part of the composite key. A constant avoids
            // leaking arbitrary OIDC subject characters into a domain ID.
            return "local"
        }
    }
}

data class WorkbenchSearchResult(
    val sessions: List<WorkbenchSessionEntity>,
    val messages: List<ai.drsai.remote.data.MessageEntity>,
)

sealed interface SessionMutationResult {
    data object Applied : SessionMutationResult
    data object NotFound : SessionMutationResult
    data object RemoteAuthorityRequired : SessionMutationResult
}

/** Account-scoped mutations and search for the unified drawer read model. */
class UnifiedWorkbenchRepository(private val database: ChatDatabase) {
    suspend fun search(subject: String, query: String, limit: Int = 50): WorkbenchSearchResult {
        require(subject.isNotBlank()) { "account_subject_required" }
        require(limit in 1..100) { "search_limit_invalid" }
        val escaped = escapeLike(query.trim().take(100))
        if (escaped.isBlank()) return WorkbenchSearchResult(emptyList(), emptyList())
        return WorkbenchSearchResult(
            database.workbenchDao().searchSessions(subject, escaped, limit),
            database.dao().searchVisibleMessages(subject, escaped, limit),
        )
    }

    suspend fun rename(subject: String, sessionId: String, newTitle: String, now: Long): SessionMutationResult =
        mutateLocal(subject, sessionId) { session ->
            val title = newTitle.trim().take(120)
            require(title.isNotEmpty()) { "session_title_required" }
            database.withTransaction {
                database.workbenchDao().renameSession(subject, sessionId, title, now)
                session.sourceConversationId?.let { database.dao().updateConversation(it, title, now) }
            }
        }

    suspend fun setPinned(subject: String, sessionId: String, pinned: Boolean, now: Long): SessionMutationResult =
        mutateLocal(subject, sessionId) { database.workbenchDao().setSessionPinned(subject, sessionId, pinned, now) }

    suspend fun setArchived(subject: String, sessionId: String, archived: Boolean, now: Long): SessionMutationResult =
        mutateLocal(subject, sessionId) { database.workbenchDao().setSessionArchived(subject, sessionId, archived, now) }

    suspend fun setUnread(subject: String, sessionId: String, unread: Boolean): SessionMutationResult =
        mutateLocal(subject, sessionId) { database.workbenchDao().setSessionUnread(subject, sessionId, unread) }

    private suspend fun mutateLocal(
        subject: String,
        sessionId: String,
        mutation: suspend (WorkbenchSessionEntity) -> Unit,
    ): SessionMutationResult {
        val session = database.workbenchDao().session(subject, sessionId) ?: return SessionMutationResult.NotFound
        if (session.authority != RuntimeAuthority.LOCAL_DEVICE.name) return SessionMutationResult.RemoteAuthorityRequired
        mutation(session)
        return SessionMutationResult.Applied
    }

    companion object {
        fun escapeLike(value: String): String = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    }
}
