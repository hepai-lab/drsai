package ai.drsai.remote

import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class RelaySseClientTest {
    private lateinit var server: MockWebServer
    private val identity = RemoteRunIdentity(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), RunId("run"), "codex")
    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    @Test fun `SSE resumes with cursor maps payload and preserves identity`() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody("""
            id: 3
            event: message.delta
            data: {"event_id":"evt-3","sequence":3,"runtime_id":"rt","workspace_id":"ws","session_id":"session","run_id":"run","timestamp":"now","kind":"message.delta","payload":{"delta":"你好"}}

            : keep-alive

        """.trimIndent()))
        val events = RelaySseClient(server.url("/").toString(), { "token" }).stream(identity, 2).toList()
        assertEquals(1, events.size)
        assertEquals("你好", events.single().payload.getString("delta"))
        assertEquals(3, events.single().event.sequence)
        server.takeRequest().apply {
            assertEquals("2", requestUrl?.queryParameter("after_sequence"))
            assertEquals("Bearer token", getHeader("Authorization"))
            assertEquals("text/event-stream", getHeader("Accept"))
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cross runtime SSE event fails closed`() = runTest {
        server.enqueue(MockResponse().setBody(
            "data: {\"event_id\":\"evt\",\"sequence\":1,\"runtime_id\":\"other\",\"workspace_id\":\"ws\",\"session_id\":\"session\",\"run_id\":\"run\",\"timestamp\":\"now\",\"kind\":\"run.started\",\"payload\":{}}\n\n"
        ))
        RelaySseClient(server.url("/").toString(), { "token" }).stream(identity, 0).toList()
    }
}
