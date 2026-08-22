package ai.drsai.remote

import ai.drsai.remote.runtime.tools.*
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AndroidMcpClientTest {
    @Test fun connectorAuthorizerControlsDiscoveryReadScopeExpiryAndRevocation() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1)))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(json(toolListResult(2)))
            server.enqueue(json("""{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"authorized"}]}}"""))
            server.enqueue(MockResponse().setResponseCode(200))
            server.start()
            var active = true
            val scopes = linkedSetOf(McpConnectorScope.DISCOVER.wireName, McpConnectorScope.CALL_READ.wireName)
            val authorizer = object : McpConnectorAuthorizer {
                override fun isActive(accountSubject: String, serverId: String) = active && accountSubject == "alice"
                override fun requireScope(accountSubject: String, serverId: String, scope: String) {
                    check(isActive(accountSubject, serverId)) { "mcp_connector_revoked" }
                    check(scope in scopes) { "mcp_connector_scope_denied:$scope" }
                }
            }
            val registry = ToolRegistry()
            val manager = AndroidMcpToolManager(registry, authorizer)
            val tool = manager.connect("alice", client(server)).single()
            val context = ToolExecutionContext(
                "alice", setOf(RuntimeCapability.MCP), approved = true,
                runId = "run", sessionId = "session", toolCallId = "call",
            )
            assertEquals(ToolExecutionOutcome.Success::class, registry.execute(context, tool.modelName, "{\"city\":\"Beijing\"}")::class)

            scopes.remove(McpConnectorScope.CALL_READ.wireName)
            assertEquals(
                "mcp_connector_scope_denied:tools:call:read",
                (registry.execute(context, tool.modelName, "{\"city\":\"Beijing\"}") as ToolExecutionOutcome.Rejected).code,
            )
            active = false
            assertTrue(registry.definitions(context).isEmpty())
            assertEquals("tool_not_available", (registry.execute(context, tool.modelName, "{}") as ToolExecutionOutcome.Rejected).code)
            manager.disconnect("alice", "weather")
            assertEquals("tool_not_registered", (registry.execute(context, tool.modelName, "{}") as ToolExecutionOutcome.Rejected).code)
        }
    }

    @Test fun jsonTransportNegotiatesSessionListsAndCallsToolsWithoutLeakingToken() {
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1)).addHeader("MCP-Session-Id", "session-1"))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(json(toolListResult(2)))
            server.enqueue(json("""{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"sunny"}],"isError":false}}"""))
            server.start()
            val client = client(server, token = "secret-token")

            val tool = client.listTools().single()
            assertEquals("mcp.weather.get_weather", tool.modelName)
            val output = client.call(tool, JSONObject().put("city", "Beijing"))
            assertTrue(output.contains("sunny"))
            assertFalse(output.contains("secret-token"))

            val initialize = server.takeRequest()
            assertEquals("Bearer secret-token", initialize.getHeader("Authorization"))
            assertNull(initialize.getHeader("MCP-Protocol-Version"))
            val initialized = server.takeRequest()
            assertEquals("session-1", initialized.getHeader("MCP-Session-Id"))
            assertEquals(ANDROID_MCP_PROTOCOL_VERSION, initialized.getHeader("MCP-Protocol-Version"))
            val list = server.takeRequest()
            assertEquals(MCP_ACCEPT_FOR_TEST, list.getHeader("Accept"))
            assertEquals("session-1", list.getHeader("MCP-Session-Id"))
            val call = JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("tools/call", call.getString("method"))
            assertEquals("get_weather", call.getJSONObject("params").getString("name"))
            assertFalse(call.toString().contains("secret-token"))
        }
    }

    @Test fun sseResponseSupportsFragmentationAndCursorBasedResumeAfterDisconnect() {
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1)).addHeader("MCP-Session-Id", "session-sse"))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setChunkedBody("id: cursor-1\ndata:\n\n", 3))
            server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
                .setChunkedBody("data: ${toolListResult(2)}\n\n", 7))
            server.start()

            assertEquals("get_weather", client(server).listTools().single().remoteName)
            server.takeRequest()
            server.takeRequest()
            server.takeRequest()
            val resumed = server.takeRequest()
            assertEquals("GET", resumed.method)
            assertEquals("cursor-1", resumed.getHeader("Last-Event-ID"))
            assertEquals("session-sse", resumed.getHeader("MCP-Session-Id"))
        }
    }

    @Test fun expiredSessionReinitializesAndRetriesOriginalRequest() {
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1)).addHeader("MCP-Session-Id", "session-old"))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(MockResponse().setResponseCode(404))
            server.enqueue(json(initializeResult(3)).addHeader("MCP-Session-Id", "session-new"))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(json(toolListResult(2)))
            server.start()

            assertEquals("get_weather", client(server).listTools().single().remoteName)
            val requests = List(6) { server.takeRequest() }
            assertEquals("session-old", requests[2].getHeader("MCP-Session-Id"))
            assertEquals("initialize", JSONObject(requests[3].body.readUtf8()).getString("method"))
            assertNull(requests[3].getHeader("MCP-Session-Id"))
            assertEquals("session-new", requests[5].getHeader("MCP-Session-Id"))
            assertEquals("tools/list", JSONObject(requests[5].body.readUtf8()).getString("method"))
        }
    }

    @Test fun authVersionContentTypeAndEndpointPolicyFailClosed() {
        assertThrows(IllegalArgumentException::class.java) { McpServerEndpoint("bad", "http://example.com/mcp") }
        assertThrows(IllegalArgumentException::class.java) { McpServerEndpoint("bad", "https://127.0.0.1/mcp") }
        assertThrows(IllegalArgumentException::class.java) { McpServerEndpoint("bad", "https://example.com:8443/mcp") }

        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401))
            server.start()
            assertThrows(IllegalStateException::class.java) { client(server).initialize() }
        }
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1, protocol = "2025-06-18")))
            server.start()
            assertThrows(IllegalArgumentException::class.java) { client(server).initialize() }
        }
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "text/plain").setBody("no"))
            server.start()
            assertThrows(IllegalStateException::class.java) { client(server).initialize() }
        }
    }

    @Test fun discoveredMcpToolUsesMcpSourceCapabilityApprovalAndAccountScope() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(json(initializeResult(1)))
            server.enqueue(MockResponse().setResponseCode(202))
            server.enqueue(json(toolListResult(2)))
            server.enqueue(json("""{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"ok"}]}}"""))
            server.start()
            val registry = ToolRegistry()
            val manager = AndroidMcpToolManager(registry)
            manager.connect("alice", client(server))
            val context = ToolExecutionContext(
                "alice", setOf(RuntimeCapability.MCP), runId = "run", sessionId = "session", toolCallId = "call",
            )
            val definition = registry.definitions(context).single()
            assertEquals("mcp", definition.source)
            assertEquals(ToolRisk.SENSITIVE, definition.risk)
            assertTrue(definition.toRuntimeSchema().getBoolean("requires_approval"))
            assertTrue(registry.execute(context, definition.id, "{\"city\":\"Beijing\"}") is ToolExecutionOutcome.ApprovalRequired)
            val success = registry.execute(context.copy(approved = true), definition.id, "{\"city\":\"Beijing\"}")
            assertTrue(success is ToolExecutionOutcome.Success)
            val denied = registry.execute(
                ToolExecutionContext(
                    "bob", setOf(RuntimeCapability.MCP), approved = true,
                    runId = "run", sessionId = "session", toolCallId = "call",
                ), definition.id, "{\"city\":\"x\"}",
            )
            assertEquals("tool_not_registered", (denied as ToolExecutionOutcome.Rejected).code)
        }
    }

    @Test fun mcpToolResultUsesExistingOaepToolTimelineProjection() {
        val envelope = PythonRuntimeEnvelope(
            PythonRuntimeMessageType.RUNTIME_EVENT, "mcp-result", "run", "session", 4, "mcp:result",
            JSONObject().put("kind", "tool.result").put("call_id", "call-1")
                .put("name", "mcp.weather.get_weather").put("output", "{\"content\":[]}")
                .put("succeeded", true).put("source", "mcp"),
        )
        val event = PythonRuntimeEventMapper.decode(envelope) as NormalizedAgentEvent.ItemCompleted
        val content = event.content as OaepToolCallContent
        assertEquals("mcp.weather.get_weather", content.toolName)
        assertEquals("call-1", content.callId)
    }

    private fun client(server: MockWebServer, token: String? = null) = McpStreamableHttpClient(
        McpServerEndpoint.testOnly("weather", server.url("/mcp").toString()),
        "alice", McpBearerTokenProvider { _, _ -> token },
        OkHttpClient.Builder().readTimeout(5, TimeUnit.SECONDS).build(),
    )

    private fun json(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)

    private fun initializeResult(id: Int, protocol: String = ANDROID_MCP_PROTOCOL_VERSION) =
        """{"jsonrpc":"2.0","id":$id,"result":{"protocolVersion":"$protocol","capabilities":{"tools":{}},"serverInfo":{"name":"test","version":"1"}}}"""

    private fun toolListResult(id: Int) =
        """{"jsonrpc":"2.0","id":$id,"result":{"tools":[{"name":"get_weather","title":"Weather","description":"Get weather","annotations":{"readOnlyHint":true},"inputSchema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]}}"""

    companion object { private const val MCP_ACCEPT_FOR_TEST = "application/json, text/event-stream" }
}
