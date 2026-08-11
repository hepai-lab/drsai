package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ToolCallDelta
import ai.drsai.remote.runtime.python.StreamedToolCallAssembler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class StreamedToolCallAssemblerTest {
    @Test
    fun `fragmented id name and arguments reconstruct exact object`() {
        val assembler = StreamedToolCallAssembler()
        assembler.append(ToolCallDelta(0, "call-1", "web.search", "{\"query\":"))
        assembler.append(ToolCallDelta(0, null, null, "\"HEPiX 2026\",\"limit\":5}"))

        val call = assembler.finish().getJSONObject(0)
        assertEquals("call-1", call.getString("call_id"))
        assertEquals("web.search", call.getString("name"))
        assertEquals("HEPiX 2026", call.getJSONObject("arguments").getString("query"))
        assertEquals(5, call.getJSONObject("arguments").getInt("limit"))
    }

    @Test
    fun `interleaved multiple calls preserve index order`() {
        val assembler = StreamedToolCallAssembler()
        assembler.append(ToolCallDelta(1, "call-2", "workspace.read", "{\"path\":"))
        assembler.append(ToolCallDelta(0, "call-1", "web.search", "{\"query\":"))
        assembler.append(ToolCallDelta(1, null, null, "\"README.md\"}"))
        assembler.append(ToolCallDelta(0, null, null, "\"Android\"}"))

        val calls = assembler.finish()
        assertEquals("call-1", calls.getJSONObject(0).getString("call_id"))
        assertEquals("call-2", calls.getJSONObject(1).getString("call_id"))
    }

    @Test
    fun `missing duplicate and invalid fragments fail closed with stable code`() {
        val invalid = listOf<() -> Unit>(
            { StreamedToolCallAssembler().apply { append(ToolCallDelta(0, null, "clock", "{}")) }.finish() },
            {
                StreamedToolCallAssembler().apply {
                    append(ToolCallDelta(0, "one", "clock", "{}"))
                    append(ToolCallDelta(0, "two", null, ""))
                }
            },
            { StreamedToolCallAssembler().apply { append(ToolCallDelta(0, "one", "clock", "{")) }.finish() },
            { StreamedToolCallAssembler().apply { append(ToolCallDelta(1, "one", "clock", "{}")) }.finish() },
        )

        invalid.forEach { operation ->
            val error = runCatching { operation() }.exceptionOrNull() as ApiException
            assertEquals(502, error.status)
            assertEquals("model_tool_stream_invalid", error.code)
            assertFalse(error.retryable)
        }
    }

    @Test
    fun `negative oversized and reused call identities fail closed`() {
        val negative = runCatching {
            StreamedToolCallAssembler().append(ToolCallDelta(-1, "bad", "clock", "{}"))
        }.exceptionOrNull() as ApiException
        assertEquals("model_tool_stream_invalid", negative.code)

        val reused = StreamedToolCallAssembler().apply {
            append(ToolCallDelta(0, "same", "clock", "{}"))
            append(ToolCallDelta(1, "same", "clock", "{}"))
        }
        assertEquals("model_tool_stream_invalid", (runCatching { reused.finish() }.exceptionOrNull() as ApiException).code)

        val oversized = StreamedToolCallAssembler(maxArgumentsChars = 4)
        val error = runCatching {
            oversized.append(ToolCallDelta(0, "one", "clock", "{\"x\":1}"))
        }.exceptionOrNull() as ApiException
        assertEquals("model_tool_stream_invalid", error.code)
    }
}
