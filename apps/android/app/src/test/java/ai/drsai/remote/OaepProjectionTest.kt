package ai.drsai.remote

import ai.drsai.remote.remote.generated.*
import ai.drsai.remote.remote.model.projectOaepMessages
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
}
