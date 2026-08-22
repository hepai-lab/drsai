package ai.drsai.remote

import ai.drsai.remote.data.*
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

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
        val client = HaiModelClient(
            FakeTokenStore("token", "refresh"), FakeTokenLifecycle(), server.url("/v1").toString(),
            requestTemperature = 0.0,
        )
        client.streamCompletionWithTools(
            "model", listOf(RuntimeMessage("user", "hello")), schemas("get_current_time"),
        ) { deltas += it }

        assertEquals("你好", deltas.mapNotNull { it.content }.joinToString(""))
        assertTrue(deltas.none { it.content == "null" || it.finishReason == "null" })
        assertEquals("get_current_time", deltas.flatMap { it.toolCalls }.single().name)
        val request = server.takeRequest()
        assertEquals("Bearer token", request.getHeader("Authorization"))
        val requestBody = JSONObject(request.body.readUtf8())
        assertTrue(requestBody.has("tools"))
        assertEquals(0.0, requestBody.getDouble("temperature"), 0.0)
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
        val withoutWorkspace = HaiModelClient(store, lifecycle, baseUrl = server.url("/v1").toString())
        withoutWorkspace.streamCompletionWithTools(
            "model", listOf(RuntimeMessage("user", "hello")), schemas("get_current_time", "get_device_info"),
        ) {}
        val first = server.takeRequest().body.readUtf8()
        assertTrue(first.contains("get_device_info"))
        assertFalse(first.contains("workspace.read"))

        val withWorkspace = HaiModelClient(store, lifecycle, baseUrl = server.url("/v1").toString())
        withWorkspace.streamCompletionWithTools(
            "model", listOf(RuntimeMessage("user", "hello")), schemas("workspace.read"),
        ) {}
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

    @Test fun customOpenAiProviderUsesConfiguredHostCredentialAndUpstreamModel() = runTest {
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-model-id", "vendor/model-v2"), "provider-secret",
        )
        val client = HaiModelClient(
            FakeTokenStore("oidc-token", "refresh"), FakeTokenLifecycle(), providerStore = resolver,
        )

        client.streamCompletionWithTools(
            "stable-model-id", listOf(RuntimeMessage("user", "hello")), schemas("workspace.read"),
        ) {}

        val request = server.takeRequest()
        assertEquals("/v1/chat/completions", request.path)
        assertEquals("Bearer provider-secret", request.getHeader("Authorization"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals("vendor/model-v2", body.getString("model"))
        assertEquals("workspace__dot__read", body.getJSONArray("tools").getJSONObject(0)
            .getJSONObject("function").getString("name"))
    }

    @Test fun customProviderRetriesOneTransient503BeforeStreaming() = runTest {
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        val resolver = FakeModelConfigurationResolver(
            provider("openai").copy(displayName = "智增增"),
            configuredModel("stable-retry", "deepseek-v4-pro"),
            "provider-secret",
        )
        val deltas = mutableListOf<ModelDelta>()

        HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
            .streamCompletionWithTools(
                "stable-retry", listOf(RuntimeMessage("user", "hello")), JSONArray(),
            ) { deltas += it }

        assertEquals(2, server.requestCount)
        assertEquals("ok", deltas.mapNotNull(ModelDelta::content).joinToString(""))
    }

    @Test fun customProvider503ErrorNamesActualProviderAndRoute() = runTest {
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(503))
        val resolver = FakeModelConfigurationResolver(
            provider("openai").copy(displayName = "智增增"),
            configuredModel("stable-error-route", "deepseek-v4-pro"),
            "provider-secret",
        )

        val error = runCatching {
            HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
                .streamCompletionWithTools(
                    "stable-error-route", listOf(RuntimeMessage("user", "hello")), JSONArray(),
                ) {}
        }.exceptionOrNull() as ApiException

        assertEquals(2, server.requestCount)
        assertTrue(error.message.contains("智增增"))
        assertTrue(error.message.contains("HTTP 503"))
        assertTrue(error.message.contains("deepseek-v4-pro"))
        assertFalse(error.message.contains("HAI"))
    }

    @Test fun anthropicProviderStreamsTextAndToolCallsUsingAnthropicContract() = runTest {
        val sse = listOf(
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}",
            "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool-1\",\"name\":\"workspace__dot__read\"}}",
            "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}",
            "data: {\"type\":\"message_stop\"}",
        ).joinToString("\n\n", postfix = "\n\n")
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream").setChunkedBody(sse, 11))
        val resolver = FakeModelConfigurationResolver(
            provider("anthropic"), configuredModel("stable-claude", "claude-upstream"), "anthropic-secret",
        )
        val deltas = mutableListOf<ModelDelta>()
        HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
            .streamCompletionWithTools(
                "stable-claude", listOf(RuntimeMessage("system", "system"), RuntimeMessage("user", "hello")),
                schemas("workspace.read"),
            ) { deltas += it }

        val request = server.takeRequest()
        assertEquals("/v1/messages", request.path)
        assertEquals("anthropic-secret", request.getHeader("x-api-key"))
        assertEquals("2023-06-01", request.getHeader("anthropic-version"))
        assertEquals(null, request.getHeader("Authorization"))
        val body = JSONObject(request.body.readUtf8())
        assertEquals("claude-upstream", body.getString("model"))
        assertEquals("system", body.getString("system"))
        assertEquals("workspace__dot__read", body.getJSONArray("tools").getJSONObject(0).getString("name"))
        assertEquals("hello", deltas.mapNotNull(ModelDelta::content).joinToString(""))
        val calls = deltas.flatMap(ModelDelta::toolCalls)
        assertEquals("workspace.read", calls.first().name)
        assertTrue(calls.last().arguments.contains("README.md"))
    }

    @Test fun providerErrorBodiesNeverExposeApiKeysToUiErrors() = runTest {
        val leaked = "sk-ant-api03-never-show-this-secret"
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":{"message":"invalid key $leaked"}}"""))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-error", "upstream"), "provider-secret",
        )

        val error = runCatching {
            HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
                .streamCompletionWithTools("stable-error", listOf(RuntimeMessage("user", "hello")), JSONArray()) {}
        }.exceptionOrNull() as ApiException

        assertFalse(error.message.contains(leaked))
        assertTrue(error.message.contains("[REDACTED_API_KEY]"))
    }

    @Test fun providerToolSchemaRejectionHasStableNonRetryableCompatibilityCode() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setBody(
            """{"error":{"message":"invalid tools function parameters schema"}}""",
        ))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-schema-error", "upstream"), "provider-secret",
        )

        val error = runCatching {
            HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
                .streamCompletionWithTools(
                    "stable-schema-error", listOf(RuntimeMessage("user", "hello")), schemas("workspace.read"),
                ) {}
        }.exceptionOrNull() as ApiException

        assertEquals(400, error.status)
        assertEquals("model_tool_schema_rejected", error.code)
        assertFalse(error.retryable)
        assertTrue(error.message.contains("工具 Schema"))
    }

    @Test fun pinnedRunKeepsOriginalUpstreamModelAfterConfiguredDefaultChanges() = runTest {
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"))
        val resolver = MutableModelConfigurationResolver(
            provider("openai"), configuredModel("stable-pin", "vendor/original"), "provider-secret",
        )
        val client = HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
        val route = client.pinModelRoute("stable-pin")
        resolver.model = configuredModel("stable-pin", "vendor/new-default")

        client.streamCompletionWithPinnedRoute(
            "stable-pin", route, listOf(RuntimeMessage("user", "hello")), schemas("workspace.read"),
            JSONObject().put("policy_version", "p9-tool-choice-v1").put("mode", "auto"),
        ) {}

        assertEquals("vendor/original", JSONObject(server.takeRequest().body.readUtf8()).getString("model"))
    }

    @Test fun deletedProviderCredentialFailsExplicitlyInsteadOfFallingBackToHepai() = runTest {
        val resolver = MutableModelConfigurationResolver(
            provider("openai"), configuredModel("stable-deleted", "vendor/original"), "provider-secret",
        )
        val client = HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
        val route = client.pinModelRoute("stable-deleted")
        resolver.key = null

        val error = runCatching {
            client.streamCompletionWithPinnedRoute(
                "stable-deleted", route, listOf(RuntimeMessage("user", "hello")), schemas("workspace.read"),
                JSONObject().put("policy_version", "p9-tool-choice-v1").put("mode", "auto"),
            ) {}
        }.exceptionOrNull() as ApiException

        assertEquals("model_provider_credentials_missing", error.code)
        assertEquals(0, server.requestCount)
    }

    @Test fun interruptedProviderStreamFailsClearlyInsteadOfPretendingSuccess() = runTest {
        server.enqueue(MockResponse().setBody("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-interrupted", "upstream"), "provider-secret",
        )

        val error = runCatching {
            HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
                .streamCompletionWithTools("stable-interrupted", listOf(RuntimeMessage("user", "hello")), JSONArray()) {}
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals("model_stream_interrupted", (error as ApiException).code)
        assertTrue(error.retryable)
        assertEquals("模型流在完成前中断", error.message)
    }

    @Test fun completedProviderStreamWithoutContentToolOrSummaryFailsExplicitly() = runTest {
        server.enqueue(MockResponse().setBody("data: [DONE]\n\n"))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-empty", "upstream"), "provider-secret",
        )

        val error = runCatching {
            HaiModelClient(FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver)
                .streamCompletionWithTools("stable-empty", listOf(RuntimeMessage("user", "hello")), JSONArray()) {}
        }.exceptionOrNull() as ApiException

        assertEquals(0, error.status)
        assertEquals("model_empty_response", error.code)
        assertTrue(error.retryable)
        assertTrue(error.message.isNotBlank())
    }

    @Test fun cancellingActiveProviderRequestStopsTheNetworkCallPromptly() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.NO_RESPONSE))
        val resolver = FakeModelConfigurationResolver(
            provider("openai"), configuredModel("stable-cancel", "upstream"), "provider-secret",
        )
        val client = HaiModelClient(
            FakeTokenStore("oidc", "refresh"), FakeTokenLifecycle(), providerStore = resolver,
        )
        val request = async(Dispatchers.Default) {
            runCatching {
                client.streamCompletionWithTools(
                    "stable-cancel", listOf(RuntimeMessage("user", "hello")), JSONArray(),
                ) {}
            }.exceptionOrNull()
        }
        assertTrue(server.takeRequest(2, TimeUnit.SECONDS) != null)

        client.cancelActive()
        val error = withTimeout(2_000) { request.await() }

        assertTrue(error is ApiException)
    }

    private fun schemas(vararg names: String) = JSONArray(names.map { name ->
        JSONObject().put("name", name).put("description", name)
            .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
    })

    private fun provider(wireApi: String) = ModelProviderEntity(
        "provider", "custom", "Provider", server.url("/v1").toString().trimEnd('/'), wireApi,
        false, true, 1, 1, 1,
    )

    private fun configuredModel(id: String, upstreamId: String) = ProviderModelEntity(
        id, "provider", upstreamId, upstreamId, false, true, false, null, null, true, "MANUAL", 0,
    )
}

private class FakeModelConfigurationResolver(
    private val provider: ModelProviderEntity,
    private val model: ProviderModelEntity,
    private val key: String,
) : ModelConfigurationResolver {
    override suspend fun resolveModel(modelId: String) =
        if (modelId == model.id) provider to model else null
    override fun apiKey(providerId: String) = key.takeIf { providerId == provider.id }
}

private class MutableModelConfigurationResolver(
    private val provider: ModelProviderEntity,
    var model: ProviderModelEntity,
    var key: String?,
) : ModelConfigurationResolver {
    override suspend fun resolveModel(modelId: String) =
        if (modelId == model.id) provider to model else null
    override fun apiKey(providerId: String) = key.takeIf { providerId == provider.id }
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
