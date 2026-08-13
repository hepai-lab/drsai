package ai.drsai.remote

import ai.drsai.remote.remote.data.OaepSessionRepository
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.data.RemoteLatencyTracker
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventData
import ai.drsai.remote.remote.generated.OaepSource
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class OaepSessionRepositoryLatencyTest {
    private val server = MockWebServer().apply { start() }

    @After
    fun close() = server.shutdown()

    @Test
    fun `receive is local and render posts one production latency observation`() = runTest {
        val times = ArrayDeque(listOf(1_000L, 1_007L))
        val baseUrl = server.url("/").toString()
        val relay = RelayRemoteRepository(baseUrl, accessToken = { "token" })
        val repository = OaepSessionRepository(
            relay,
            RelaySseClient(baseUrl, accessToken = { "token" }),
            latency = RemoteLatencyTracker(wallClockMs = { times.removeFirst() }),
        )
        val event = event("event/one")
        repository.markLatencyReceived(event)
        assertEquals(0, server.requestCount)
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"ready":true,"stages_present":["client_receive","client_render"],"latencies_ms":{"client_receive_to_render":7}}"""
        ))

        repository.recordLatencyRendered(
            RuntimeId("runtime"), WorkspaceId("workspace"), SessionId("session"), event,
        )

        val request = server.takeRequest()
        assertEquals(
            "/v1/runtimes/runtime/workspaces/workspace/sessions/session/events/"
                + "event%2Fone/latency-observation",
            request.path,
        )
        val body = JSONObject(request.body.readUtf8())
        assertEquals(1_000L, body.getLong("client_receive_at_ms"))
        assertEquals(1_007L, body.getLong("render_at_ms"))
    }

    private fun event(id: String) = OaepEvent(
        version = "1.0",
        eventId = id,
        sessionId = "session",
        runId = "run",
        itemId = null,
        sequence = 1,
        type = "event.run.started",
        timestamp = "2026-01-01T00:00:00Z",
        dedupeKey = "dedupe",
        source = OaepSource(backend = "opendrsai"),
        data = OaepEventData(),
    )
}
