package ai.drsai.remote

import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.parseAccessGrantCode
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RuntimeId
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RelayDiscoveryClientTest {
    private lateinit var server: MockWebServer

    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    @Test fun `authorized runtime discovery parses identity generation and cursor`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[{"runtime":{"runtime_id":"rt-a","instance_id":"boot-2","version":"1.4.6",
            "protocol_version":"owop/1","status":"degraded","connection_generation":2},"display_name":"Office"}],
            "next_cursor":"20"}
        """.trimIndent()).setResponseCode(200))
        val service = HttpRelayDiscoveryService(server.url("/api/runtime-relay").toString(), { "oidc-token" })
        val page = service.listRuntimes(cursor = "0", query = "Office")
        assertEquals("rt-a", page.items.single().reference.runtimeId.value)
        assertEquals(RemoteConnectionState.DEGRADED, page.items.single().state)
        assertEquals(2, page.items.single().connectionGeneration)
        assertEquals("20", page.nextCursor)
        server.takeRequest().apply {
            assertEquals("Bearer oidc-token", getHeader("Authorization"))
            assertEquals("0", requestUrl?.queryParameter("cursor"))
            assertEquals("Office", requestUrl?.queryParameter("query"))
        }
    }

    @Test fun `workspace page is runtime scoped and supports empty state`() = runTest {
        server.enqueue(MockResponse().setBody("{\"items\":[],\"next_cursor\":null}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        val empty = service.listWorkspaces(RuntimeId("rt-a"))
        assertTrue(empty.items.isEmpty())
        assertNull(empty.nextCursor)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `workspace response from another runtime fails closed`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[{"runtime_id":"rt-b","workspace_id":"ws","display_name":"Wrong"}],"next_cursor":null}
        """.trimIndent()))
        HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .listWorkspaces(RuntimeId("rt-a"))
    }

    @Test fun `401 refreshes and replays exactly once`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"items\":[],\"next_cursor\":null}"))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "expired" }, { failed ->
            refreshes += 1
            assertEquals("expired", failed)
            "fresh"
        })
        assertTrue(service.listRuntimes().items.isEmpty())
        assertEquals(1, refreshes)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
        assertEquals(2, server.requestCount)
    }

    @Test fun `plain access grant is strictly validated`() {
        assertEquals("abcdefghijklmnop", parseAccessGrantCode("abcdefghijklmnop"))
        kotlin.runCatching { parseAccessGrantCode("short") }.onSuccess { error("short grant accepted") }
        kotlin.runCatching { parseAccessGrantCode("../../secret-secret") }.onSuccess { error("path grant accepted") }
    }

    @Test fun `association derives principal only from bearer token`() = runTest {
        server.enqueue(MockResponse().setBody("{\"runtime_id\":\"rt-associated\"}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        assertEquals("rt-associated", service.associate("abcdefghijklmnop").value)
        server.takeRequest().apply {
            assertEquals("Bearer token", getHeader("Authorization")); assertEquals(null, getHeader("X-Subject"))
            assertTrue(body.readUtf8().contains("\"code\":\"abcdefghijklmnop\""))
        }
    }
}
