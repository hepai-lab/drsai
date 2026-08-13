package ai.drsai.remote

import android.os.Build
import android.util.Base64
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.data.EventDecision
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventData
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSnapshotCheckpoint
import ai.drsai.remote.remote.generated.OaepSnapshotWindow
import ai.drsai.remote.remote.generated.OaepSource
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Opt-in physical P6 capacity/recovery gate.
 *
 * Every phase runs in a separate instrumentation process and uses a dedicated Room database.
 * The host must run seed -> force-stop -> recover -> force-stop -> clear. No account, token,
 * user transcript, or production database is opened by this test.
 */
@RunWith(AndroidJUnit4::class)
class P6CapacityRecoveryPhysicalTest {
    @Test
    fun isolatedCapacityProjectionSurvivesProcessDeathAndGapRecovery() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(
            "P6 capacity recovery gate is opt-in",
            InstrumentationRegistry.getArguments().getString(ARG_ENABLE) == "true",
        )
        require(isPhysicalDevice()) { "p6_capacity_recovery_physical_device_required" }
        val phase = InstrumentationRegistry.getArguments().getString(ARG_PHASE)
            ?: error("p6_capacity_recovery_phase_required")
        val context = instrumentation.targetContext

        val report = when (phase) {
            PHASE_SEED -> {
                context.deleteDatabase(DATABASE_NAME)
                withDatabase(context) { database -> seed(RemoteCacheRepository(database)) }
            }
            PHASE_RECOVER -> withDatabase(context) { database ->
                recover(RemoteCacheRepository(database))
            }
            PHASE_CLEAR -> {
                val deleted = context.deleteDatabase(DATABASE_NAME)
                check(context.databaseList().none { it == DATABASE_NAME }) {
                    "p6_capacity_recovery_cleanup_failed"
                }
                JSONObject().put("phase", phase).put("database_deleted", deleted)
            }
            else -> error("p6_capacity_recovery_phase_invalid")
        }.put("schema_version", SCHEMA_VERSION)
            .put("passed", true)
            .put("physical", true)
            .put("synthetic", true)

