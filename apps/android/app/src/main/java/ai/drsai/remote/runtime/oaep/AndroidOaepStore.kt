package ai.drsai.remote.runtime.oaep

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSource

@Entity(
    tableName = "android_oaep_sessions",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId"],
    indices = [Index("subject", "organization", "runtimeId", "workspaceId")],
)
data class AndroidOaepSessionEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val title: String?,
    val status: String,
    val backend: String?,
    val createdAt: String,
    val updatedAt: String,
    val lastSequence: Long,
)

@Entity(
    tableName = "android_oaep_runs",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "runId"],
    indices = [Index("subject", "organization", "runtimeId", "sessionId", "updatedAt")],
)
data class AndroidOaepRunEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val parentRunId: String?,
    val runSequence: Long?,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val completedAt: String?,
)

@Entity(
    tableName = "android_oaep_items",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "itemId"],
    indices = [
        Index(value = ["subject", "organization", "runtimeId", "sessionId", "runId", "itemSequence"], unique = true),
        Index(value = ["subject", "organization", "runtimeId", "sessionId", "backendItemId"], unique = true),
    ],
)
data class AndroidOaepItemEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val itemId: String,
    val backendItemId: String,
    val itemSequence: Long,
    val revision: Long,
    val latestEventSequence: Long,
    val itemJson: String,
)

@Entity(
    tableName = "android_oaep_events",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "eventId"],
    indices = [
        Index(value = ["subject", "organization", "runtimeId", "sessionId", "eventSequence"], unique = true),
        Index(value = ["subject", "organization", "runtimeId", "sessionId", "dedupeKey"], unique = true),
        Index(value = ["subject", "organization", "runtimeId", "sessionId", "inputDedupeKey"]),
    ],
)
data class AndroidOaepEventEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String?,
    val itemId: String?,
    val eventId: String,
    val eventSequence: Long,
    val dedupeKey: String,
    val inputDedupeKey: String,
    val eventJson: String,
)

@Entity(
    tableName = "android_oaep_migrations",
    primaryKeys = ["subject", "organization", "runtimeId", "sessionId", "migrationVersion"],
    indices = [Index("subject", "organization", "runtimeId", "status")],
)
data class AndroidOaepMigrationEntity(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val migrationVersion: Int,
    val sourceDigest: String,
    val status: String,
    val completedThrough: String?,
    val updatedAt: Long,
    val errorCode: String?,
)

