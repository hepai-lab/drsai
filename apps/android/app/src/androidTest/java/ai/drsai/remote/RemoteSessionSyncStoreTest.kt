package ai.drsai.remote

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.data.EventDecision
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

class RemoteSessionSyncStoreTest {
    private lateinit var database: ChatDatabase
    private lateinit var store: RemoteCacheRepository

    @Before
    fun createDatabase() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
        store = RemoteCacheRepository(database)
    }

    @After
    fun closeDatabase() = database.close()

    @Test
    fun snapshot_atomically_saves_items_and_cursor_and_merges_optimistic_message() = runTest {
        store.saveOptimisticMessage("user", "", "rt", "ws", "session", "source-1", "hello", 1)
        store.replaceSessionSnapshot(
            "user", "", "rt", "ws",
            snapshot(3, listOf(item("item-1", 1, "source-1"))),
            2,
        )

        val rows = store.sessionItems("user", "", "rt", "session")
        assertEquals(listOf("item-1"), rows.map { it.itemId })
        assertFalse(rows.single().optimistic)
        assertEquals(3, store.sessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun gap_and_invalid_snapshot_never_advance_committed_cursor() = runTest {
        store.replaceSessionSnapshot("user", "", "rt", "ws", snapshot(3, emptyList()), 1)
        assertEquals(
            EventDecision.GAP,
            store.applySessionEvent(
                "user", "", "rt", "ws", "session", event(5, "event-5"), 2,
            ),
        )
        assertEquals(3, store.sessionCursor("user", "", "rt", "session")!!.lastSequence)

        val invalid = runCatching {
            store.replaceSessionSnapshot(
                "user", "", "rt", "ws",
                GeneratedConversationSnapshot("session", 8, listOf(item("bad", 8).copy(sessionId = "other")), null),
                3,
            )
        }
        assertEquals("remote_session_scope_mismatch", invalid.exceptionOrNull()?.message)
        assertEquals(3, store.sessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun stale_snapshot_cannot_regress_committed_session_cursor() = runTest {
        store.replaceSessionSnapshot("user", "", "rt", "ws", snapshot(3, emptyList()), 1)
        store.applySessionEvent("user", "", "rt", "ws", "session", event(4, "event-4"), 2)

        val stale = runCatching {
            store.replaceSessionSnapshot("user", "", "rt", "ws", snapshot(3, emptyList()), 3)
        }

        assertEquals("remote_session_snapshot_sequence_regression", stale.exceptionOrNull()?.message)
        assertEquals(4, store.sessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun duplicate_is_idempotent_and_event_id_collision_fails_closed() = runTest {
        store.replaceSessionSnapshot("user", "", "rt", "ws", snapshot(3, emptyList()), 1)
        assertEquals(
            EventDecision.APPLY,
            store.applySessionEvent("user", "", "rt", "ws", "session", event(4, "event-4"), 2),
        )
        assertEquals(
            EventDecision.DUPLICATE,
            store.applySessionEvent("user", "", "rt", "ws", "session", event(4, "event-4"), 3),
        )
        val collision = runCatching {
            store.applySessionEvent("user", "", "rt", "ws", "session", event(5, "event-4"), 4)
        }
        assertEquals("remote_session_event_id_collision", collision.exceptionOrNull()?.message)
        assertEquals(4, store.sessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    private fun snapshot(sequence: Long, items: List<GeneratedSessionConversationItem>) =
        GeneratedConversationSnapshot("session", sequence, items, null)

    private fun item(
        id: String,
        sequence: Long,
        sourceMessageId: String? = null,
    ) = GeneratedSessionConversationItem(
        id, "session", "run-1", "message", "user", 1, sequence,
        "android", sourceMessageId, "now", "now", mapOf("text" to "hello"),
    )

    private fun event(sequence: Long, id: String) = GeneratedSessionEvent(
        id, "rt", "ws", "session", "run-2", sequence,
        "run.created", "now", emptyMap(),
    )
}
