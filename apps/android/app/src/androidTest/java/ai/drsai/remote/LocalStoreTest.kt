package ai.drsai.remote

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.MessageAttachmentEntity
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
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
import ai.drsai.remote.remote.data.RelayRemoteRepository
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
        dao.saveAttachments(listOf(MessageAttachmentEntity("a1", "m1", "c1", "att_1", "note.txt", "text/plain", 5, "file", null, null, "hash")))
        assertEquals(listOf("a1"), dao.attachmentSnapshot("c1").map { it.id })
        dao.saveMemory(MemoryEntity(userId = "u1", content = "green"))
        dao.saveMemory(MemoryEntity(userId = "u2", content = "blue"))

        assertEquals(listOf("c1"), dao.conversationSnapshot("u1").map { it.id })
        assertEquals(listOf("green"), dao.searchMemories("u1", "", 10).map { it.content })
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

    @Test fun remote_cache_is_account_scoped_and_logout_clear_preserves_other_account() = runBlocking {
        val dao = database.remoteDao()
        fun runtime(subject: String) = RemoteRuntimeEntity(subject, "ihep", "same-runtime", subject,
            "instance", "1", "ONLINE", "[]", 1, false)
        dao.saveRuntimes(listOf(runtime("alice"), runtime("bob")))
        RemoteCacheRepository(database).clearSubject("alice")
        assertTrue(dao.runtimes("alice", "ihep").isEmpty())
        assertEquals(listOf("bob"), dao.runtimes("bob", "ihep").map { it.subject })
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
        val name = "future-v6.db"
        context.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name), null).use { it.version = 6 }
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
            .addMigrations(MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
            .allowMainThreadQueries()
            .build()
        try {
            val row = migrated.dao().conversationSnapshot("u1").single()
            assertEquals("local:opendrsai", row.agentId)
            assertEquals("OpenDrSai", row.agentName)
            assertEquals("local", row.agentSource)
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
            .addMigrations(MIGRATION_3_4, MIGRATION_4_5)
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
}
