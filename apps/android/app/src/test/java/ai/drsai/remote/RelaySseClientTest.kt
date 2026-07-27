package ai.drsai.remote

import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

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
        var connected = false
        val events = RelaySseClient(server.url("/").toString(), { "token" })
            .stream(identity, 2, onConnected = { connected = true })
            .toList()
        assertTrue(connected)
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

    @Test fun `SSE refreshes one expired bearer before opening stream`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":"invalid_token"}"""))
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
            "data: {\"event_id\":\"evt-1\",\"sequence\":1,\"runtime_id\":\"rt\",\"workspace_id\":\"ws\",\"session_id\":\"session\",\"run_id\":\"run\",\"timestamp\":\"now\",\"kind\":\"run.started\",\"payload\":{}}\n\n"
        ))

        val events = RelaySseClient(
            server.url("/").toString(),
            { "expired" },
            refreshAfter = { failed -> if (failed == "expired") "refreshed" else null },
        ).stream(identity, 0).toList()

        assertEquals(1, events.size)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer refreshed", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `fragmented SSE frame is decoded once`() = runTest {
        val body = "data: {\"event_id\":\"evt-1\",\"sequence\":1,\"runtime_id\":\"rt\",\"workspace_id\":\"ws\",\"session_id\":\"session\",\"run_id\":\"run\",\"timestamp\":\"now\",\"kind\":\"message.delta\",\"payload\":{\"delta\":\"fragmented\"}}\n\n"
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setChunkedBody(body, 7))

        val events = RelaySseClient(server.url("/").toString(), { "token" }).stream(identity, 0).toList()

        assertEquals(1, events.size)
        assertEquals("fragmented", events.single().payload.getString("delta"))
    }

    @Test fun `EOF reconnect uses last committed sequence`() = runTest {
        fun frame(sequence: Int) =
            "data: {\"event_id\":\"evt-$sequence\",\"sequence\":$sequence,\"runtime_id\":\"rt\",\"workspace_id\":\"ws\",\"session_id\":\"session\",\"run_id\":\"run\",\"timestamp\":\"now\",\"kind\":\"message.delta\",\"payload\":{\"delta\":\"$sequence\"}}\n\n"
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(frame(1)))
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setBody(frame(2)))
        val client = RelaySseClient(server.url("/").toString(), { "token" })

        assertEquals(1L, client.stream(identity, 0).toList().single().event.sequence)
        assertEquals(2L, client.stream(identity, 1).toList().single().event.sequence)
        assertEquals("0", server.takeRequest().requestUrl?.queryParameter("after_sequence"))
        assertEquals("1", server.takeRequest().requestUrl?.queryParameter("after_sequence"))
    }

    @Test fun `session SSE uses session cursor and discovers later run`() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"event_id\":\"session-event-4\",\"runtime_id\":\"rt\",\"workspace_id\":\"ws\"," +
                    "\"session_id\":\"session\",\"run_id\":\"run-2\",\"session_sequence\":4," +
                    "\"kind\":\"run.created\",\"timestamp\":\"now\",\"payload\":{\"source_message_id\":\"android-1\"}}\n\n",
            ),
        )

        var connected = false
        val events = RelaySseClient(server.url("/").toString(), { "token" })
            .sessionStream(
                RuntimeId("rt"),
                WorkspaceId("ws"),
                SessionId("session"),
                3,
                onConnected = { connected = true },
            )
            .toList()

        assertTrue(connected)
        assertEquals(4, events.single().sessionSequence)
        assertEquals("run-2", events.single().runId)
        server.takeRequest().apply {
            assertEquals("3", requestUrl?.queryParameter("after_sequence"))
            assertEquals(
                "/v1/runtimes/rt/workspaces/ws/sessions/session/events/stream?after_sequence=3",
                path,
            )
        }
    }

    @Test fun `session SSE does not inherit a finite response body read timeout`() = runTest {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBodyDelay(150, TimeUnit.MILLISECONDS)
                .setBody(
                    "data: {\"event_id\":\"session-event-5\",\"runtime_id\":\"rt\",\"workspace_id\":\"ws\"," +
                        "\"session_id\":\"session\",\"run_id\":\"run-3\",\"session_sequence\":5," +
                        "\"kind\":\"run.created\",\"timestamp\":\"now\",\"payload\":{}}\n\n",
                ),
        )
        val finiteHttp = okhttp3.OkHttpClient.Builder()
            .readTimeout(50, TimeUnit.MILLISECONDS)
            .build()

        val events = RelaySseClient(
            server.url("/").toString(),
            { "token" },
            http = finiteHttp,
        ).sessionStream(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), 4)
            .toList()

        assertEquals(5, events.single().sessionSequence)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `cross scope session SSE fails closed`() = runTest {
        server.enqueue(
            MockResponse().setHeader("Content-Type", "text/event-stream").setBody(
                "data: {\"event_id\":\"e\",\"runtime_id\":\"other\",\"workspace_id\":\"ws\"," +
                    "\"session_id\":\"session\",\"run_id\":null,\"session_sequence\":1," +
                    "\"kind\":\"session.updated\",\"timestamp\":\"now\",\"payload\":{}}\n\n",
            ),
        )
        RelaySseClient(server.url("/").toString(), { "token" })
            .sessionStream(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), 0)
            .toList()
    }
}
