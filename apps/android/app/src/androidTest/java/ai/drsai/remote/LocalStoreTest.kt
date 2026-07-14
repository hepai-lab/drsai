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
import ai.drsai.remote.data.MIGRATION_2_3
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
        dao.saveMemory(MemoryEntity(userId = "u1", content = "green"))
        dao.saveMemory(MemoryEntity(userId = "u2", content = "blue"))

        assertEquals(listOf("c1"), dao.conversationSnapshot("u1").map { it.id })
        assertEquals(listOf("green"), dao.searchMemories("u1", "", 10).map { it.content })
        dao.deleteConversation("c1")
        assertTrue(dao.runtimeMessageSnapshot("c1").isEmpty())
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
            .addMigrations(MIGRATION_2_3)
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
}
