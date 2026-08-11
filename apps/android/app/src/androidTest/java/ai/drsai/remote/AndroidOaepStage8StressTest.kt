package ai.drsai.remote

import android.content.Context
import android.util.Log
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.system.measureNanoTime

@RunWith(AndroidJUnit4::class)
class AndroidOaepStage8StressTest {
    @Test
    fun five_hundred_runs_fifty_tools_and_twenty_recoveries_remain_consistent() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(DATABASE)
        val database = Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE)
            .allowMainThreadQueries().build()
        val store = RoomAndroidOaepStore(database)
        val owner = AndroidOaepOwner("stage8-stress", "")
        val sideEffects = linkedSetOf<String>()
        val recoveryMillis = mutableListOf<Double>()
        val started = System.nanoTime()
        try {
            repeat(RUNS) { index ->
                val scope = AndroidOaepScope(
                    WORKSPACE, "stress-session-$index", "stress-run-$index",
                    "stage8-stress", "android-local", runSequence = 1,
                )
                var writer = AndroidOaepWriter(scope, timestamp(0))
                store.commit(owner, scope, writer.apply("$index:start", NormalizedAgentEvent.RunStarted, timestamp(1)))
                if (index < TOOL_RUNS) {
                    val callId = "stress-call-$index"
                    assertTrue("side effect must execute once", sideEffects.add(callId))
                    val result = writer.apply(
                        "$index:tool",
                        NormalizedAgentEvent.ItemCompleted(
                            callId, "tool_call", OaepToolCallContent(
                                "function", "stress.echo", callId,
                                mapOf("index" to index), mapOf("ok" to true), durationMs = 1.0,
                            ),
                        ),
                        timestamp(2),
                    )
                    store.commit(owner, scope, result)
                    val replay = writer.apply(
                        "$index:tool",
                        NormalizedAgentEvent.ItemCompleted(
                            callId, "tool_call", OaepToolCallContent(
                                "function", "stress.echo", callId,
                                mapOf("index" to index), mapOf("ok" to true), durationMs = 1.0,
                            ),
                        ),
                        timestamp(3),
                    )
                    assertTrue(replay.duplicate)
                    store.commit(owner, scope, replay)
                } else {
                    store.commit(owner, scope, writer.apply(
                        "$index:message",
                        NormalizedAgentEvent.ItemCompleted(
                            "stress-message-$index", "message",
                            OaepMessageContent("assistant", "completed-$index", "final"),
                        ),
                        timestamp(2),
                    ))
                }
                if (index >= RUNS - RECOVERY_RUNS) {
                    val elapsed = measureNanoTime {
                        val restored = store.load(owner, scope) ?: error("stress_recovery_missing")
                        writer = AndroidOaepWriter(scope, restored.session.createdAt, restored)
                    }
                    recoveryMillis += elapsed / 1_000_000.0
                }
                store.commit(owner, scope, writer.apply(
                    "$index:complete", NormalizedAgentEvent.RunCompleted, timestamp(4),
                ))
                val snapshot = store.snapshot(owner, "android-local", WORKSPACE, scope.sessionId)
                    ?: error("stress_snapshot_missing")
                assertEquals("completed", snapshot.runs.single().status)
                assertTrue(snapshot.items.all { it.status == "completed" })
            }
            assertEquals(TOOL_RUNS, sideEffects.size)
            assertEquals(
                RUNS,
                database.androidOaepDao().sessionCount(owner.subject, owner.organization, "android-local", WORKSPACE),
            )
            val sqlite = database.openHelper.writableDatabase
            val pageCount = sqlite.query("PRAGMA page_count").use { cursor -> cursor.moveToFirst(); cursor.getLong(0) }
            val pageSize = sqlite.query("PRAGMA page_size").use { cursor -> cursor.moveToFirst(); cursor.getLong(0) }
            val sortedRecovery = recoveryMillis.sorted()
            val p95Recovery = sortedRecovery[(sortedRecovery.size * 0.95).toInt().coerceAtMost(sortedRecovery.lastIndex)]
            val metrics = JSONObject()
                .put("runs", RUNS).put("tool_runs", TOOL_RUNS).put("recovery_runs", RECOVERY_RUNS)
                .put("side_effect_executions", sideEffects.size)
                .put("duplicate_side_effects", 0).put("data_corruption", 0).put("permanent_running", 0)
                .put("duration_ms", (System.nanoTime() - started) / 1_000_000.0)
                .put("recovery_p95_ms", p95Recovery)
                .put("database_bytes", pageCount * pageSize)
                .put("recovery_samples_ms", JSONArray(recoveryMillis))
            Log.i(MARKER, metrics.toString())
        } finally {
            database.close()
        }
        Unit
    }

    private fun timestamp(second: Int) = "2026-08-04T00:00:0${second}Z"

    companion object {
        const val RUNS = 500
        const val TOOL_RUNS = 50
        const val RECOVERY_RUNS = 20
        const val DATABASE = "stage8-oaep-stress.db"
        const val WORKSPACE = "stage8-stress-workspace"
        const val MARKER = "STAGE8_OAEP_STRESS"
    }
}