@Dao
interface AndroidOaepDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveSession(value: AndroidOaepSessionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveRun(value: AndroidOaepRunEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveItems(values: List<AndroidOaepItemEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertEvent(value: AndroidOaepEventEntity): Long

    @Query("SELECT * FROM android_oaep_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId")
    suspend fun session(subject: String, organization: String, runtimeId: String, sessionId: String): AndroidOaepSessionEntity?

    @Query("SELECT COUNT(*) FROM android_oaep_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND workspaceId=:workspaceId")
    suspend fun sessionCount(subject: String, organization: String, runtimeId: String, workspaceId: String): Int

    @Query("SELECT * FROM android_oaep_sessions WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId ORDER BY updatedAt,sessionId")
    suspend fun runtimeSessions(subject: String, organization: String, runtimeId: String): List<AndroidOaepSessionEntity>

    @Query("SELECT * FROM android_oaep_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND runId=:runId")
    suspend fun run(subject: String, organization: String, runtimeId: String, sessionId: String, runId: String): AndroidOaepRunEntity?

    @Query("SELECT * FROM android_oaep_runs WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId ORDER BY runSequence,createdAt,runId")
    suspend fun runs(subject: String, organization: String, runtimeId: String, sessionId: String): List<AndroidOaepRunEntity>

    @Query("SELECT * FROM android_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND runId=:runId ORDER BY itemSequence,itemId")
    suspend fun items(subject: String, organization: String, runtimeId: String, sessionId: String, runId: String): List<AndroidOaepItemEntity>

    @Query("SELECT * FROM android_oaep_items WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId ORDER BY runId,itemSequence,itemId")
    suspend fun sessionItems(subject: String, organization: String, runtimeId: String, sessionId: String): List<AndroidOaepItemEntity>

    @Query("SELECT * FROM android_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId ORDER BY eventSequence")
    suspend fun events(subject: String, organization: String, runtimeId: String, sessionId: String): List<AndroidOaepEventEntity>

    @Query("SELECT * FROM android_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND eventSequence > :afterSequence ORDER BY eventSequence LIMIT :limit")
    suspend fun eventsAfter(subject: String, organization: String, runtimeId: String, sessionId: String, afterSequence: Long, limit: Int): List<AndroidOaepEventEntity>

    @Query("SELECT MIN(eventSequence) FROM android_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId")
    suspend fun firstEventSequence(subject: String, organization: String, runtimeId: String, sessionId: String): Long?

    @Query("DELETE FROM android_oaep_events WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND eventSequence <= :throughSequence")
    suspend fun compactEventsThrough(subject: String, organization: String, runtimeId: String, sessionId: String, throughSequence: Long): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMigration(value: AndroidOaepMigrationEntity)

    @Query("SELECT * FROM android_oaep_migrations WHERE subject=:subject AND organization=:organization AND runtimeId=:runtimeId AND sessionId=:sessionId AND migrationVersion=:migrationVersion")
    suspend fun migration(subject: String, organization: String, runtimeId: String, sessionId: String, migrationVersion: Int): AndroidOaepMigrationEntity?
}

data class AndroidOaepOwner(val subject: String, val organization: String) {
    init { require(subject.isNotBlank()) { "oaep_subject_required" } }
}

sealed interface AndroidOaepReplayResult {
    data class Page(val value: OaepEventPage) : AndroidOaepReplayResult
    data class CursorExpired(val snapshot: OaepSnapshot) : AndroidOaepReplayResult
}

data class AndroidOaepRetentionPolicy(
    val retainLastEvents: Int = 1_000,
    val terminalRunsOnly: Boolean = true,
) {
    init { require(retainLastEvents >= 1) { "oaep_retention_minimum_invalid" } }
}

data class AndroidOaepCompactionResult(
    val deletedEvents: Int,
    val compactedThrough: Long,
    val snapshotSequence: Long,
)

class RoomAndroidOaepStore(private val database: ChatDatabase) {
    suspend fun relaySessions(owner: AndroidOaepOwner, runtimeId: String): List<AndroidOaepRelaySession> =
        database.androidOaepDao().runtimeSessions(owner.subject, owner.organization, runtimeId).map {
            AndroidOaepRelaySession(it.workspaceId, it.sessionId)
        }

    suspend fun commit(
        owner: AndroidOaepOwner,
        scope: AndroidOaepScope,
        result: AndroidOaepWriteResult,
    ) = database.withTransaction {
        if (result.duplicate) return@withTransaction
        val dao = database.androidOaepDao()
        val existing = dao.session(owner.subject, owner.organization, scope.runtimeId, scope.sessionId)
        val expectedPrevious = result.appended.firstOrNull()?.sequence?.minus(1) ?: result.state.lastSequence
        require((existing?.lastSequence ?: 0L) == expectedPrevious) { "oaep_room_sequence_conflict" }
        require(result.state.session.id == scope.sessionId && result.state.run.id == scope.runId) {
            "oaep_room_scope_mismatch"
        }
        result.appended.forEach { event ->
            check(dao.insertEvent(AndroidOaepEventEntity(
                owner.subject, owner.organization, scope.runtimeId, scope.workspaceId, scope.sessionId,
                event.runId, event.itemId, event.eventId, event.sequence, event.dedupeKey,
                result.appended.first().dedupeKey,
                OaepJsonCodec.eventJson(event).toString(),
            )) != -1L) { "oaep_room_event_conflict" }
        }
        val state = result.state
        dao.saveRun(AndroidOaepRunEntity(
            owner.subject, owner.organization, scope.runtimeId, scope.workspaceId, scope.sessionId,
            state.run.id, state.run.parentRunId, state.run.sequence, state.run.status,
            state.run.createdAt, state.run.updatedAt, state.run.completedAt,
        ))
        dao.saveItems(state.items.values.map { item ->
            val backendItemId = item.source.backendItemId ?: error("oaep_backend_item_binding_missing")
            AndroidOaepItemEntity(
                owner.subject, owner.organization, scope.runtimeId, scope.workspaceId, scope.sessionId,
                scope.runId, item.id, backendItemId, item.sequence,
                state.itemRevisions.getValue(item.id), state.lastSequence,
                OaepJsonCodec.itemJson(item).toString(),
            )
        })
        dao.saveSession(AndroidOaepSessionEntity(
            owner.subject, owner.organization, scope.runtimeId, scope.workspaceId, scope.sessionId,
            state.session.title, state.session.status, state.session.backend,
            state.session.createdAt, state.session.updatedAt, state.lastSequence,
        ))
    }

    suspend fun load(
        owner: AndroidOaepOwner,
        scope: AndroidOaepScope,
        newRunCreatedAt: String? = null,
    ): AndroidOaepWriterState? = database.withTransaction {
        val dao = database.androidOaepDao()
        val session = dao.session(owner.subject, owner.organization, scope.runtimeId, scope.sessionId)
            ?: return@withTransaction null
        require(session.workspaceId == scope.workspaceId) { "oaep_room_workspace_mismatch" }
        val run = dao.run(owner.subject, owner.organization, scope.runtimeId, scope.sessionId, scope.runId)
        val rows = dao.items(owner.subject, owner.organization, scope.runtimeId, scope.sessionId, scope.runId)
        val eventRows = dao.events(owner.subject, owner.organization, scope.runtimeId, scope.sessionId)
        val items = rows.associate { row -> row.itemId to OaepJsonCodec.item(org.json.JSONObject(row.itemJson)) }
        val eventRoots = eventRows.map { org.json.JSONObject(it.eventJson) }
        val events = eventRoots.map(OaepJsonCodec::event)
        val persistedRunSource = eventRoots.asSequence()
            .mapNotNull { it.optJSONObject("data")?.optJSONObject("run") }
            .map(OaepJsonCodec::run)
            .firstOrNull { it.id == scope.runId }
            ?.source
        require(events.lastOrNull()?.sequence == session.lastSequence || events.isEmpty() && session.lastSequence == 0L) {
            "oaep_room_watermark_mismatch"
        }
        AndroidOaepWriterState(
            session = OaepSession(
                session.sessionId, session.workspaceId, session.title, session.status, session.backend,
                session.createdAt, session.updatedAt,
            ),
            run = OaepRun(
                run?.runId ?: scope.runId, run?.sessionId ?: scope.sessionId, run?.parentRunId, run?.runSequence ?: scope.runSequence,
                persistedRunSource ?: OaepSource(
                    backend = scope.backend, client = "android", runtimeId = scope.sourceRuntimeId,
                    adapter = "android-agent-runtime", adapterVersion = "1", mappingVersion = "oaep-1",
                ),
                run?.status ?: "queued",
                run?.createdAt ?: newRunCreatedAt ?: session.updatedAt,
                run?.updatedAt ?: newRunCreatedAt ?: session.updatedAt,
                run?.completedAt,
            ),
            items = items,
            itemBindings = rows.associate {
                BackendItemId.of(it.backendItemId) to OaepItemId.of(it.itemId)
            },
            itemRevisions = rows.associate { it.itemId to it.revision },
            events = events,
            acceptedDedupeKeys = eventRows.map(AndroidOaepEventEntity::inputDedupeKey).toSet(),
            lastSequence = session.lastSequence,
        )
    }

    /** Read-only authority projection. It never reconstructs state from private Runtime events. */
    suspend fun snapshot(
        owner: AndroidOaepOwner,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): OaepSnapshot? = database.withTransaction {
        require(runtimeId.isNotBlank() && workspaceId.isNotBlank() && sessionId.isNotBlank()) {
            "oaep_snapshot_scope_required"
        }
        val dao = database.androidOaepDao()
        val session = dao.session(owner.subject, owner.organization, runtimeId, sessionId)
            ?: return@withTransaction null
        require(session.workspaceId == workspaceId) { "oaep_room_workspace_mismatch" }
        val defaultSource = OaepSource(
            backend = session.backend ?: "android-agent",
            client = "android",
            runtimeId = runtimeId,
            adapter = "android-agent-runtime",
            adapterVersion = "1",
            mappingVersion = "oaep-1",
        )
        val runSources = dao.events(owner.subject, owner.organization, runtimeId, sessionId)
            .asSequence()
            .map { org.json.JSONObject(it.eventJson) }
            .mapNotNull { it.optJSONObject("data")?.optJSONObject("run") }
            .map(OaepJsonCodec::run)
            .associate { it.id to it.source }
        OaepSnapshot(
            version = "1.0",
            session = OaepSession(
                session.sessionId, session.workspaceId, session.title, session.status, session.backend,
                session.createdAt, session.updatedAt,
            ),
            runs = dao.runs(owner.subject, owner.organization, runtimeId, sessionId).map { run ->
                OaepRun(
                    run.runId, run.sessionId, run.parentRunId, run.runSequence,
                    runSources[run.runId] ?: defaultSource,
                    run.status, run.createdAt, run.updatedAt, run.completedAt,
                )
            },
            items = dao.sessionItems(owner.subject, owner.organization, runtimeId, sessionId).map { row ->
                OaepJsonCodec.item(org.json.JSONObject(row.itemJson))
            },
            snapshotSequence = session.lastSequence,
        )
    }

    /** Append-only Journal replay with explicit gap/expired-cursor recovery via Snapshot. */
    suspend fun replay(
        owner: AndroidOaepOwner,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
        afterSequence: Long,
        limit: Int = 100,
    ): AndroidOaepReplayResult = database.withTransaction {
        require(afterSequence >= 0) { "oaep_cursor_invalid" }
        require(limit in 1..500) { "oaep_page_limit_invalid" }
        val dao = database.androidOaepDao()
        val session = dao.session(owner.subject, owner.organization, runtimeId, sessionId)
            ?: error("oaep_room_session_missing")
        require(session.workspaceId == workspaceId) { "oaep_room_workspace_mismatch" }
        val first = dao.firstEventSequence(owner.subject, owner.organization, runtimeId, sessionId)
        if (afterSequence > session.lastSequence ||
            first != null && afterSequence < first - 1 ||
            first == null && afterSequence < session.lastSequence
        ) {
            return@withTransaction AndroidOaepReplayResult.CursorExpired(
                snapshot(owner, runtimeId, workspaceId, sessionId) ?: error("oaep_room_session_missing"),
            )
        }
        val rows = dao.eventsAfter(
            owner.subject, owner.organization, runtimeId, sessionId, afterSequence, limit + 1,
        )
        val selected = rows.take(limit)
        val events = selected.map { OaepJsonCodec.event(org.json.JSONObject(it.eventJson)) }
        require(events.firstOrNull()?.sequence == afterSequence + 1 || events.isEmpty()) {
            "oaep_room_event_sequence_gap"
        }
        require(events.zipWithNext().all { (left, right) -> right.sequence == left.sequence + 1 }) {
            "oaep_room_event_sequence_gap"
        }
        AndroidOaepReplayResult.Page(OaepEventPage(
            version = "1.0",
            objectType = "list",
            data = events,
            nextSequence = events.lastOrNull()?.sequence ?: afterSequence,
            hasMore = rows.size > limit,
        ))
    }

    /**
     * Compacts only the prefix already represented by the authoritative Room
     * Projection/Snapshot. Active Runs are protected by default. Old cursors
     * subsequently receive CursorExpired + Snapshot rather than a silent gap.
     */
    suspend fun compact(
        owner: AndroidOaepOwner,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
        policy: AndroidOaepRetentionPolicy = AndroidOaepRetentionPolicy(),
    ): AndroidOaepCompactionResult = database.withTransaction {
        val dao = database.androidOaepDao()
        val session = dao.session(owner.subject, owner.organization, runtimeId, sessionId)
            ?: error("oaep_room_session_missing")
        require(session.workspaceId == workspaceId) { "oaep_room_workspace_mismatch" }
        val runs = dao.runs(owner.subject, owner.organization, runtimeId, sessionId)
        if (policy.terminalRunsOnly) {
            require(runs.isNotEmpty() && runs.all { it.status in setOf("completed", "failed", "cancelled") }) {
                "oaep_compaction_active_run"
            }
        }
        val through = (session.lastSequence - policy.retainLastEvents).coerceAtLeast(0)
        val deleted = if (through == 0L) 0 else dao.compactEventsThrough(
            owner.subject, owner.organization, runtimeId, sessionId, through,
        )
        AndroidOaepCompactionResult(deleted, through, session.lastSequence)
    }
}
