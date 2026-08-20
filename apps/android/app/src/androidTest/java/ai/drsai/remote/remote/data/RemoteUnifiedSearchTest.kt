package ai.drsai.remote.remote.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteUnifiedSearchTest {
    @Test fun searchesWorkspaceSessionAndCachedMessageWithSourceWithoutLeakingPaths() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java).build()
        try {
            val dao = db.remoteDao()
            dao.saveWorkspaces(listOf(RemoteWorkspaceEntity(
                "alice", "", "rt", "ws", "Research Project", 1L, true,
            )))
            dao.saveSessions(listOf(RemoteSessionEntity(
                "alice", "", "rt", "ws", "session", "Experiment Notes", "opendrsai", 1L, true,
            )))
            dao.saveOaepItems(listOf(RemoteOaepItemEntity(
                "alice", "", "rt", "ws", "session", "run", "item", "message", "completed",
                1, 1, "opendrsai", "android", null, "2026-08-04T00:00:00Z", "2026-08-04T00:00:00Z",
                "{\"text\":\"needle at C:/private/project\",\"role\":\"assistant\"}",
            )))
            val search = RemoteUnifiedSearch(db)
            assertEquals(RemoteSearchKind.WORKSPACE, search.cached("alice", "Research").single().kind)
            assertEquals(RemoteSearchKind.SESSION, search.cached("alice", "Experiment").single().kind)
            val message = search.cached("alice", "needle").single()
            assertEquals(RemoteSearchKind.MESSAGE, message.kind)
            assertEquals(RemoteSearchSource.CACHE, message.source)
            val serialized = listOf(message.title, message.kind.name, message.source.name).joinToString(" ")
            assertFalse(serialized.contains("C:/"))
            assertFalse(serialized.contains("/private/"))
        } finally {
            db.close()
        }
    }
}
