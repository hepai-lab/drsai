package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.MessageEntity
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
        dao.saveConversation(ConversationEntity("c1", "u1", "One", "agent", "model", 1, 1))
        dao.saveConversation(ConversationEntity("c2", "u2", "Two", "agent", "model", 2, 2))
        dao.saveMessage(MessageEntity("m1", "c1", "user", "hello"))
        dao.saveMemory(MemoryEntity(userId = "u1", content = "green"))
        dao.saveMemory(MemoryEntity(userId = "u2", content = "blue"))

        assertEquals(listOf("c1"), dao.conversationSnapshot("u1").map { it.id })
        assertEquals(listOf("green"), dao.searchMemories("u1", "", 10).map { it.content })
        dao.deleteConversation("c1")
        assertTrue(dao.runtimeMessageSnapshot("c1").isEmpty())
    }
}
