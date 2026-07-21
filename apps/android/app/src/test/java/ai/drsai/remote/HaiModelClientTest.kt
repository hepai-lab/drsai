package ai.drsai.remote

import ai.drsai.remote.data.*
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HaiModelClientTest {
    private lateinit var server: MockWebServer

    @Before fun startServer() { server = MockWebServer().also { it.start() } }
    @After fun stopServer() { server.shutdown() }

    @Test fun models_request_refreshes_once_after_401() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"deepseek-ai/deepseek-v4-pro","vision":false},{"id":"gpt-5.6-sol","model_info":{"vision":true}}]}"""))
        val store = FakeTokenStore("old", "refresh")
        val client = HaiModelClient(store, FakeTokenLifecycle(), server.url("/v1").toString())

        val models = client.listModels()
        assertEquals("deepseek-ai/deepseek-v4-pro", models.first().id)
        assertFalse(models.first().vision)
        assertTrue(models.last().vision)
        assertEquals("Bearer old", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer new", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun completion_parses_fragmented_text_and_tool_call_deltas() = runTest {
        val sse = """
            data: {"choices":[{"delta":{"role":"assistant","content":null},"finish_reason":null}]}

            data: {"choices":[{"delta":{"content":null}}]}

            data: {"choices":[{"delta":{"content":"你"}}]}

            data: {"choices":[{"delta":{"content":"好","tool_calls":[{"index":0,"id":"c1","function":{"name":"get_current_time","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}

            data: [DONE]

        """.trimIndent()
        server.enqueue(MockResponse().setChunkedBody(sse, 7).addHeader("Content-Type", "text/event-stream"))
        val deltas = mutableListOf<ModelDelta>()
        val client = HaiModelClient(FakeTokenStore("token", "refresh"), FakeTokenLifecycle(), server.url("/v1").toString())
        client.streamCompletion("model", listOf(RuntimeMessage("user", "hello")), true) { deltas += it }

        assertEquals("你好", deltas.mapNotNull { it.content }.joinToString(""))
        assertTrue(deltas.none { it.content == "null" || it.finishReason == "null" })
        assertEquals("get_current_time", deltas.flatMap { it.toolCalls }.single().name)
        val request = server.takeRequest()
        assertEquals("Bearer token", request.getHeader("Authorization"))
        assertTrue(request.body.readUtf8().contains("\"tools\""))
    }

    @Test fun completion_serializes_openai_multimodal_image_content() = runTest {
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        val client = HaiModelClient(FakeTokenStore("token", "refresh"), FakeTokenLifecycle(), server.url("/v1").toString())
        client.streamCompletion(
            "vision-model",
            listOf(RuntimeMessage("user", "看图", images = listOf(RuntimeImage("image/jpeg", "data:image/jpeg;base64,YQ==")))),
            false,
        ) {}
        val body = server.takeRequest().body.readUtf8()
        assertTrue(body.contains("\"type\":\"image_url\""))
        assertTrue(body.contains("data:image/jpeg;base64,YQ=="))
    }

    @Test fun model_only_receives_tools_available_for_the_current_workspace() = runTest {
        repeat(2) {
            server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        }
        val store = FakeTokenStore("token", "refresh")
        val lifecycle = FakeTokenLifecycle()
        val withoutWorkspace = HaiModelClient(
            store, lifecycle, baseUrl = server.url("/v1").toString(),
            availableToolNames = { setOf("get_current_time", "get_device_info") },
        )
        withoutWorkspace.streamCompletion("model", listOf(RuntimeMessage("user", "hello")), true) {}
        val first = server.takeRequest().body.readUtf8()
        assertTrue(first.contains("get_device_info"))
        assertFalse(first.contains("workspace.read"))

        val withWorkspace = HaiModelClient(
            store, lifecycle, baseUrl = server.url("/v1").toString(),
            availableToolNames = { setOf("workspace.read") },
        )
        withWorkspace.streamCompletion("model", listOf(RuntimeMessage("user", "hello")), true) {}
        val second = server.takeRequest().body.readUtf8()
        assertTrue(second.contains("workspace.read"))
        assertFalse(second.contains("get_device_info"))
    }

    @Test fun image_schema_rejection_becomes_clear_non_retryable_error() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(400).setBody(
                """{"error":{"type":"invalid_request_error","message":"messages[4]: unknown variant `image_url`, expected `text`"}}""",
            ),
        )
        val client = HaiModelClient(FakeTokenStore("token", "refresh"), FakeTokenLifecycle(), server.url("/v1").toString())
        val error = runCatching {
            client.streamCompletion(
                "deepseek-ai/deepseek-v4-pro",
                listOf(RuntimeMessage("user", "看图", images = listOf(RuntimeImage("image/jpeg", "data:image/jpeg;base64,YQ==")))),
                false,
            ) {}
        }.exceptionOrNull() as ApiException

        assertEquals(400, error.status)
        assertEquals("当前 HAI 模型不支持图片输入，请切换到视觉模型", error.message)
        assertFalse(error.retryable)
    }
}

private class FakeTokenStore(
    override var accessToken: String?,
    override var refreshToken: String?,
) : AuthTokenStore {
    override fun save(auth: AuthTokens) {
        accessToken = auth.accessToken
        refreshToken = auth.refreshToken
    }
}

private class FakeTokenLifecycle : TokenLifecycleClient {
    override suspend fun refresh(refreshToken: String) = AuthTokens("new", "new-refresh", User("u1"))
    override suspend fun revoke(refreshToken: String) = Unit
}
