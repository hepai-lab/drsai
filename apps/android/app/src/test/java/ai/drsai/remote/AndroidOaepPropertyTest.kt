package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.model.oaepItemsDigest
import ai.drsai.remote.runtime.oaep.AndroidOaepProjector
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class AndroidOaepPropertyTest {
    private fun writer(seed: Int) = AndroidOaepWriter(
        AndroidOaepScope("workspace-$seed", "session-$seed", "run-$seed", "property", "runtime-$seed"),
        "2026-08-04T00:00:00Z",
    )

    @Test
    fun `one hundred generated streams preserve duplicate idempotency and replay parity`() {
        repeat(100) { seed ->
            val random = Random(seed)
            val writer = writer(seed)
            val initialSession = writer.state.session
            val events = buildList {
                add(NormalizedAgentEvent.RunStarted)
                repeat(random.nextInt(1, 9)) { item ->
                    val backendId = "backend-$seed-$item"
                    add(NormalizedAgentEvent.ItemDelta(backendId, "text", "part-$item"))
                    add(NormalizedAgentEvent.ItemCompleted(
                        backendId, "message", OaepMessageContent("assistant", "part-$item", "final"),
                    ))
                }
                add(NormalizedAgentEvent.RunCompleted)
            }
            events.forEachIndexed { index, event ->
                val key = "property-$seed-$index"
                writer.apply(key, event, "2026-08-04T00:00:${(index + 1).toString().padStart(2, '0')}Z")
                val beforeDuplicate = writer.state
                assertTrue(writer.apply(key, event, "2026-08-04T00:01:00Z").duplicate)
                assertEquals(beforeDuplicate, writer.state)
            }
            val live = writer.state.snapshot()
            val replay = AndroidOaepProjector(initialSession).applyAll(writer.state.events).snapshot()
            assertEquals(live.snapshotSequence, replay.snapshotSequence)
            assertEquals(oaepItemsDigest(live.items), oaepItemsDigest(replay.items))
            assertEquals("completed", replay.runs.single().status)
        }
    }

    @Test
    fun `generated reordered or gapped journals fail closed`() {
        repeat(100) { seed ->
            val writer = writer(seed)
            val initial = writer.state.session
            writer.apply("start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
            writer.apply("item", NormalizedAgentEvent.ItemCompleted(
                "backend", "message", OaepMessageContent("assistant", "done", "final"),
            ), "2026-08-04T00:00:02Z")
            writer.apply("done", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:03Z")
            val events = writer.state.events
            val reordered = events.toMutableList().also { rows ->
                val left = 1 + seed % (rows.size - 1)
                val right = if (left == rows.lastIndex) left - 1 else left + 1
                val value = rows[left]; rows[left] = rows[right]; rows[right] = value
            }
            assertTrue(runCatching { AndroidOaepProjector(initial).applyAll(reordered) }.isFailure)
            val removed = events.filterIndexed { index, _ -> index != 1 + seed % (events.size - 2) }
            assertTrue(runCatching { AndroidOaepProjector(initial).applyAll(removed) }.isFailure)
        }
    }

    @Test
    fun `generated transaction crash points roll back whole normalized batch`() {
        repeat(100) { seed ->
            val writer = writer(seed)
            val before = writer.state
            val failure = runCatching {
                writer.applyAll(
                    "batch-$seed",
                    listOf(
                        NormalizedAgentEvent.RunStarted,
                        NormalizedAgentEvent.ItemCompleted(
                            "bad-$seed", "message", OaepMessageContent("assistant", "x", "final"),
                        ),
                        NormalizedAgentEvent.ItemCompleted(
                            "bad-$seed", "tool_call", OaepMessageContent("assistant", "type drift", "final"),
                        ),
                    ),
                    "2026-08-04T00:00:01Z",
                )
            }
            assertTrue(failure.isFailure)
            assertEquals(before, writer.state)
        }
    }

    @Test
    fun `generated terminal states reject every later semantic mutation`() {
        val terminals = listOf<NormalizedAgentEvent>(
            NormalizedAgentEvent.RunCompleted,
            NormalizedAgentEvent.RunCancelled,
            NormalizedAgentEvent.RunFailed(ai.drsai.remote.remote.generated.OaepError("failed", "safe", false)),
        )
        terminals.forEachIndexed { index, terminal ->
            val writer = writer(index)
            writer.apply("start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
            writer.apply("terminal", terminal, "2026-08-04T00:00:02Z")
            val before = writer.state
            assertTrue(runCatching {
                writer.apply("late", NormalizedAgentEvent.ItemDelta("late", "text", "x"), "2026-08-04T00:00:03Z")
            }.isFailure)
            assertEquals(before, writer.state)
        }
    }
}
