package ai.drsai.remote

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.data.EventDecision
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteDeliveryState
import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import ai.drsai.remote.remote.generated.GeneratedSessionEvent
import ai.drsai.remote.remote.generated.OaepDelta
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventData
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSnapshotCheckpoint
import ai.drsai.remote.remote.generated.OaepSnapshotWindow
import ai.drsai.remote.remote.generated.OaepSource
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

class RemoteSessionSyncStoreTest {
    private var database: ChatDatabase? = null
    private lateinit var store: RemoteCacheRepository

    @Before
    fun createDatabase() {
        val db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
        database = db
        store = RemoteCacheRepository(db)
    }

    @After
    fun closeDatabase() {
        database?.close()
    }

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

    @Test
    fun oaep_snapshot_event_and_cursor_commit_in_one_transaction() = runTest {
        val initial = oaepMessageItem("running")
        store.saveOptimisticOaepMessage(
            "user", "", "rt", "ws", "session", "source-1", "hello", 0,
        )
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now"),
                listOf(OaepRun(
                    id = "run-1", sessionId = "session", parentRunId = null,
                    status = "running", createdAt = "now", updatedAt = "now",
                    completedAt = null,
                )),
                listOf(initial), 3,
            ),
            1,
        )
        assertEquals(3, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)
        assertEquals("running", store.oaepSessionItems("user", "", "rt", "session").single().status)
        assertFalse(store.oaepSessionItems("user", "", "rt", "session").single().optimistic)

        val completed = initial.copy(status = "completed", updatedAt = "later")
        val event = OaepEvent(
            "1.0", "event-4", "session", "run-1", "item-1", 4,
            "event.item.completed", "later", "event-4",
            OaepSource("runtime", runtimeId = "rt"), OaepEventData(item = completed),
        )
        assertEquals(EventDecision.APPLY, store.applyOaepEvent(
            "user", "", "rt", "ws", "session", event, 2,
        ))
        assertEquals(4, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)
        assertEquals("completed", store.oaepSessionItems("user", "", "rt", "session").single().status)
        assertEquals(EventDecision.DUPLICATE, store.applyOaepEvent(
            "user", "", "rt", "ws", "session", event, 3,
        ))
        assertEquals(EventDecision.GAP, store.applyOaepEvent(
            "user", "", "rt", "ws", "session",
            event.copy(eventId = "event-6", sequence = 6, dedupeKey = "event-6"), 4,
        ))
        assertEquals(4, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun optimistic_delivery_state_never_regresses_under_out_of_order_callbacks() = runTest {
        store.saveOptimisticOaepMessage(
            "user", "", "rt", "ws", "session", "source-1", "hello", 1,
        )
        suspend fun mark(state: RemoteDeliveryState, at: Long) = store.markOptimisticOaepDelivery(
            "user", "", "rt", "session", "source-1", state, at,
        )
        suspend fun state() = org.json.JSONObject(
            store.oaepSessionItems("user", "", "rt", "session").single().contentJson,
        ).getString("delivery_state")

        mark(RemoteDeliveryState.SENDING, 2)
        mark(RemoteDeliveryState.ACCEPTED, 3)
        mark(RemoteDeliveryState.SENDING, 4) // late request-start callback
        mark(RemoteDeliveryState.UNCERTAIN, 5) // late transport failure
        assertEquals("accepted", state())

        mark(RemoteDeliveryState.RUNNING, 6)
        mark(RemoteDeliveryState.ACCEPTED, 7) // late HTTP response
        assertEquals("running", state())
        mark(RemoteDeliveryState.COMPLETED, 8)
        mark(RemoteDeliveryState.FAILED, 9) // stale failure must not replace terminal truth
        assertEquals("completed", state())
    }

    @Test
    fun oaep_older_snapshot_window_merges_without_replacing_newer_items_or_cursor() = runTest {
        val session = OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now")
        val run = OaepRun(
            id = "run-1", sessionId = "session", parentRunId = null,
            status = "completed", createdAt = "now", updatedAt = "now", completedAt = "now",
        )
        val checkpoint = OaepSnapshotCheckpoint(30, "a".repeat(64), 2)
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run), listOf(oaepMessageItem("completed")), 30,
                checkpoint, OaepSnapshotWindow(1, true, "older-page"),
            ),
            1,
        )
        val older = oaepMessageItem("completed").copy(
            id = "item-older", sequence = 0, createdAt = "before", updatedAt = "before",
            source = OaepSource(
                "runtime", client = "android", messageId = "source-older", runtimeId = "rt",
            ),
        )
        store.mergeOaepSnapshotWindow(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run), listOf(older), 30,
                checkpoint, OaepSnapshotWindow(1, false, null),
            ),
        )

        assertEquals(
            setOf("item-1", "item-older"),
            store.oaepSessionItems("user", "", "rt", "session").map { it.itemId }.toSet(),
        )
        assertEquals(30, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun refreshed_leading_window_preserves_loaded_history_but_full_snapshot_replaces_it() = runTest {
        val session = OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now")
        val run = OaepRun(
            id = "run-1", sessionId = "session", parentRunId = null,
            status = "running", createdAt = "now", updatedAt = "now", completedAt = null,
        )
        fun checkpoint(sequence: Long, count: Long) = OaepSnapshotCheckpoint(
            sequence, sequence.toString().padStart(64, 'a').takeLast(64), count,
        )
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run), listOf(oaepMessageItem("running")), 30,
                checkpoint(30, 2), OaepSnapshotWindow(1, true, "older-page"),
            ),
            1,
        )
        val older = oaepMessageItem("completed").copy(
            id = "item-older", sequence = 0, createdAt = "before", updatedAt = "before",
            source = OaepSource("runtime", runtimeId = "rt"),
        )
        store.mergeOaepSnapshotWindow(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run), listOf(older), 30,
                checkpoint(30, 2), OaepSnapshotWindow(1, false, null),
            ),
        )

        val refreshed = oaepMessageItem("completed").copy(updatedAt = "later")
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run.copy(status = "completed")), listOf(refreshed), 31,
                checkpoint(31, 2), OaepSnapshotWindow(1, true, "older-page-2"),
            ),
            2,
        )
        assertEquals(
            setOf("item-1", "item-older"),
            store.oaepSessionItems("user", "", "rt", "session").map { it.itemId }.toSet(),
        )
        assertEquals(31, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)

        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", session, listOf(run), listOf(refreshed), 32,
                checkpoint = null, window = null,
            ),
            3,
        )
        assertEquals(
            listOf("item-1"),
            store.oaepSessionItems("user", "", "rt", "session").map { it.itemId },
        )
    }

    @Test
    fun capacity_trim_is_rebuilt_from_full_snapshot_and_account_clear_is_complete() = runTest {
        val session = OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now")
        val run = OaepRun(
            id = "run-1", sessionId = "session", parentRunId = null,
            status = "completed", createdAt = "now", updatedAt = "now", completedAt = "now",
        )
        val items = (1L..5L).map { sequence ->
            oaepMessageItem("completed").copy(
                id = "item-$sequence", sequence = sequence,
                source = OaepSource("runtime", runtimeId = "rt"),
            )
        }
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot("1.0", session, listOf(run), items, 5, checkpoint = null, window = null),
            1,
        )
        store.maintainAccountIfDue(
            "user", "", nowMillis = 2_000_000_000_000,
            intervalMillis = 1, maxEvents = 0, maxTerminalItems = 2,
        )
        assertEquals(2, store.oaepSessionItems("user", "", "rt", "session").size)

        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot("1.0", session, listOf(run), items, 6, checkpoint = null, window = null),
            2,
        )
        assertEquals(5, store.oaepSessionItems("user", "", "rt", "session").size)
        store.clearAccount("user", "")
        assertEquals(0, store.oaepSessionItems("user", "", "rt", "session").size)
        assertEquals(null, store.oaepSessionCursor("user", "", "rt", "session"))
    }

    @Test
    fun oaep_delta_event_updates_cached_item_before_stream_snapshot_reload() = runTest {
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now"),
                listOf(OaepRun(
                    id = "run-1", sessionId = "session", parentRunId = null,
                    status = "running", createdAt = "now", updatedAt = "now",
                    completedAt = null,
                )),
                listOf(oaepMessageItem("running")), 1,
            ),
            1,
        )
        val event = OaepEvent(
            "1.0", "event-2", "session", "run-1", "item-1", 2,
            "event.item.delta", "later", "event-2",
            OaepSource("runtime", runtimeId = "rt"),
            OaepEventData(delta = OaepDelta("message.text.append", " world")),
        )

        assertEquals(EventDecision.APPLY, store.applyOaepEvent(
            "user", "", "rt", "ws", "session", event, 2,
        ))

        val item = store.oaepSessionItems("user", "", "rt", "session").single()
        assertEquals(2, item.latestEventSequence)
        assertEquals("later", item.updatedAt)
        assertEquals("hello world", org.json.JSONObject(item.contentJson).getString("text"))
        assertEquals(2, store.oaepSessionCursor("user", "", "rt", "session")!!.lastSequence)
    }

    @Test
    fun oaep_plan_delta_event_updates_cached_plan_text() = runTest {
        store.replaceOaepSnapshot(
            "user", "", "rt", "ws",
            OaepSnapshot(
                "1.0", OaepSession("session", "ws", "T", "active", "opendrsai", "now", "now"),
                listOf(OaepRun(
                    id = "run-1", sessionId = "session", parentRunId = null,
                    status = "running", createdAt = "now", updatedAt = "now",
                    completedAt = null,
                )),
                listOf(oaepPlanItem("running")), 1,
            ),
            1,
        )
        val event = OaepEvent(
            "1.0", "event-2", "session", "run-1", "item-plan", 2,
            "event.item.delta", "later", "event-2",
            OaepSource("runtime", runtimeId = "rt"),
            OaepEventData(delta = OaepDelta("plan.text.append", "second step")),
        )

        assertEquals(EventDecision.APPLY, store.applyOaepEvent(
            "user", "", "rt", "ws", "session", event, 2,
        ))

        val item = store.oaepSessionItems("user", "", "rt", "session").single()
        assertEquals(2, item.latestEventSequence)
        assertEquals("first step\nsecond step", org.json.JSONObject(item.contentJson).getString("text"))
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

    private fun oaepMessageItem(status: String) = OaepItem(
        "item-1", "session", "run-1", "message", status, 1, "now", "now",
        OaepSource("runtime", client = "android", messageId = "source-1", runtimeId = "rt"),
        OaepMessageContent("user", "hello"),
    )

    private fun oaepPlanItem(status: String) = OaepItem(
        "item-plan", "session", "run-1", "plan", status, 1, "now", "now",
        OaepSource("runtime", runtimeId = "rt"),
        OaepPlanContent("first step\n", emptyList()),
    )
}
