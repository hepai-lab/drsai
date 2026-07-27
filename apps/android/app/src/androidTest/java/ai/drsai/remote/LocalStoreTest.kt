package ai.drsai.remote

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.ConversationSummaryEntity
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.MessageAttachmentEntity
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteRuntimeEntity
import ai.drsai.remote.remote.data.RemoteEventEntity
import ai.drsai.remote.remote.data.RemoteEventCursorEntity
import ai.drsai.remote.remote.data.PendingRemoteApprovalEntity
import ai.drsai.remote.remote.data.RemoteRunEntity
import ai.drsai.remote.remote.data.RemoteWorkspaceEntity
import ai.drsai.remote.remote.data.RemoteSessionEntity
import ai.drsai.remote.remote.data.RemoteProcessRecovery
import ai.drsai.remote.remote.data.WorkspaceInstructionVersionStore
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.runtime.v2.EventAppendDecision
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.data.SessionMutationResult
import ai.drsai.remote.workbench.data.UnifiedWorkbenchRepository
import ai.drsai.remote.workbench.data.WorkbenchProjectionRepository
import ai.drsai.remote.workbench.data.WorkbenchSessionEntity
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import ai.drsai.remote.runtime.security.ApprovalBinding
import ai.drsai.remote.runtime.security.ApprovalDecision
import ai.drsai.remote.runtime.security.ApprovalDecisionResult
import ai.drsai.remote.runtime.security.ApprovalRepository
import ai.drsai.remote.runtime.security.CreateApprovalCommand
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalStoreTest {
    private lateinit var database: ChatDatabase

    @Before fun createDatabase() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After fun closeDatabase() = database.close()

    @Test fun conversations_and_memories_are_scoped_locally() = runBlocking {
        val dao = database.dao()
        dao.saveConversation(ConversationEntity(id = "c1", userId = "u1", title = "One", agentId = "agent", modelId = "model", createdAt = 1, updatedAt = 1))
        dao.saveConversation(ConversationEntity(id = "c2", userId = "u2", title = "Two", agentId = "agent", modelId = "model", createdAt = 2, updatedAt = 2))
        dao.saveMessage(MessageEntity("m1", "c1", "user", "hello"))
        dao.saveMessage(MessageEntity("m2", "c2", "user", "private"))
        dao.saveAttachments(listOf(MessageAttachmentEntity("a1", "m1", "c1", "att_1", "note.txt", "text/plain", 5, "file", null, null, "hash")))
        dao.saveAttachments(listOf(MessageAttachmentEntity("a2", "m2", "c2", "att_2", "secret.txt", "text/plain", 6, "file", null, null, "hash2")))
        assertEquals(listOf("a1"), dao.attachmentSnapshot("c1").map { it.id })
        assertEquals(listOf("a1"), dao.allAttachmentsForUser("u1").map { it.id })
        dao.saveToolArtifact(ToolArtifactEntity("tool-a", "u1", "run", "c1", "call", "workspace.read", "full", 3))
        dao.saveToolArtifact(ToolArtifactEntity("tool-b", "u2", "run", "c2", "call", "workspace.read", "secret", 3))
        assertEquals(listOf("tool-a"), dao.allToolArtifacts("u1").map { it.id })
        dao.saveMemory(MemoryEntity(userId = "u1", content = "green"))
        dao.saveMemory(MemoryEntity(userId = "u2", content = "blue"))
        dao.saveConversationSummary(ConversationSummaryEntity("c1", "m1", "m1", "summary", 1, 4))

        assertEquals(listOf("c1"), dao.conversationSnapshot("u1").map { it.id })
        assertEquals(listOf("green"), dao.searchMemories("u1", "", 10).map { it.content })
        assertEquals("summary", dao.conversationSummary("c1")?.content)
        dao.deleteConversation("c1")
        assertTrue(dao.runtimeMessageSnapshot("c1").isEmpty())
        assertTrue(dao.attachmentSnapshot("c1").isEmpty())
    }

    @Test fun encrypted_store_holds_relay_ticket_and_clear_removes_it() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = SecureTokenStore(context)
        store.relayTicket = "short-lived-relay-ticket"
        assertEquals("short-lived-relay-ticket", SecureTokenStore(context).relayTicket)
        store.clear()
        assertEquals(null, SecureTokenStore(context).relayTicket)
    }

    @Test fun acceptedRemoteInstructionVersionsPersistAndAreScopedByAccountRuntimeAndWorkspace() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = WorkspaceInstructionVersionStore(context)
        val runtime = RuntimeId("instruction-runtime")
        val workspace = WorkspaceId("instruction-workspace")
        val versions = mapOf("remote:AGENTS.md" to "a".repeat(64))
        store.accept("alice", runtime, workspace, versions)
        assertEquals(versions, WorkspaceInstructionVersionStore(context).accepted("alice", runtime, workspace))
        assertEquals(null, store.accepted("bob", runtime, workspace))
        assertEquals(null, store.accepted("alice", RuntimeId("other-runtime"), workspace))
        assertEquals(null, store.accepted("alice", runtime, WorkspaceId("other-workspace")))
    }

    @Test fun remote_cache_is_account_scoped_and_logout_clear_preserves_other_account() = runBlocking {
        val dao = database.remoteDao()
        fun runtime(subject: String) = RemoteRuntimeEntity(subject, "ihep", "same-runtime", subject,
            "instance", "1", "ONLINE", "[]", 1, false)
        dao.saveRuntimes(listOf(runtime("alice"), runtime("bob")))
        RemoteCacheRepository(database).clearSubject("alice")
        assertTrue(dao.runtimes("alice", "ihep").isEmpty())
        assertEquals(listOf("bob"), dao.runtimes("bob", "ihep").map { it.subject })
    }

    @Test fun runtime_v2_journal_atomically_persists_event_and_checkpoint() = runBlocking {
        val journal = RoomRunJournal(database)
        val command = RunCommand(
            "alice", "ihep", RuntimeBinding.AndroidLocal,
            WorkbenchId("local"), WorkbenchId("session"), WorkbenchId("run"),
            "opendrsai", "send-once", "hello", mapOf("memory.search" to 2),
        )
        val queued = journal.createIfAbsent(command)
        val event = WorkbenchEvent(
            WorkbenchId("run:1"), command.runId, command.binding.runtimeId, 1,
            "2026-07-21T00:00:00Z", "run.started",
        )
        val running = queued.copy(status = WorkbenchRunStatus.RUNNING, lastSequence = 1)
        assertEquals(EventAppendDecision.APPEND, journal.append(event, running))
        assertEquals(EventAppendDecision.DUPLICATE, journal.append(event, running))
        assertEquals(1L, journal.checkpoint(command.runId)?.lastSequence)
        assertEquals(command.runId, journal.findByIdempotencyKey("alice", "send-once")?.command?.runId)
        assertEquals(mapOf("memory.search" to 2), journal.checkpoint(command.runId)?.command?.skillVersions)
    }

    @Test fun workbenchSessionPagesAreStableCompleteAndNonOverlapping() = runBlocking {
        val conversations = (0 until 85).map { index ->
            ConversationEntity(
                id = "session-${index.toString().padStart(3, '0')}",
                userId = "paged-user",
                title = "Session $index",
                agentId = "local:opendrsai",
                modelId = "model",
                createdAt = index.toLong(),
                updatedAt = index.toLong(),
            )
        }
        WorkbenchProjectionRepository(database.workbenchDao())
            .projectLocalConversations("paged-user", conversations)
        val dao = database.workbenchDao()
        val pages = listOf(0, 40, 80).flatMap { offset ->
            dao.sessionPage("paged-user", "", "android-local", "local", 40, offset)
        }
        assertEquals(85, dao.sessionCount("paged-user", "", "android-local", "local"))
        assertEquals(85, pages.size)
        assertEquals(85, pages.map { it.sessionId }.distinct().size)
        assertEquals("session-084", pages.first().sessionId)
        assertEquals("session-000", pages.last().sessionId)
    }

    @Test fun oneThousandSessionPagingMeetsTheStage5DataBenchmark() = runBlocking {
        val conversations = (0 until 1_000).map { index ->
            ConversationEntity(
                id = "benchmark-${index.toString().padStart(4, '0')}",
                userId = "benchmark-user",
                title = "Benchmark Session $index",
                agentId = "local:opendrsai",
                modelId = "model",
                createdAt = index.toLong(),
                updatedAt = index.toLong(),
            )
        }
        WorkbenchProjectionRepository(database.workbenchDao())
            .projectLocalConversations("benchmark-user", conversations)

        val dao = database.workbenchDao()
        val startedAt = android.os.SystemClock.elapsedRealtime()
        val loaded = (0 until 1_000 step 40).flatMap { offset ->
            dao.sessionPage("benchmark-user", "", "android-local", "local", 40, offset)
        }
        val elapsedMs = android.os.SystemClock.elapsedRealtime() - startedAt

        assertEquals(1_000, dao.sessionCount("benchmark-user", "", "android-local", "local"))
        assertEquals(1_000, loaded.size)
        assertEquals(1_000, loaded.map { it.sessionId }.distinct().size)
        assertEquals("benchmark-0999", loaded.first().sessionId)
        assertEquals("benchmark-0000", loaded.last().sessionId)
        assertTrue("25 Room pages took ${elapsedMs}ms", elapsedMs < 10_000)
    }

    @Test fun runtime_v2_recovers_persisted_running_state_without_duplicate_side_effect() = runBlocking {
        val journal = RoomRunJournal(database)
        val command = RunCommand(
            "alice", "ihep", RuntimeBinding.AndroidLocal,
            WorkbenchId("local"), WorkbenchId("session-recover"), WorkbenchId("run-recover"),
            "opendrsai", "recover-once", "continue",
        )
        val firstProcess = RuntimeV2EventRecorder(journal)
        firstProcess.start(command)
        firstProcess.record(command.runId.value, RuntimeEvent.Started(command.runId.value))

        val secondProcess = RuntimeV2EventRecorder(RoomRunJournal(database))
        val paused = secondProcess.recover("alice").single { it.command.runId == command.runId }
        assertEquals(WorkbenchRunStatus.PAUSED, paused.status)
        secondProcess.resume(command.runId)
        secondProcess.record(command.runId.value, RuntimeEvent.Started(command.runId.value))
        val cancelled = secondProcess.record(command.runId.value, RuntimeEvent.Cancelled)

        assertEquals(WorkbenchRunStatus.CANCELLED, cancelled.status)
        assertEquals(listOf(1L, 2L, 3L, 4L), database.workbenchDao()
            .events("alice", "ihep", "android-local", command.runId.value).map { it.sequence })
    }

    @Test fun runtimeCheckpointSurvivesDatabaseCloseAndColdReopen() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "stage5-process-death.db"
        context.deleteDatabase(name)
        val command = RunCommand(
            "alice", "ihep", RuntimeBinding.AndroidLocal,
            WorkbenchId("local"), WorkbenchId("session-cold"), WorkbenchId("run-cold"),
            "opendrsai", "cold-key", "continue",
        )
        val firstProcess = Room.databaseBuilder(context, ChatDatabase::class.java, name).build()
        try {
            val recorder = RuntimeV2EventRecorder(RoomRunJournal(firstProcess))
            recorder.start(command)
            recorder.record(command.runId.value, RuntimeEvent.Started(command.runId.value))
        } finally {
            firstProcess.close()
        }

        val secondProcess = Room.databaseBuilder(context, ChatDatabase::class.java, name).build()
        try {
            val recorder = RuntimeV2EventRecorder(RoomRunJournal(secondProcess))
            val recovered = recorder.recover("alice").single()
            assertEquals(WorkbenchRunStatus.PAUSED, recovered.status)
            assertEquals(2, recovered.lastSequence)
            val events = secondProcess.workbenchDao().events("alice", "ihep", "android-local", "run-cold")
            assertEquals(listOf("run.started", "run.recovered"), events.map { it.kind })
        } finally {
            secondProcess.close()
        }
        context.deleteDatabase(name)
        Unit
    }

    @Test fun approval_is_exactly_bound_first_decision_wins_and_audit_is_appended() = runBlocking {
        val repository = ApprovalRepository(database)
        val binding = ApprovalBinding.create(
            WorkbenchId("run-approval"), "call-1", "files.write", "{\"path\":\"a.txt\"}", "once",
        )
        val command = CreateApprovalCommand(
            "alice", "ihep", WorkbenchId("android-local"), WorkbenchId("session"),
            WorkbenchId("approval-1"), binding, expiresAtMillis = 10_000,
        )
        repository.request(command, nowMillis = 1)
        val tampered = command.copy(binding = ApprovalBinding.create(
            binding.runId, binding.toolCallId, binding.toolId, "{\"path\":\"other.txt\"}", binding.scope,
        ))
        assertTrue(runCatching { repository.decide(tampered, ApprovalDecision.ALLOW_ONCE, 2) }.isFailure)

        val decisions = coroutineScope {
            listOf(
                async { repository.decide(command, ApprovalDecision.ALLOW_ONCE, 3) },
                async { repository.decide(command, ApprovalDecision.DECLINE, 3) },
            ).awaitAll()
        }
        assertEquals(1, decisions.count { it is ApprovalDecisionResult.Applied })
        assertEquals(1, decisions.count { it is ApprovalDecisionResult.AlreadyDecided })
        assertEquals(listOf("approval.requested", "approval.decided"),
            repository.audit("alice", "ihep").map { it.action }.reversed())
    }

    @Test fun session_approval_grant_is_scoped_and_expiry_is_terminal() = runBlocking {
        val repository = ApprovalRepository(database)
        fun command(id: String, session: String, expires: Long = 100) = CreateApprovalCommand(
            "alice", "ihep", WorkbenchId("android-local"), WorkbenchId(session), WorkbenchId(id),
            ApprovalBinding.create(WorkbenchId("run-$id"), "call-$id", "files.write", "{\"path\":\"a\"}", "session"),
            expires,
        )
        val granted = command("approval-grant", "session-a")
        repository.request(granted, 1)
        assertTrue(repository.decide(granted, ApprovalDecision.ALLOW_SESSION, 2) is ApprovalDecisionResult.Applied)
        assertTrue(repository.isSessionGranted("alice", "ihep", WorkbenchId("android-local"), WorkbenchId("session-a"), "files.write", 3))
        assertTrue(!repository.isSessionGranted("alice", "ihep", WorkbenchId("android-local"), WorkbenchId("session-b"), "files.write", 3))

        val expired = command("approval-expired", "session-a", expires = 5)
        repository.request(expired, 1)
        assertEquals(ApprovalDecisionResult.Expired, repository.decide(expired, ApprovalDecision.ALLOW_ONCE, 6))
    }

    @Test fun auditRowsAreAppendOnlyAndDuplicateIdsCannotReplaceHistory() = runBlocking {
        val dao = database.workbenchDao()
        val original = ai.drsai.remote.workbench.data.WorkbenchAuditEntity(
            subject = "alice", organization = "ihep", auditId = "immutable-audit",
            runtimeId = "android-local", runId = "run", action = "tool.started",
            outcome = "STARTED", createdAt = 1, detailsJson = "{}",
        )
        dao.appendAudit(original)
        val replacement = original.copy(action = "tool.completed", outcome = "COMPLETED", createdAt = 2)

        assertTrue(runCatching { dao.appendAudit(replacement) }.isFailure)
        assertEquals(listOf(original), dao.audit("alice", "ihep"))
    }

    @Test fun remote_cache_ttl_and_capacity_are_account_scoped() = runBlocking {
        val dao = database.remoteDao()
        repeat(5) { index ->
            dao.insertEvent(RemoteEventEntity("alice", "ihep", "rt", "ws", "s", "run", "event-$index",
                (index + 1).toLong(), "message.delta", "2026-01-0${index + 1}T00:00:00Z"))
        }
        dao.insertEvent(RemoteEventEntity("bob", "ihep", "rt", "ws", "s", "run", "event-bob", 1,
            "message.delta", "2025-01-01T00:00:00Z"))
        dao.saveApproval(PendingRemoteApprovalEntity("alice", "ihep", "rt", "ws", "s", "run", "approval",
            "shell.execute", "2026-01-01T00:00:00Z", 1))
        dao.saveCursor(RemoteEventCursorEntity("alice", "ihep", "rt", "run", "run", 5, "5", 1))

        RemoteCacheRepository(database).maintainAccount(
            "alice", "ihep", eventBeforeTimestamp = "2026-01-03T00:00:00Z", cursorBeforeMillis = 2, maxEvents = 2,
        )

        assertEquals(2, dao.eventCount("alice", "ihep"))
        assertEquals(1, dao.eventCount("bob", "ihep"))
        assertEquals(0, dao.approvalCount("alice", "ihep"))
        assertEquals(0, dao.cursorCount("alice", "ihep"))
    }

    @Test fun malformed_non_authoritative_projection_is_cleared_for_only_that_account() = runBlocking {
        val dao = database.remoteDao()
        dao.saveRuntimes(listOf(
            RemoteRuntimeEntity("alice", "ihep", "bad", "bad", "i", "1", "ONLINE", "[]", 1),
            RemoteRuntimeEntity("bob", "ihep", "good", "good", "i", "1", "ONLINE", "[]", 1),
        ))
        dao.saveRun(RemoteRunEntity("alice", "ihep", "/invalid", "ws", "s", "run", "opendrsai",
            "not-a-status", "OFFLINE", 0, 1))

        val recovered = RemoteProcessRecovery(database, RelayRemoteRepository("https://relay.invalid", { "token" }))
            .cached("alice", "ihep")

        assertTrue(recovered.isEmpty())
        assertTrue(dao.runtimes("alice", "ihep").isEmpty())
        assertEquals(listOf("bob"), dao.runtimes("bob", "ihep").map { it.subject })
    }

    @Test fun database_downgrade_is_rejected_without_destructive_fallback() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "future-v8.db"
        context.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name), null).use { it.version = 8 }
        val failure = runCatching {
            Room.databaseBuilder(context, ChatDatabase::class.java, name).allowMainThreadQueries().build().openHelper.writableDatabase
        }.exceptionOrNull()
        assertTrue(failure != null)
        context.deleteDatabase(name)
    }

    @Test fun identical_resource_ids_are_isolated_across_every_runtime_projection() = runBlocking {
        val dao = database.remoteDao()
        val subject = "alice"; val organization = "ihep"
        dao.saveWorkspaces(listOf(
            RemoteWorkspaceEntity(subject, organization, "rt-a", "same", "A", 1),
            RemoteWorkspaceEntity(subject, organization, "rt-b", "same", "B", 1),
        ))
        dao.saveSessions(listOf(
            RemoteSessionEntity(subject, organization, "rt-a", "same", "session", "Session A", "opendrsai", 1),
            RemoteSessionEntity(subject, organization, "rt-b", "same", "session", "Session B", "opendrsai", 1),
        ))
        dao.insertEvent(RemoteEventEntity(subject, organization, "rt-a", "same", "session", "run", "event", 1,
            "message.delta", "2026-01-01T00:00:00Z"))
        dao.insertEvent(RemoteEventEntity(subject, organization, "rt-b", "same", "session", "run", "event", 1,
            "message.delta", "2026-01-01T00:00:00Z"))
        dao.saveApproval(PendingRemoteApprovalEntity(subject, organization, "rt-a", "same", "session", "run", "approval",
            "shell.execute", "2026-01-01T00:00:00Z", 1))
        dao.saveApproval(PendingRemoteApprovalEntity(subject, organization, "rt-b", "same", "session", "run", "approval",
            "files.write", "2026-01-01T00:00:00Z", 1))

        assertEquals("A", dao.workspaces(subject, organization, "rt-a").single().displayName)
        assertEquals("B", dao.workspaces(subject, organization, "rt-b").single().displayName)
        assertEquals("Session A", dao.sessions(subject, organization, "rt-a", "same").single().title)
        assertEquals("Session B", dao.sessions(subject, organization, "rt-b", "same").single().title)
        assertEquals("rt-a", dao.event(subject, organization, "rt-a", "event")!!.runtimeId)
        assertEquals("rt-b", dao.event(subject, organization, "rt-b", "event")!!.runtimeId)
        assertEquals("shell.execute", dao.approvals(subject, organization, "rt-a").single().operation)
        assertEquals("files.write", dao.approvals(subject, organization, "rt-b").single().operation)
    }

    @Test fun remote_workspace_and_session_queries_only_return_active_lifecycle() = runBlocking {
        val dao = database.remoteDao()
        dao.saveWorkspaces(listOf(
            RemoteWorkspaceEntity("alice", "ihep", "rt", "active", "Active", 1, lifecycle = "active", revision = 2),
            RemoteWorkspaceEntity("alice", "ihep", "rt", "archived", "Archived", 1, lifecycle = "archived", revision = 3),
            RemoteWorkspaceEntity("alice", "ihep", "rt", "removed", "Removed", 1, lifecycle = "removed", revision = 4),
        ))
        dao.saveSessions(listOf(
            RemoteSessionEntity("alice", "ihep", "rt", "active", "s-active", "Active", "opendrsai", 1, lifecycle = "active"),
            RemoteSessionEntity("alice", "ihep", "rt", "active", "s-archived", "Archived", "opendrsai", 1, lifecycle = "archived"),
            RemoteSessionEntity("alice", "ihep", "rt", "active", "s-removed", "Removed", "opendrsai", 1, lifecycle = "removed"),
        ))

        assertEquals(listOf("active"), dao.workspaces("alice", "ihep", "rt").map { it.workspaceId })
        assertEquals(listOf("active", "archived", "removed"), dao.allWorkspaces("alice", "ihep", "rt").map { it.workspaceId })
        assertEquals(listOf("s-active"), dao.sessions("alice", "ihep", "rt", "active").map { it.sessionId })
        assertEquals(3, dao.allSessions("alice", "ihep", "rt", "active").size)
    }

    @Test fun migration_2_to_3_preserves_conversation_and_binds_local_agent() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "migration-v2-v3.db"
        context.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name), null).use { legacy ->
            legacy.execSQL("CREATE TABLE conversations (id TEXT NOT NULL, userId TEXT NOT NULL, title TEXT NOT NULL, agentId TEXT NOT NULL, modelId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(id))")
            legacy.execSQL("CREATE INDEX index_conversations_userId ON conversations(userId)")
            legacy.execSQL("CREATE TABLE messages (id TEXT NOT NULL, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolCallId TEXT, toolName TEXT, toolPayload TEXT, visible INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id), FOREIGN KEY(conversationId) REFERENCES conversations(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
            legacy.execSQL("CREATE INDEX index_messages_conversationId ON messages(conversationId)")
            legacy.execSQL("CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, userId TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL)")
            legacy.execSQL("CREATE INDEX index_memories_userId ON memories(userId)")
            legacy.execSQL("INSERT INTO conversations VALUES ('old','u1','旧会话','opendrsai-android','model',1,2)")
            legacy.version = 2
        }

        val migrated = Room.databaseBuilder(context, ChatDatabase::class.java, name)
            .addMigrations(MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
            .allowMainThreadQueries()
            .build()
        try {
            val row = migrated.dao().conversationSnapshot("u1").single()
            assertEquals("local:opendrsai", row.agentId)
            assertEquals("OpenDrSai", row.agentName)
            assertEquals("local", row.agentSource)
            val workspace = migrated.workbenchDao().workspaces("u1", "").single()
            assertEquals("android-local", workspace.runtimeId)
            assertEquals("LOCAL_DEVICE", workspace.authority)
            val session = migrated.workbenchDao().sessions("u1", "", "android-local", "local").single()
            assertEquals("old", session.sourceConversationId)
        } finally {
            migrated.close()
            context.deleteDatabase(name)
        }
    }

    @Test fun migration_3_to_4_preserves_messages_and_adds_attachments() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "migration-v3-v4.db"
        context.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name), null).use { legacy ->
            legacy.execSQL("PRAGMA foreign_keys=ON")
            legacy.execSQL("CREATE TABLE conversations (id TEXT NOT NULL, userId TEXT NOT NULL, title TEXT NOT NULL, agentId TEXT NOT NULL, agentName TEXT NOT NULL DEFAULT 'OpenDrSai', agentSource TEXT NOT NULL DEFAULT 'local', modelId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(id))")
            legacy.execSQL("CREATE INDEX index_conversations_userId ON conversations(userId)")
            legacy.execSQL("CREATE TABLE messages (id TEXT NOT NULL, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolCallId TEXT, toolName TEXT, toolPayload TEXT, visible INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id), FOREIGN KEY(conversationId) REFERENCES conversations(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
            legacy.execSQL("CREATE INDEX index_messages_conversationId ON messages(conversationId)")
            legacy.execSQL("CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, userId TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL)")
            legacy.execSQL("CREATE INDEX index_memories_userId ON memories(userId)")
            legacy.execSQL("CREATE TABLE agent_catalog (id TEXT NOT NULL, userId TEXT NOT NULL, platformId TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, available INTEGER NOT NULL, chatSupported INTEGER NOT NULL, isDefault INTEGER NOT NULL, owner TEXT, capabilitiesJson TEXT NOT NULL, logoUrl TEXT, examplesJson TEXT NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(id, userId))")
            legacy.execSQL("CREATE INDEX index_agent_catalog_userId ON agent_catalog(userId)")
            legacy.execSQL("INSERT INTO conversations VALUES ('c1','u1','会话','local:opendrsai','OpenDrSai','local','model',1,2)")
            legacy.execSQL("INSERT INTO messages VALUES ('m1','c1','user','hello',NULL,NULL,NULL,1,'complete',3)")
            legacy.version = 3
        }
        val migrated = Room.databaseBuilder(context, ChatDatabase::class.java, name)
            .addMigrations(MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8)
            .allowMainThreadQueries()
            .build()
        try {
            val dao = migrated.dao()
            assertEquals("hello", dao.visibleMessageSnapshot("c1").single().content)
            dao.saveAttachments(listOf(MessageAttachmentEntity("a1", "m1", "c1", null, "x.txt", "text/plain", 1, "file", null, null, "h")))
            assertEquals("x.txt", dao.attachmentSnapshot("c1").single().name)
        } finally {
            migrated.close()
            context.deleteDatabase(name)
        }
    }

    @Test fun unifiedWorkbenchSearchAndLocalSessionMutationsAreAccountScopedAndPersistent() = runBlocking {
        val aliceConversation = ConversationEntity("alice-session", "alice", "项目 100%", "local:opendrsai", modelId = "m", createdAt = 1, updatedAt = 2)
        val bobConversation = ConversationEntity("bob-session", "bob", "项目 secret", "local:opendrsai", modelId = "m", createdAt = 1, updatedAt = 2)
        database.dao().saveConversation(aliceConversation)
        database.dao().saveConversation(bobConversation)
        database.dao().saveMessage(MessageEntity("alice-message", "alice-session", "user", "特殊_文本", createdAt = 3))
        database.dao().saveMessage(MessageEntity("bob-message", "bob-session", "user", "特殊_文本", createdAt = 3))
        val projection = WorkbenchProjectionRepository(database.workbenchDao())
        projection.projectLocalConversation(aliceConversation)
        projection.projectLocalConversation(bobConversation)
        val repository = UnifiedWorkbenchRepository(database)

        assertEquals(listOf("alice-session"), repository.search("alice", "100%").sessions.map { it.sessionId })
        assertEquals(listOf("alice-message"), repository.search("alice", "特殊_").messages.map { it.id })
        assertEquals(SessionMutationResult.Applied, repository.rename("alice", "alice-session", "新标题", 4))
        assertEquals(SessionMutationResult.Applied, repository.setPinned("alice", "alice-session", true, 5))
        assertEquals(SessionMutationResult.Applied, repository.setUnread("alice", "alice-session", true))
        assertEquals("新标题", database.dao().conversationSnapshot("alice").single().title)
        assertTrue(database.workbenchDao().session("alice", "alice-session")!!.pinned)
        assertTrue(database.workbenchDao().session("alice", "alice-session")!!.unread)
        assertEquals(SessionMutationResult.Applied, repository.setArchived("alice", "alice-session", true, 6))
        assertTrue(database.workbenchDao().allSessions("alice").isEmpty())
        assertEquals(listOf("alice-session"), database.workbenchDao().allSessions("alice", archived = true).map { it.sessionId })

        database.workbenchDao().saveSessions(listOf(WorkbenchSessionEntity(
            "alice", "ihep", "remote", "workspace", "remote-session", "Remote", "opendrsai",
            "REMOTE_RUNTIME", null, false, false, false, 1,
        )))
        assertEquals(SessionMutationResult.RemoteAuthorityRequired, repository.rename("alice", "remote-session", "bad", 7))
    }
}
