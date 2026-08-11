package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.runtime.python.MemoryCandidateEnvelope
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MemoryDataLifecycleInstrumentedTest {
    @Test fun legacyRowsRemainReadableMigrationIsIdempotentAndDeletionCannotRecall() {
        runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "p9-memory-lifecycle.db"
        context.deleteDatabase(name)
        var database = Room.databaseBuilder(context, ChatDatabase::class.java, name).build()
        val aliceId = database.dao().saveMemory(MemoryEntity(userId = "alice", content = "prefers concise answers"))
        database.dao().saveMemory(MemoryEntity(userId = "bob", content = "prefers detailed answers"))
        val first = MemoryCandidateEnvelope.from("alice", true, database.dao().memorySnapshot("alice"))
        val second = MemoryCandidateEnvelope.from("alice", true, database.dao().memorySnapshot("alice"))
        assertEquals(first.toString(), second.toString())
        database.close()

        database = Room.databaseBuilder(context, ChatDatabase::class.java, name).build()
        assertEquals("prefers concise answers", database.dao().memorySnapshot("alice").single().content)
        assertEquals(1, database.dao().deleteMemory("alice", aliceId))
        assertEquals(0, MemoryCandidateEnvelope.from("alice", true, database.dao().memorySnapshot("alice")).length())
        assertEquals("prefers detailed answers", database.dao().memorySnapshot("bob").single().content)
        assertEquals(1, database.dao().deleteMemories("bob"))
        assertEquals(0, database.dao().memorySnapshot("bob").size)
        database.close()
        context.deleteDatabase(name)
        }
    }
}
