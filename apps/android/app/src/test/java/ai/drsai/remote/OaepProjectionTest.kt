package ai.drsai.remote

import ai.drsai.remote.remote.generated.*
import ai.drsai.remote.remote.model.projectOaepMessages
import ai.drsai.remote.remote.model.projectOaepPresentation
import ai.drsai.remote.remote.model.OaepTimelineEntry
import ai.drsai.remote.remote.model.sanitizeRemoteTranscriptText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OaepProjectionTest {
    @Test
    fun `all ten OAEP item kinds have a safe visible projection`() {
        val contents: List<Pair<String, OaepItemContent>> = listOf(
            "message" to OaepMessageContent("assistant", "message"),
            "reasoning" to OaepReasoningContent(listOf(mapOf("id" to "s", "text" to "reasoning"))),
            "plan" to OaepPlanContent("plan", listOf(mapOf("id" to "1", "title" to "step"))),
            "command_execution" to OaepCommandExecutionContent(listOf("pwd"), "type C:\\Users\\alice\\secret.txt", ".", "output"),
            "tool_call" to OaepToolCallContent("mcp", "tool", "call", emptyMap(), "result"),
            "file_change" to OaepFileChangeContent(emptyList(), "file change"),
            "artifact" to OaepArtifactContent("artifact", "report", "Report", "artifact summary"),
            "interaction" to OaepInteractionContent("approval", "approve?", emptyList()),
            "subtask" to OaepSubtaskContent("subtask", "subtask summary"),
            "notice" to OaepNoticeContent("warning", "notice", "notice message"),
        )
        val items = contents.mapIndexed { index, (type, content) ->
            OaepItem(
                "item-$index", "session", "run", type, "completed", index + 1L,
                "now", "now", OaepSource("runtime"), content,
            )
        }
        val projected = projectOaepMessages(items)
        assertEquals(10, projected.size)
        assertEquals(items.map { it.id }, projected.map { it.id })
        assertTrue(projected.all { it.text.isNotBlank() })
        assertEquals("command_execution", projected.first { it.id == "item-3" }.kind)
        assertEquals("Command", projected.first { it.id == "item-3" }.title)
        assertEquals("type [path]", projected.first { it.id == "item-3" }.detail)
        assertEquals("tool_call", projected.first { it.id == "item-4" }.kind)
        assertEquals("tool", projected.first { it.id == "item-4" }.title)
        assertEquals("file_change", projected.first { it.id == "item-5" }.kind)
        assertEquals("interaction", projected.first { it.id == "item-7" }.kind)
    }

    @Test
    fun `transcript sanitizer is shared by snapshot and cached projections`() {
        assertEquals(
            "open [path] with token=[REDACTED]",
            sanitizeRemoteTranscriptText("open C:\\Users\\alice\\secret.txt with token=abc123"),
        )
    }

    @Test
    fun `snapshot projection orders by run sequence and preserves phase and resources`() {
        val source = OaepSource("runtime")
        val first = OaepRun("z-run", "session", null, 1, source, "completed", "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", "2026-01-01T00:00:01Z")
        val second = OaepRun("a-run", "session", null, 2, source, "running", "2026-01-01T00:00:02Z", "2026-01-01T00:00:03Z", null)
        val resource = OaepResourceRef(
            workspaceId = "workspace", resourceType = "artifact", resourceId = "image-1",
            label = "diagram.png", digest = "a".repeat(64),
        )
        val firstItem = OaepItem(
            "first-item", "session", "z-run", "message", "completed", 1,
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", source,
            OaepMessageContent(
                "assistant", "commentary", "commentary",
                parts = listOf(mapOf(
                    "type" to "image", "name" to "diagram.png", "mime_type" to "image/png",
                    "size" to 42L, "resource_ref" to mapOf("resource_id" to "image-1"),
                )),
                resourceRefs = listOf(resource),
            ),
        )
        val secondItem = OaepItem(
            "second-item", "session", "a-run", "message", "running", 1,
            "2026-01-01T00:00:02Z", "2026-01-01T00:00:03Z", source,
            OaepMessageContent("assistant", "final", "final"),
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "runtime", "now", "now"),
            listOf(second, first), listOf(secondItem, firstItem), 9,
        )

        val projected = projectOaepMessages(snapshot)
        assertEquals(listOf("z-run", "a-run"), projected.map { it.runId })
        assertEquals("commentary", projected.first().phase)
        assertEquals("image-1", projected.first().resources.single().id)
        assertEquals("image/png", projected.first().resources.single().mimeType)
        assertEquals(42L, projected.first().resources.single().size)
    }

    @Test
    fun `structured presentation aggregates one run into process interaction and result layers`() {
        val source = OaepSource("runtime")
        val run = OaepRun("run", "session", null, 1, source, "completed", "now", "later", "later")
        fun item(id: String, sequence: Long, type: String, content: OaepItemContent) = OaepItem(
            id, "session", "run", type, "completed", sequence, "now", "later", source, content,
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "runtime", "now", "later"),
            listOf(run),
            listOf(
                item("user", 1, "message", OaepMessageContent("user", "question")),
                item("commentary", 2, "message", OaepMessageContent("assistant", "working", "commentary")),
                item("tool", 3, "tool_call", OaepToolCallContent("local", "search", "call", emptyMap(), "found")),
                item("interaction", 4, "interaction", OaepInteractionContent("approval", "approve?", emptyList())),
                item("final", 5, "message", OaepMessageContent("assistant", "answer", "final")),
            ),
            5,
        )

        val timeline = projectOaepPresentation(snapshot)
        assertEquals(2, timeline.size)
        assertEquals("question", (timeline[0] as OaepTimelineEntry.UserMessage).text)
        val turn = timeline[1] as OaepTimelineEntry.AssistantTurn
        assertEquals("run", turn.runId)
        assertEquals(listOf("progress", "tool"), turn.process.map { it.kind })
        assertEquals("approve?", turn.interactions.single().prompt)
        assertEquals("answer", turn.results.single().text)
        assertTrue(turn.results.none { it.text in setOf("completed", "final", "host") })
    }

    @Test
    fun `presentation keeps tool progress execution location failures and source links`() {
        val source = OaepSource("android", runtimeId = "android-local")
        val run = OaepRun("run", "session", null, 1, source, "failed", "now", "later", "later")
        fun item(id: String, sequence: Long, status: String, content: OaepItemContent) = OaepItem(
            id, "session", "run", if (content is OaepMessageContent) "message" else "tool_call",
            status, sequence, "now", "later", source, content,
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "android", "now", "later"),
            listOf(run),
            listOf(
                item("search", 1, "running", OaepToolCallContent(
                    "host", "web.search", "call-search", mapOf("query" to "HEPiX 2026"),
                    mapOf("results" to listOf(mapOf("title" to "HEPiX", "url" to "https://www.hepix.org/"))),
                )),
                item("fetch", 2, "failed", OaepToolCallContent(
                    "host", "web.fetch", "call-fetch", mapOf("url" to "https://www.hepix.org/"),
                    mapOf("status" to "fetch_timeout"),
                )),
                item("final", 3, "completed", OaepMessageContent(
                    "assistant", "verified answer", "final",
                    citations = listOf(mapOf("title" to "HEPiX source", "url" to "https://www.hepix.org/")),
                )),
            ), 3,
        )

        val turn = projectOaepPresentation(snapshot).single() as OaepTimelineEntry.AssistantTurn
        assertEquals("正在搜索网页", turn.process[0].title)
        assertEquals("Android Agent Runtime · Android Host", turn.process[0].executionLocation)
        assertEquals("https://www.hepix.org/", turn.process[0].sources.single().url)
        assertEquals("failed", turn.process[1].status)
        assertEquals("HEPiX source", turn.results.single().sources.single().label)
    }
}
