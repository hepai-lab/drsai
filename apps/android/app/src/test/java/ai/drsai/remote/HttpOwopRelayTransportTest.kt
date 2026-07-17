package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HttpOwopRelayTransportTest {
    private lateinit var server: MockWebServer
    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() = server.shutdown()

    @Test fun `http relay OWOP preserves runtime workspace request and correlation identity`() = runTest {
        server.enqueue(MockResponse().setBody("""{"request_id":"req","correlation_id":"corr","runtime_id":"rt-a","workspace_id":"ws","result":{"items":[{"token":"t","relative_path":"README.md","type":"file","size":1}],"next_cursor":null}}"""))
        val client = RelayWorkspaceOperationsClient(HttpOwopRelayTransport(server.url("/").toString(), RuntimeId("rt-a"), { "token" }))
        val result = client.listFiles(WorkspaceId("ws"), "", "req", "corr") as OwopResult.Success
        val request = server.takeRequest()
        assertEquals("/v1/runtimes/rt-a/workspaces/ws/owop", request.path)
        assertEquals("Bearer token", request.getHeader("Authorization"))
        assertTrue(request.body.readUtf8().contains("\"operation\":\"files.list\""))
        assertEquals("README.md", ((result.result["items"] as List<*>).single() as Map<*, *>)["relative_path"])
    }

    @Test(expected = IllegalArgumentException::class)
    fun `OWOP response from another runtime fails closed`() = runTest {
        server.enqueue(MockResponse().setBody("""{"request_id":"req","correlation_id":"corr","runtime_id":"rt-b","workspace_id":"ws","result":{}}"""))
        RelayWorkspaceOperationsClient(HttpOwopRelayTransport(server.url("/").toString(), RuntimeId("rt-a"), { "token" }))
            .gitStatus(WorkspaceId("ws"), "req", "corr")
    }
}
