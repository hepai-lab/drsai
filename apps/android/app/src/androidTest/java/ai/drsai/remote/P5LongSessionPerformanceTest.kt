package ai.drsai.remote

import android.os.Build
import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.data.LatestFrameMailbox
import ai.drsai.remote.remote.data.RemoteCacheRepository
import ai.drsai.remote.remote.data.RemoteDeltaFrameBuffer
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSnapshotCheckpoint
import ai.drsai.remote.remote.generated.OaepSnapshotWindow
import ai.drsai.remote.remote.generated.OaepSource
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in, synthetic-content physical gate for P5-M06-F02/F03. */
@RunWith(AndroidJUnit4::class)
class P5LongSessionPerformanceTest {
    @Test
    fun physicalWindowedHistoryAndDeltaBackpressureMeetBudgets() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(
            "P5 long-session gate is opt-in",
            InstrumentationRegistry.getArguments().getString(ARG_ENABLE) == "true",
        )
        require(isPhysicalDevice()) { "p5_long_session_physical_device_required" }
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java)
            .allowMainThreadQueries().build()
        try {
            val store = RemoteCacheRepository(database)
            forceGc()
            val coldPssBeforeKb = Debug.getPss()
            val coldStarted = System.nanoTime()
            val leading = items((TOTAL_ITEMS - WINDOW_SIZE + 1L)..TOTAL_ITEMS.toLong())
            store.replaceOaepSnapshot(SUBJECT, "", RUNTIME, WORKSPACE, snapshot(leading, true), 1)
            val coldRows = store.oaepSessionItems(SUBJECT, "", RUNTIME, SESSION)
            val coldElapsedMs = elapsedMs(coldStarted)
            forceGc()
            val coldPssDeltaKb = (Debug.getPss() - coldPssBeforeKb).coerceAtLeast(0)
            assertEquals(WINDOW_SIZE, coldRows.size)
            assertEquals(TOTAL_ITEMS.toLong(), store.oaepSessionCursor(
                SUBJECT, "", RUNTIME, SESSION,
            )?.lastSequence)
            assertTrue("cold window took ${coldElapsedMs}ms", coldElapsedMs <= COLD_START_MAX_MS)
            assertTrue("cold window used ${coldPssDeltaKb}KiB", coldPssDeltaKb <= COLD_PSS_MAX_KB)

            val historyStarted = System.nanoTime()
            var pageEnd = TOTAL_ITEMS - WINDOW_SIZE
            while (pageEnd > 0) {
                val pageStart = (pageEnd - WINDOW_SIZE + 1).coerceAtLeast(1)
                store.mergeOaepSnapshotWindow(
                    SUBJECT, "", RUNTIME, WORKSPACE,
                    snapshot(items(pageStart.toLong()..pageEnd.toLong()), pageStart > 1),
                )
                pageEnd = pageStart - 1
            }
            val allRows = store.oaepSessionItems(SUBJECT, "", RUNTIME, SESSION)
            val historyElapsedMs = elapsedMs(historyStarted)
            assertEquals(TOTAL_ITEMS, allRows.size)
            val expectedHistoryHash = historyHash(1L..TOTAL_ITEMS.toLong())
            val actualHistoryHash = historyHash(allRows.map { it.itemSequence })
            assertEquals(expectedHistoryHash, actualHistoryHash)
            assertTrue("full history took ${historyElapsedMs}ms", historyElapsedMs <= HISTORY_MAX_MS)

            val delta = runDeltaGate()
            val report = JSONObject()
                .put("schema_version", SCHEMA_VERSION)
                .put("passed", true)
                .put("physical", true)
                .put("history", JSONObject()
                    .put("checkpoint_item_count", TOTAL_ITEMS)
                    .put("cold_window_items", coldRows.size)
                    .put("cold_start_ms", coldElapsedMs)
                    .put("cold_pss_delta_kb", coldPssDeltaKb)
                    .put("full_history_items", allRows.size)
                    .put("full_history_ms", historyElapsedMs)
                    .put("history_hash", actualHistoryHash))
                .put("delta", delta)
                .put("budgets", JSONObject()
                    .put("cold_start_max_ms", COLD_START_MAX_MS)
                    .put("cold_pss_max_kb", COLD_PSS_MAX_KB)
                    .put("history_max_ms", HISTORY_MAX_MS)
                    .put("delta_count", DELTA_COUNT)
                    .put("delta_duration_max_ms", DELTA_DURATION_MAX_MS)
                    .put("minimum_main_ticks", MINIMUM_MAIN_TICKS))
            val encodedReport = report.toString().toByteArray(Charsets.UTF_8)
            File(context.filesDir, DEVICE_REPORT).writeBytes(encodedReport)
            instrumentation.sendStatus(0, android.os.Bundle().apply {
                putString("p5LongSessionReportSha256", sha256(encodedReport))
                // This synthetic, content-free report must also be retrievable from a
                // non-debuggable release target where adb run-as is intentionally denied.
                putString("p5LongSessionReportBase64", Base64.encodeToString(encodedReport, Base64.NO_WRAP))
            })
        } finally {
            database.close()
        }
    }

    private fun runDeltaGate(): JSONObject {
        val buffer = RemoteDeltaFrameBuffer()
        val mailbox = LatestFrameMailbox<Int>()
        val running = AtomicBoolean(true)
        val mainTicks = AtomicInteger(0)
        val handler = Handler(Looper.getMainLooper())
        lateinit var ticker: Runnable
        ticker = Runnable {
            mainTicks.incrementAndGet()
            if (running.get()) handler.postDelayed(ticker, 16L)
        }
        handler.post(ticker)
        val digest = MessageDigest.getInstance("SHA-256")
        var workerStarts = 0
        var renderCycles = 0
        val started = System.nanoTime()
        val producer = thread(name = "p5-delta-producer") {
            repeat(DELTA_BATCHES) { batch ->
                repeat(DELTA_COUNT / DELTA_BATCHES) { index ->
                    buffer.offer(RUN, "x").forEach { digest.update(it.text.toByteArray()) }
                    if (mailbox.offer(batch * (DELTA_COUNT / DELTA_BATCHES) + index)) workerStarts += 1
                }
                mailbox.take()?.let { renderCycles += 1 }
                mailbox.finishCycle()
                Thread.sleep(DELTA_BATCH_INTERVAL_MS)
            }
            buffer.drain().forEach { digest.update(it.text.toByteArray()) }
        }
        producer.join(DELTA_DURATION_MAX_MS)
        running.set(false)
        handler.removeCallbacks(ticker)
        require(!producer.isAlive) { "p5_delta_gate_timeout" }
        val elapsed = elapsedMs(started)
        val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
        val expectedHash = sha256("x".repeat(DELTA_COUNT).toByteArray())
        require(actualHash == expectedHash) { "p5_delta_content_hash_mismatch" }
        require(buffer.sizeChars() == 0) { "p5_delta_buffer_not_drained" }
        require(elapsed <= DELTA_DURATION_MAX_MS) { "p5_delta_duration_budget_exceeded" }
        require(mainTicks.get() >= MINIMUM_MAIN_TICKS) { "p5_delta_main_responsiveness_failed" }
        // The producer intentionally yields once per 100 ms batch; rendering
        // must remain frame-bounded instead of creating one worker per delta.
        require(workerStarts <= DELTA_BATCHES) { "p5_delta_worker_amplification" }
        return JSONObject()
            .put("delta_count", DELTA_COUNT)
            .put("duration_ms", elapsed)
            .put("main_ticks", mainTicks.get())
            .put("worker_starts", workerStarts)
            .put("render_cycles", renderCycles)
            .put("content_hash", actualHash)
            .put("terminal_barrier_complete", true)
    }

    private fun snapshot(items: List<OaepItem>, hasMore: Boolean) = OaepSnapshot(
        "1.0", OaepSession(SESSION, WORKSPACE, "Synthetic", "active", "opendrsai", "now", "now"),
        listOf(OaepRun(RUN, SESSION, null, status = "completed", createdAt = "now",
            updatedAt = "now", completedAt = "now")),
        items, TOTAL_ITEMS.toLong(),
        OaepSnapshotCheckpoint(TOTAL_ITEMS.toLong(), "a".repeat(64), TOTAL_ITEMS.toLong()),
        OaepSnapshotWindow(WINDOW_SIZE, hasMore, if (hasMore) "opaque-synthetic-cursor" else null),
    )

    private fun items(range: LongRange) = range.map { sequence ->
        OaepItem(
            "item-$sequence", SESSION, RUN, "message", "completed", sequence,
            "now", "now", OaepSource("runtime", runtimeId = RUNTIME),
            OaepMessageContent("assistant", "x"),
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

    private fun forceGc() { repeat(2) { System.gc(); System.runFinalization() } }
    private fun elapsedMs(started: Long) = (System.nanoTime() - started) / 1_000_000L
    private fun sha256(value: ByteArray) = MessageDigest.getInstance("SHA-256")
        .digest(value).joinToString("") { "%02x".format(it) }

    companion object {
        private const val ARG_ENABLE = "runP5LongSessionPerformance"
        private const val SCHEMA_VERSION = "p5-long-session-physical/1"
        private const val DEVICE_REPORT = "p5-long-session-performance.json"
        private const val SUBJECT = "p5-synthetic-subject"
        private const val RUNTIME = "p5-synthetic-runtime"
        private const val WORKSPACE = "p5-synthetic-workspace"
        private const val SESSION = "p5-synthetic-session"
        private const val RUN = "p5-synthetic-run"
        private const val TOTAL_ITEMS = 100_000
        private const val WINDOW_SIZE = 500
        private const val COLD_START_MAX_MS = 3_000L
        private const val COLD_PSS_MAX_KB = 32 * 1024
        private const val HISTORY_MAX_MS = 180_000L
        private const val DELTA_COUNT = 10_000
        private const val DELTA_BATCHES = 10
        private const val DELTA_BATCH_INTERVAL_MS = 100L
        private const val DELTA_DURATION_MAX_MS = 5_000L
        private const val MINIMUM_MAIN_TICKS = 20
    }
}
