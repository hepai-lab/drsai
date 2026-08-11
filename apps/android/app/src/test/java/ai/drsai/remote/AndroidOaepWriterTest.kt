package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepProjector
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.BackendItemId
import ai.drsai.remote.runtime.oaep.OaepItemId
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.androidOaepSnapshotDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidOaepWriterTest {
    private fun writer() = AndroidOaepWriter(
        AndroidOaepScope("workspace-1", "session-1", "run-1", "android-agent", "runtime-1", "Chat", 1),
        "2026-08-04T00:00:00Z",
    )

    @Test
    fun `writer assigns session cursor and stable item binding`() {
        val writer = writer()
        val started = writer.apply("runtime:1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        assertEquals(listOf("event.session.created", "event.run.created", "event.run.started"), started.appended.map { it.type })

        writer.apply(
            "runtime:2", NormalizedAgentEvent.ItemDelta("backend-message", "text", "hel"),
            "2026-08-04T00:00:02Z",
        )
        writer.apply(
            "runtime:3", NormalizedAgentEvent.ItemDelta("backend-message", "text", "lo"),
            "2026-08-04T00:00:03Z",
        )
        writer.apply(
            "runtime:4", NormalizedAgentEvent.ItemCompleted(
                "backend-message", "message", OaepMessageContent("assistant", "hello", "final"),
            ),
            "2026-08-04T00:00:04Z",
        )
        writer.apply("runtime:5", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:05Z")

        val snapshot = writer.state.snapshot()
        assertEquals((1L..8L).toList(), writer.state.events.map { it.sequence })
        assertEquals(8, snapshot.snapshotSequence)
        assertEquals("hello", (snapshot.items.single().content as OaepMessageContent).text)
        assertEquals("completed", snapshot.runStatus())
        assertEquals(setOf("run-1:item:1"), writer.state.itemBindings.values.map { it.value }.toSet())
        assertEquals(4L, writer.state.itemRevisions.getValue("run-1:item:1"))
    }

    @Test
    fun `typed identity boundary rejects a stale backend to OAEP binding before write`() {
        val base = writer()
        val invalidState = base.state.copy(itemBindings = mapOf(
            BackendItemId.of("backend-message") to OaepItemId.of("missing-oaep-item"),
        ))
        val guarded = AndroidOaepWriter(
            AndroidOaepScope("workspace-1", "session-1", "run-1", "android-agent", "runtime-1"),
            "2026-08-04T00:00:00Z",
            invalidState,
        )
        val before = guarded.state
        val failure = runCatching {
            guarded.apply(
                "binding-conflict",
                NormalizedAgentEvent.ItemCompleted(
                    "backend-message", "message", OaepMessageContent("assistant", "safe", "final"),
                ),
                "2026-08-04T00:00:01Z",
            )
        }.exceptionOrNull()
        assertTrue(failure is NoSuchElementException)
        assertEquals(before, guarded.state)
        assertEquals("runtime-1", guarded.state.run.source?.runtimeId)
    }

    @Test
    fun `duplicate input is idempotent and terminal run rejects later writes`() {
        val writer = writer()
        writer.apply("runtime:1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val duplicate = writer.apply("runtime:1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:02Z")
        assertTrue(duplicate.duplicate)
        assertEquals(3, writer.state.events.size)
        writer.apply("runtime:2", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:03Z")
        assertTrue(runCatching {
            writer.apply("runtime:3", NormalizedAgentEvent.ItemDelta("message", "text", "late"), "2026-08-04T00:00:04Z")
        }.isFailure)
    }

    @Test
    fun `approval follows interaction waiting resume sequence`() {
        val writer = writer()
        writer.apply("1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val interaction = OaepInteractionContent(
            "approval", "Allow?", listOf(mapOf("id" to "accept", "label" to "Allow")),
            approvalId = "approval-1",
        )
        writer.apply("2", NormalizedAgentEvent.ItemCreated("approval-1", "interaction", interaction, "waiting"), "2026-08-04T00:00:02Z")
        writer.apply("3", NormalizedAgentEvent.RunWaiting("approval", "approval-1"), "2026-08-04T00:00:03Z")
        writer.apply(
            "4", NormalizedAgentEvent.ItemCompleted(
                "approval-1", "interaction", interaction.copy(response = "approved"),
            ),
            "2026-08-04T00:00:04Z",
        )
        writer.apply("5", NormalizedAgentEvent.RunResumed, "2026-08-04T00:00:05Z")
        assertEquals(
            listOf(
                "event.session.created", "event.run.created", "event.run.started", "event.item.created", "event.run.waiting",
                "event.item.completed", "event.run.resumed",
            ),
            writer.state.events.map { it.type },
        )
        assertEquals("running", writer.state.run.status)
    }

    @Test
    fun `approval envelope is atomic and first terminal decision wins`() {
        val writer = writer()
        writer.apply("start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val interaction = OaepInteractionContent(
            "approval", "Allow?", listOf(mapOf("id" to "accept", "label" to "Allow")),
            approvalId = "approval-1",
        )
        val requested = writer.applyAll(
            "approval-request",
            listOf(
                NormalizedAgentEvent.ItemCreated("approval-1", "interaction", interaction, "waiting"),
                NormalizedAgentEvent.RunWaiting("approval", "approval-1"),
            ),
            "2026-08-04T00:00:02Z",
        )
        assertEquals(listOf("event.item.created", "event.run.waiting"), requested.appended.map { it.type })
        val approved = writer.applyAll(
            "approval-approved",
            listOf(
                NormalizedAgentEvent.ItemCompleted(
                    "approval-1", "interaction", interaction.copy(response = "approved"),
                ),
                NormalizedAgentEvent.RunResumed,
            ),
            "2026-08-04T00:00:03Z",
        )
        assertEquals(listOf("event.item.completed", "event.run.resumed"), approved.appended.map { it.type })
        val watermark = writer.state.lastSequence
        val losingDecision = writer.applyAll(
            "approval-rejected-late",
            listOf(
                NormalizedAgentEvent.ItemCompleted(
                    "approval-1", "interaction", interaction.copy(response = "rejected"),
                ),
                NormalizedAgentEvent.RunResumed,
            ),
            "2026-08-04T00:00:04Z",
        )
        assertTrue(losingDecision.duplicate)
        assertEquals(watermark, writer.state.lastSequence)
        assertEquals("approved", (writer.state.items.values.single().content as OaepInteractionContent).response)
    }

    @Test
    fun `same backend item cannot change OAEP type`() {
        val writer = writer()
        writer.apply("1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        writer.apply(
            "2", NormalizedAgentEvent.ItemStarted(
                "call-1", "tool_call", OaepToolCallContent("tool", "clock", "call-1", emptyMap(), null),
            ),
            "2026-08-04T00:00:02Z",
        )
        assertTrue(runCatching {
            writer.apply(
                "3", NormalizedAgentEvent.ItemCompleted(
                    "call-1", "message", OaepMessageContent("assistant", "wrong"),
                ),
                "2026-08-04T00:00:03Z",
            )
        }.isFailure)
    }

    @Test
    fun `run terminal deterministically closes open items`() {
        val writer = writer()
        writer.apply("1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        writer.apply("2", NormalizedAgentEvent.ItemDelta("message", "text", "partial"), "2026-08-04T00:00:02Z")
        val terminal = writer.apply("3", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:03Z")
        assertEquals(listOf("event.item.completed", "event.run.completed"), terminal.appended.map { it.type })
        assertEquals("completed", writer.state.items.values.single().status)
        assertEquals("partial", (writer.state.items.values.single().content as OaepMessageContent).text)
    }

    @Test
    fun `live projection and complete journal replay have identical snapshot digest`() {
        val writer = writer()
        val initialSession = writer.state.session
        writer.apply("1", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        writer.apply("2", NormalizedAgentEvent.ItemDelta("message", "text", "hello"), "2026-08-04T00:00:02Z")
        writer.apply(
            "3", NormalizedAgentEvent.ItemCompleted(
                "message", "message", OaepMessageContent("assistant", "hello", "final"),
            ),
            "2026-08-04T00:00:03Z",
        )
        writer.apply("4", NormalizedAgentEvent.RunCompleted, "2026-08-04T00:00:04Z")

        val live = writer.state.snapshot()
        val replayed = AndroidOaepProjector(initialSession).applyAll(writer.state.events).snapshot()
        assertEquals(live, replayed)
        assertEquals(androidOaepSnapshotDigest(live), androidOaepSnapshotDigest(replayed))
    }

    private fun ai.drsai.remote.remote.generated.OaepSnapshot.runStatus() = runs.single().status
}
