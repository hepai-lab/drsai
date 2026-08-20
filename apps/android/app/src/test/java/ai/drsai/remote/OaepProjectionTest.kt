package ai.drsai.remote

import ai.drsai.remote.remote.generated.*
import ai.drsai.remote.remote.model.projectOaepMessages
import ai.drsai.remote.remote.model.projectOaepPresentation
import ai.drsai.remote.remote.model.OaepTimelineEntry
import ai.drsai.remote.remote.model.OaepSourceType
import ai.drsai.remote.remote.model.UserRunOutcome
import ai.drsai.remote.remote.model.OaepProcessItem
import ai.drsai.remote.remote.model.OaepTaskProgress
import ai.drsai.remote.remote.model.OaepTaskStep
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
                parts = listOf(OaepLegacyMessagePart(
                    type = "image", name = "diagram.png", mimeType = "image/png", resourceRef = resource,
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
        assertEquals("Working: search public web pages", turn.process[0].title)
        assertEquals("Android Agent Runtime · Android Host", turn.process[0].executionLocation)
        assertEquals("https://www.hepix.org/", turn.process[0].sources.single().url)
        assertEquals("failed", turn.process[1].status)
        assertEquals("HEPiX source", turn.results.single().sources.single().label)
    }

    @Test
    fun `all OAEP fixture families map to deterministic user task steps and unknown notice is safe`() {
        val source = OaepSource("android", runtimeId = "android-local")
        val run = OaepRun("run", "session", null, 1, source, "running", "now", "later", null)
        fun item(id: String, sequence: Long, content: OaepItemContent) = OaepItem(
            id, "session", "run", id, "running", sequence, "now", "later", source, content,
        )
        val items = listOf(
            item("message", 1, OaepMessageContent("assistant", "working", "commentary")),
            item("web", 2, OaepToolCallContent("host", "web.search", "call", emptyMap(), null)),
            item("file", 3, OaepFileChangeContent(emptyList(), "changed config")),
            item("plan", 4, OaepPlanContent("two steps", emptyList())),
            item("subtask", 5, OaepSubtaskContent("research", "delegated")),
            item("artifact", 6, OaepArtifactContent("a", "report", "Report", "ready")),
            item("unknown", 7, OaepNoticeContent("info", "future.oaep.event", "still working")),
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "android", "now", "later"),
            listOf(run), items, 7,
        )

        val first = projectOaepPresentation(snapshot).single() as OaepTimelineEntry.AssistantTurn
        val second = projectOaepPresentation(snapshot).single() as OaepTimelineEntry.AssistantTurn
        assertEquals(first, second)
        assertEquals(
            listOf("progress", "tool", "file", "plan", "subtask", "notice"),
            first.process.map { it.kind },
        )
        assertEquals("Processing", first.process.last().title)
        assertTrue(first.process.last().advancedDetail.orEmpty().contains("future.oaep.event"))
        assertEquals("Report", first.results.single().title)
        assertTrue(first.process.none { it.title.contains("思考过程") })
    }

    @Test
    fun `sources validate deduplicate and distinguish web local document and artifact`() {
        val source = OaepSource("android", runtimeId = "android-local")
        val run = OaepRun("run", "session", null, 1, source, "completed", "now", "later", "later")
        fun item(id: String, sequence: Long, content: OaepItemContent) = OaepItem(
            id, "session", "run", id, "completed", sequence, "now", "later", source, content,
        )
        val resource = OaepResourceRef(
            workspaceId = "local", resourceType = "file", resourceId = "doc-1", label = "notes.md",
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "android", "now", "later"),
            listOf(run), listOf(
                item("final", 1, OaepMessageContent(
                    "assistant", "answer", "final",
                    citations = listOf(
                        mapOf("title" to "Valid", "url" to "https://example.com/a"),
                        mapOf("title" to "Duplicate", "url" to "https://EXAMPLE.com/a"),
                        mapOf("title" to "Invalid", "url" to "javascript:alert(1)"),
                        mapOf("title" to "Credentials", "url" to "https://user:pass@example.com/private"),
                    ),
                    resourceRefs = listOf(resource),
                )),
                item("artifact", 2, OaepArtifactContent("artifact-1", "report", "report.pdf", "ready")),
            ), 2,
        )

        val turn = projectOaepPresentation(snapshot).single() as OaepTimelineEntry.AssistantTurn
        val answerSources = turn.results.first().sources
        assertEquals(2, answerSources.size)
        assertEquals(setOf(OaepSourceType.WEB, OaepSourceType.LOCAL_DOCUMENT), answerSources.map { it.type }.toSet())
        assertTrue(answerSources.single { it.type == OaepSourceType.WEB }.verified.not())
        assertTrue(turn.results.last().sources.single().type == OaepSourceType.ARTIFACT)
        assertTrue(turn.results.last().sources.single().verified)
    }

    @Test
    fun `plan and parallel subtasks expose goal status counts and partial failure without reasoning text`() {
        val source = OaepSource("android")
        val run = OaepRun("run", "session", null, 1, source, "running", "now", "later", null)
        fun item(id: String, sequence: Long, status: String, content: OaepItemContent) = OaepItem(
            id, "session", "run", id, status, sequence, "now", "later", source, content,
        )
        val snapshot = OaepSnapshot(
            "1.0", OaepSession("session", "workspace", "Title", "active", "android", "now", "later"),
            listOf(run), listOf(
                item("reasoning", 1, "completed", OaepReasoningContent(listOf(mapOf("text" to "private chain of thought")))),
                item("plan", 2, "running", OaepPlanContent("调研并形成报告", listOf(
                    mapOf("title" to "检索资料", "status" to "completed"),
                    mapOf("title" to "核对来源", "status" to "running"),
                    mapOf("title" to "整理附件", "status" to "pending"),
                    mapOf("title" to "生成图表", "status" to "failed"),
                ))),
                item("subtask-a", 3, "running", OaepSubtaskContent("核对会议日期", "working", "researcher")),
                item("subtask-b", 4, "failed", OaepSubtaskContent("下载附件", "failed", "reader")),
            ), 4,
        )

        val turn = projectOaepPresentation(snapshot).single() as OaepTimelineEntry.AssistantTurn
        val plan = turn.process.single { it.kind == "plan" }.taskProgress ?: error("missing plan progress")
        assertEquals("调研并形成报告", plan.goal)
        assertEquals(listOf(1, 1, 1, 1), listOf(plan.completed, plan.running, plan.waiting, plan.failed))
        assertTrue(plan.partialFailure)
        assertEquals(listOf("running", "failed"), turn.process.filter { it.kind == "subtask" }.map { it.taskProgress!!.steps.single().status })
        assertTrue(turn.process.none { it.text.contains("private chain of thought") })
    }

    @Test
    fun `each OAEP run projects exactly one snapshot-consistent user outcome`() {
        val source = OaepSource("android")
        val statuses = listOf("completed", "failed", "cancelled", "waiting")
        statuses.forEachIndexed { index, status ->
            val run = OaepRun("run-$status", "session", null, index.toLong(), source, status, "now", "later", if (status in setOf("completed", "failed", "cancelled")) "later" else null)
            val item = OaepItem(
                "notice-$status", "session", run.id, "notice", if (status == "waiting") "waiting" else "completed", 1,
                "now", "later", source, OaepNoticeContent("info", "status", "status"),
            )
            val snapshot = OaepSnapshot(
                "1.0", OaepSession("session", "workspace", "Title", "active", "android", "now", "later"),
                listOf(run), listOf(item), 1,
            )
            val turns = projectOaepPresentation(snapshot).filterIsInstance<OaepTimelineEntry.AssistantTurn>()
            assertEquals(1, turns.size)
            assertEquals(
                when (status) {
                    "completed" -> UserRunOutcome.COMPLETED
                    "failed" -> UserRunOutcome.FAILED
                    "cancelled" -> UserRunOutcome.CANCELLED
                    else -> UserRunOutcome.RECOVERABLE
                },
                turns.single().outcome,
            )
        }
        val partial = UserRunOutcome.derive(
            "completed",
            listOf(OaepProcessItem("step", "plan", "Plan", "", "completed", taskProgress = OaepTaskProgress(
                "goal", listOf(OaepTaskStep("done", "completed"), OaepTaskStep("bad", "failed")),
            ))),
        )
        assertEquals(UserRunOutcome.PARTIAL, partial)
    }
}
