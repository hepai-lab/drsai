package ai.drsai.remote

import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.parseAccessGrantCode
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.associationErrorMessage
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
import org.json.JSONObject
import java.io.File

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
        assertEquals(
            "A_secure-code_123456",
            parseAccessGrantCode(
                "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            ),
        )
        assertEquals(
            "Dev_secure-code_1234",
            parseAccessGrantCode(
                "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=Dev_secure-code_1234",
                "https://ai-dev.ihep.ac.cn",
            ),
        )
        kotlin.runCatching { parseAccessGrantCode("short") }.onSuccess { error("short grant accepted") }
        kotlin.runCatching { parseAccessGrantCode("../../secret-secret") }.onSuccess { error("path grant accepted") }
        listOf(
            "opendrsai://associate?v=2&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=http%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fevil.example&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456&code=Duplicate_code_123",
            "opendrsai://associate/extra?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate:123?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
        ).forEach { invalid ->
            kotlin.runCatching { parseAccessGrantCode(invalid) }.onSuccess { error("invalid grant accepted: $invalid") }
        }
    }

    @Test fun `association derives principal only from bearer token`() = runTest {
        server.enqueue(MockResponse().setBody("{\"runtime_id\":\"rt-associated\"}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        assertEquals("rt-associated", service.associate("abcdefghijklmnop").value)
        server.takeRequest().apply {
            assertEquals("Bearer token", getHeader("Authorization")); assertEquals(null, getHeader("X-Subject"))
            val bodyText = body.readUtf8()
            assertTrue(bodyText.contains("\"code\":\"abcdefghijklmnop\""))
            assertTrue(!bodyText.contains("opendrsai://"))
        }
    }

    @Test fun `association refreshes expired oidc token exactly once`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"code\":\"oidc_auth_invalid\"}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"runtime_id\":\"rt-refreshed\"}"))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "expired" }, {
            refreshes += 1
            "fresh"
        })
        assertEquals("rt-refreshed", service.associate("abcdefghijklmnop").value)
        assertEquals(1, refreshes)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `association errors have stable user messages`() {
        assertEquals("二维码已过期，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_expired")))
        assertEquals("二维码已使用，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_consumed")))
        assertEquals("二维码已撤销，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_revoked")))
        assertEquals("HepAI 登录已过期，请重新登录", associationErrorMessage(RelayHttpException(401, "c", "oidc_auth_invalid")))
        assertEquals("操作过于频繁，请稍后重试", associationErrorMessage(RelayHttpException(429, "c")))
        assertEquals("二维码环境与当前应用不一致", associationErrorMessage(IllegalArgumentException("access_grant_environment_mismatch")))
    }

    @Test fun `association reads structured relay error without exposing scanned payload`() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setHeader("X-Correlation-Id", "corr-safe")
            .setBody("{\"code\":\"access_grant_expired\",\"message\":\"expired\"}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        val failure = runCatching { service.associate("abcdefghijklmnop") }.exceptionOrNull() as RelayHttpException
        assertEquals("access_grant_expired", failure.errorCode)
        assertEquals("corr-safe", failure.correlationId)
        assertTrue(!failure.message.orEmpty().contains("abcdefghijklmnop"))
    }

    @Test fun `shared pairing fixtures parse without drift`() {
        val candidates = listOf(
            File("../../../protocol/relay/mobile-pairing-fixtures.json"),
            File("../../protocol/relay/mobile-pairing-fixtures.json"),
            File("protocol/relay/mobile-pairing-fixtures.json"),
        )
        val fixtureFile = candidates.firstOrNull(File::isFile) ?: error("shared pairing fixtures not found")
        val fixtures = JSONObject(fixtureFile.readText())
        val valid = fixtures.getJSONArray("valid")
        repeat(valid.length()) { index ->
            val item = valid.getJSONObject(index)
            assertEquals(item.getString("code"), parseAccessGrantCode(item.getString("payload"), item.getString("issuer")))
        }
        val invalid = fixtures.getJSONArray("invalid")
        repeat(invalid.length()) { index ->
            kotlin.runCatching { parseAccessGrantCode(invalid.getString(index)) }
                .onSuccess { error("invalid shared fixture accepted") }
        }
    }
}