        val bytes = report.toString().toByteArray(Charsets.UTF_8)
        instrumentation.sendStatus(0, android.os.Bundle().apply {
            putString("p6CapacityRecoveryPhase", phase)
            putString("p6CapacityRecoveryReportSha256", sha256(bytes))
            putString(
                "p6CapacityRecoveryReportBase64",
                Base64.encodeToString(bytes, Base64.NO_WRAP),
            )
        })
    }

    private suspend fun seed(store: RemoteCacheRepository): JSONObject {
        val started = System.nanoTime()
        val leading = items((TOTAL_ITEMS - WINDOW_SIZE + 1L)..TOTAL_ITEMS.toLong())
        store.replaceOaepSnapshot(
            SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE,
            snapshot(leading, TOTAL_ITEMS.toLong(), true),
            1L,
        )
        var pageEnd = TOTAL_ITEMS - WINDOW_SIZE
        while (pageEnd > 0) {
            val pageStart = (pageEnd - WINDOW_SIZE + 1).coerceAtLeast(1)
            store.mergeOaepSnapshotWindow(
                SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE,
                snapshot(
                    items(pageStart.toLong()..pageEnd.toLong()),
                    TOTAL_ITEMS.toLong(),
                    pageStart > 1,
                ),
            )
            pageEnd = pageStart - 1
        }
        val rows = store.oaepSessionItems(SUBJECT, ORGANIZATION, RUNTIME, SESSION)
        assertEquals(TOTAL_ITEMS, rows.size)
        val expectedSequences = (1L..TOTAL_ITEMS.toLong()).toList()
        val actualSequences = rows.map { it.itemSequence }.sorted()
        assertEquals(expectedSequences, actualSequences)
        val seedHash = historyHash(expectedSequences)
        assertEquals(seedHash, historyHash(actualSequences))
        assertTerminalApproval(rows)
        assertEquals(
            TOTAL_ITEMS.toLong(),
            store.oaepSessionCursor(SUBJECT, ORGANIZATION, RUNTIME, SESSION)?.lastSequence,
        )
        return JSONObject()
            .put("phase", PHASE_SEED)
            .put("item_count", rows.size)
            .put("cursor", TOTAL_ITEMS)
            .put("history_hash", seedHash)
            .put("terminal_approval_visible", true)
            .put("elapsed_ms", elapsedMs(started))
    }

    private suspend fun recover(store: RemoteCacheRepository): JSONObject {
        val started = System.nanoTime()
        val restored = store.oaepSessionItems(SUBJECT, ORGANIZATION, RUNTIME, SESSION)
        assertEquals(TOTAL_ITEMS, restored.size)
        val expectedSequences = (1L..TOTAL_ITEMS.toLong()).toList()
        val restoredSequences = restored.map { it.itemSequence }.sorted()
        assertEquals(expectedSequences, restoredSequences)
        val restoredHash = historyHash(restoredSequences)
        assertEquals(historyHash(expectedSequences), restoredHash)
        assertTerminalApproval(restored)
        assertEquals(
            listOf("item-$OFFLINE_SEARCH_SEQUENCE"),
            store.searchCachedOaepItems(
                SUBJECT, ORGANIZATION, RUNTIME, SESSION, OFFLINE_SEARCH_QUERY,
            ).map { it.itemId },
        )

        assertEquals(EventDecision.APPLY, store.applyOaepEvent(
            SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE, SESSION,
            event(TOTAL_ITEMS + 1L), 2L,
        ))
        assertEquals(EventDecision.GAP, store.applyOaepEvent(
            SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE, SESSION,
            event(TOTAL_ITEMS + 3L), 3L,
        ))
        assertEquals(
            TOTAL_ITEMS + 1L,
            store.oaepSessionCursor(SUBJECT, ORGANIZATION, RUNTIME, SESSION)?.lastSequence,
        )

        // A cursor-expired client first replaces the authoritative leading Snapshot at the
        // recovered waterline, then exclusively replays events after that cursor.
        store.replaceOaepSnapshot(
            SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE,
            snapshot(items(99_503L..100_002L), TOTAL_ITEMS + 2L, true),
            4L,
        )
        assertEquals(EventDecision.APPLY, store.applyOaepEvent(
            SUBJECT, ORGANIZATION, RUNTIME, WORKSPACE, SESSION,
            event(TOTAL_ITEMS + 3L), 5L,
        ))
        val recovered = store.oaepSessionItems(SUBJECT, ORGANIZATION, RUNTIME, SESSION)
        assertEquals(TOTAL_ITEMS + 3, recovered.size)
        assertTerminalApproval(recovered)
        assertEquals(
            TOTAL_ITEMS + 3L,
            store.oaepSessionCursor(SUBJECT, ORGANIZATION, RUNTIME, SESSION)?.lastSequence,
        )
        return JSONObject()
            .put("phase", PHASE_RECOVER)
            .put("restored_item_count", restored.size)
            .put("restored_history_hash", restoredHash)
            .put("offline_search_matches", 1)
            .put("gap_detected_without_cursor_advance", true)
            .put("snapshot_then_cursor_replay", true)
            .put("final_item_count", recovered.size)
            .put("final_cursor", TOTAL_ITEMS + 3L)
            .put("terminal_approval_visible", true)
            .put("elapsed_ms", elapsedMs(started))
    }

    private fun openDatabase(context: android.content.Context) =
        Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE_NAME).build()

    private suspend fun <T> withDatabase(
        context: android.content.Context,
        block: suspend (ChatDatabase) -> T,
    ): T {
        val database = openDatabase(context)
        return try {
            block(database)
        } finally {
            database.close()
        }
    }

    private fun snapshot(items: List<OaepItem>, sequence: Long, hasMore: Boolean) = OaepSnapshot(
        "1.0",
        OaepSession(SESSION, WORKSPACE, "Synthetic", "active", "opendrsai", "now", "now"),
        listOf(OaepRun(
            RUN, SESSION, null, status = "completed", createdAt = "now",
            updatedAt = "now", completedAt = "now",
        )),
        items,
        sequence,
        OaepSnapshotCheckpoint(sequence, "a".repeat(64), sequence),
        OaepSnapshotWindow(WINDOW_SIZE, hasMore, if (hasMore) "opaque-p6-cursor" else null),
    )

    private fun items(range: LongRange) = range.map(::item)

    private fun item(sequence: Long): OaepItem {
        val terminal = sequence == TERMINAL_APPROVAL_SEQUENCE
        return OaepItem(
            "item-$sequence", SESSION, RUN,
            if (terminal) "interaction" else "message",
            "completed", sequence, "now", "now",
            OaepSource("runtime", runtimeId = RUNTIME),
            if (terminal) OaepInteractionContent(
                interactionType = "approval",
                prompt = "synthetic",
                options = listOf(mapOf("decision" to "approved")),
                approvalId = "synthetic-approval",
                response = mapOf("decision" to "approved"),
            ) else OaepMessageContent(
                "assistant",
                if (sequence == OFFLINE_SEARCH_SEQUENCE) OFFLINE_SEARCH_QUERY else "x",
            ),
        )
    }

    private fun event(sequence: Long) = OaepEvent(
        "1.0", "event-$sequence", SESSION, RUN, "item-$sequence", sequence,
        "event.item.completed", "later", "event-$sequence",
        OaepSource("runtime", runtimeId = RUNTIME),
        OaepEventData(item = item(sequence)),
    )

    private fun assertTerminalApproval(rows: List<ai.drsai.remote.remote.data.RemoteOaepItemEntity>) {
        val terminal = rows.single { it.itemId == "item-$TERMINAL_APPROVAL_SEQUENCE" }
        assertEquals("interaction", terminal.type)
        assertEquals("completed", terminal.status)
        assertEquals(
            "approved",
            JSONObject(terminal.contentJson).getJSONObject("response").getString("decision"),
        )
    }

    private fun historyHash(sequences: Iterable<Long>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        sequences.forEach { sequence -> digest.update("item-$sequence\u0000$sequence\n".toByteArray()) }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun isPhysicalDevice(): Boolean {
        val fingerprint = Build.FINGERPRINT.lowercase()
        val model = Build.MODEL.lowercase()
        val product = Build.PRODUCT.lowercase()
        val hardware = Build.HARDWARE.lowercase()
        return !fingerprint.startsWith("generic") && !fingerprint.contains("emulator") &&
            !model.contains("google_sdk") && !model.contains("emulator") &&
            !product.contains("sdk") && hardware !in setOf("goldfish", "ranchu", "vbox86")
    }

    private fun elapsedMs(started: Long) = (System.nanoTime() - started) / 1_000_000L
    private fun sha256(value: ByteArray) = MessageDigest.getInstance("SHA-256")
        .digest(value).joinToString("") { "%02x".format(it) }

    companion object {
        private const val ARG_ENABLE = "runP6CapacityRecovery"
        private const val ARG_PHASE = "p6CapacityPhase"
        private const val PHASE_SEED = "seed"
        private const val PHASE_RECOVER = "recover"
        private const val PHASE_CLEAR = "clear"
        private const val SCHEMA_VERSION = "p6-capacity-recovery-physical/1"
        private const val DATABASE_NAME = "p6-capacity-recovery.db"
        private const val SUBJECT = "p6-synthetic-subject"
        private const val ORGANIZATION = ""
        private const val RUNTIME = "p6-synthetic-runtime"
        private const val WORKSPACE = "p6-synthetic-workspace"
        private const val SESSION = "p6-synthetic-session"
        private const val RUN = "p6-synthetic-run"
        private const val TOTAL_ITEMS = 100_000
        private const val WINDOW_SIZE = 500
        private const val TERMINAL_APPROVAL_SEQUENCE = 100_000L
        private const val OFFLINE_SEARCH_SEQUENCE = 100L
        private const val OFFLINE_SEARCH_QUERY = "physical 100%_offline"
    }
}
