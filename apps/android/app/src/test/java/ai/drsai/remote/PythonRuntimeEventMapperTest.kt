package ai.drsai.remote

import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.runtime.python.*
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PythonRuntimeEventMapperTest {
    private fun event(kind: String, payload: JSONObject = JSONObject()) = PythonRuntimeEnvelope(
        PythonRuntimeMessageType.RUNTIME_EVENT,
        "request-$kind",
        "run-1",
        "session-1",
        1,
        "key-$kind",
        payload.put("kind", kind),
    )

    @Test
    fun `maps shared terminal text and tool events to existing UI contract`() {
        assertEquals(RuntimeEvent.Started("run-1"), PythonRuntimeEventMapper.map(event("run.started")))
        assertEquals(RuntimeEvent.TextDelta("hello"), PythonRuntimeEventMapper.map(event("message.delta", JSONObject().put("text", "hello"))))
        assertEquals(RuntimeEvent.ToolFinished("clock"), PythonRuntimeEventMapper.map(event("tool.result", JSONObject().put("name", "clock"))))
        assertEquals(RuntimeEvent.Completed, PythonRuntimeEventMapper.map(event("run.completed")))
        assertEquals(RuntimeEvent.Cancelled, PythonRuntimeEventMapper.map(event("run.cancelled")))
        assertEquals(
            RuntimeEvent.Failed("timeout", true),
            PythonRuntimeEventMapper.map(event("run.failed", JSONObject().put("code", "timeout").put("retryable", true))),
        )
    }

    @Test
    fun `approval audit-only event does not become chat text`() {
        assertNull(PythonRuntimeEventMapper.map(event("approval.requested")))
    }
}
