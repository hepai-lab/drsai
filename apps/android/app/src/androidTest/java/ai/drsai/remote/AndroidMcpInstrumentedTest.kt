package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.*
import ai.drsai.remote.runtime.tools.*
import ai.drsai.remote.workbench.model.RuntimeCapability
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidMcpInstrumentedTest {
    @Test fun encryptedConnectorGrantEnforcesScopesExpiryRevocationAndAccountIsolation() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var now = 1_000_000L
        val store = McpSecureConfigStore(context) { now }
        val endpoint = McpServerEndpoint("lifecycle", "https://example.com/mcp")
        val alice = "mcp-lifecycle-alice"
        val bob = "mcp-lifecycle-bob"
        store.remove(alice, endpoint.id)
        store.remove(bob, endpoint.id)

        store.save(
            alice,
            endpoint,
            "alice-secret",
            scopes = setOf(McpConnectorScope.DISCOVER.wireName, McpConnectorScope.CALL_READ.wireName),
            expiresAtEpochMs = now + 1_000,
        )
        store.save(
            bob,
            endpoint,
            "bob-secret",
            scopes = setOf(McpConnectorScope.DISCOVER.wireName),
            expiresAtEpochMs = now + 2_000,
        )
        assertEquals("alice-secret", store.token(alice, endpoint.id))
        assertEquals("bob-secret", store.token(bob, endpoint.id))
        assertFalse(store.list(alice).toString().contains("alice-secret"))
        store.requireScope(alice, endpoint.id, McpConnectorScope.CALL_READ.wireName)
        assertThrows(IllegalStateException::class.java) {
            store.requireScope(alice, endpoint.id, McpConnectorScope.CALL_WRITE.wireName)
        }
        assertThrows(IllegalStateException::class.java) {
            store.requireScope(bob, endpoint.id, McpConnectorScope.CALL_READ.wireName)
        }

        now += 1_001
        assertFalse(store.isActive(alice, endpoint.id))
        assertNull(store.token(alice, endpoint.id))
        assertEquals("bob-secret", store.token(bob, endpoint.id))
        assertThrows(IllegalStateException::class.java) {
            store.requireScope(alice, endpoint.id, McpConnectorScope.DISCOVER.wireName)
        }

        store.revoke(bob, endpoint.id)
        assertFalse(store.isActive(bob, endpoint.id))
        assertNull(store.token(bob, endpoint.id))
        assertFalse(store.list(bob).single().enabled)
        store.remove(alice, endpoint.id)
        store.remove(bob, endpoint.id)
    }

    @Test fun encryptedKotlinTransportDiscoversCallsAndProjectsMcpToolToOaep() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val subject = "mcp-instrumented-account-v2"
        MockWebServer().use { server ->
            server.enqueue(json("""{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"$ANDROID_MCP_PROTOCOL_VERSION","capabilities":{"tools":{}},"serverInfo":{"name":"device-test","version":"1"}}}""")
                .addHeader("MCP-Session-Id", "device-session"))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setChunkedBody(
                "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"echo\",\"description\":\"Echo\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"text\":{\"type\":\"string\"}},\"required\":[\"text\"]}}]}}\n\n",
                9,
            ))
            server.enqueue(json("""{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"device-ok"}],"isError":false}}"""))
            server.start()

            val endpoint = McpServerEndpoint.testOnly("device", server.url("/mcp").toString())
            val secureStore = McpSecureConfigStore(context)
            val persistedEndpoint = McpServerEndpoint("secure", "https://example.com/mcp")
            secureStore.save(subject, persistedEndpoint, "device-secret")
            assertEquals("device-secret", secureStore.token(subject, persistedEndpoint.id))
            val registry = ToolRegistry(allowPrivateNetworkForTests = true)
            val manager = AndroidMcpToolManager(registry)
            val client = McpStreamableHttpClient(
                endpoint, subject, McpBearerTokenProvider { _, _ -> secureStore.token(subject, persistedEndpoint.id) }, OkHttpClient(),
            )
            val tool = manager.connect(subject, client).single()
            val definition = registry.definitions(ToolExecutionContext(subject, setOf(RuntimeCapability.MCP))).single()
            assertEquals("mcp", definition.source)
            assertFalse(definition.toRuntimeSchema().toString().contains("device-secret"))
            val output = registry.execute(
                ToolExecutionContext(
                    subject,
                    setOf(RuntimeCapability.MCP),
                    approved = true,
                    runId = "mcp-test-run",
                    sessionId = "mcp-test-session",
                    toolCallId = "call-device",
                ),
                tool.modelName, "{\"text\":\"hello\"}",
            ) as ToolExecutionOutcome.Success
            assertTrue(output.output.contains("device-ok"))
            assertFalse(output.output.contains("device-secret"))

            val resultEnvelope = PythonRuntimeEnvelope(
                PythonRuntimeMessageType.RUNTIME_EVENT, "mcp-result", "run", "session", 4, "mcp:result",
                JSONObject().put("kind", "tool.result").put("call_id", "call-device")
                    .put("name", tool.modelName).put("output", output.output).put("succeeded", true),
            )
            val oaep = PythonRuntimeEventMapper.decode(resultEnvelope) as NormalizedAgentEvent.ItemCompleted
            assertEquals(tool.modelName, (oaep.content as OaepToolCallContent).toolName)

            assertEquals("Bearer device-secret", server.takeRequest().getHeader("Authorization"))
            server.takeRequest()
            assertEquals("device-session", server.takeRequest().getHeader("MCP-Session-Id"))
            val callRequest = server.takeRequest()
            assertEquals(ANDROID_MCP_PROTOCOL_VERSION, callRequest.getHeader("MCP-Protocol-Version"))
            assertFalse(callRequest.body.readUtf8().contains("device-secret"))
            secureStore.remove(subject, persistedEndpoint.id)
        }
    }

    private fun json(value: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(value)
}
