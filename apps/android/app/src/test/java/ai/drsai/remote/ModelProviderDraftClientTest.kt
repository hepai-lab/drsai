package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelProviderDraftClient
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.OkHttpClient
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ModelProviderDraftClientTest {
    private lateinit var server: MockWebServer

    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    @Test fun openAiDiscoveryUsesBearerAndReturnsDistinctSortedModels() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"a-model"}]}"""))
        val result = ModelProviderDraftClient().discover(server.url("/v1").toString().trimEnd('/'), "openai", "secret")

        assertEquals(listOf("a-model", "z-model"), result)
        val request = server.takeRequest()
        assertEquals("/v1/models", request.path)
        assertEquals("Bearer secret", request.getHeader("Authorization"))
    }

    @Test fun anthropicConnectionCheckUsesProviderHeadersWithoutChangingModels() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        ModelProviderDraftClient().testConnection(server.url("").toString().trimEnd('/'), "anthropic", "anthropic-secret")

        val request = server.takeRequest()
        assertEquals("/v1/models", request.path)
        assertEquals("anthropic-secret", request.getHeader("x-api-key"))
        assertEquals("2023-06-01", request.getHeader("anthropic-version"))
    }

    @Test fun anthropicBaseUrlAlreadyEndingInV1DoesNotDuplicateVersionPath() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":[]}"""))
        ModelProviderDraftClient().discover(
            server.url("/v1").toString().trimEnd('/'), "anthropic", "anthropic-secret",
        )
        assertEquals("/v1/models", server.takeRequest().path)
    }

    @Test fun authenticationFailureHasActionableMessage() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        val error = runCatching {
            ModelProviderDraftClient().testConnection(server.url("/v1").toString().trimEnd('/'), "openai", "bad")
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals("API Key 无效或已过期", error?.message)
    }

    @Test fun providerHttpFailuresHaveActionableMessages() = runTest {
        val cases = listOf(
            403 to "当前 API Key 没有访问模型目录的权限",
            404 to "API 地址不正确，未找到模型目录",
            429 to "请求过于频繁或额度不足，请稍后重试",
            500 to "模型服务暂时不可用",
        )
        cases.forEach { (status, message) ->
            server.enqueue(MockResponse().setResponseCode(status).setBody("{}"))
            val error = runCatching {
                ModelProviderDraftClient().discover(server.url("/v1").toString().trimEnd('/'), "openai", "key")
            }.exceptionOrNull()
            assertTrue(error is ApiException)
            assertEquals(message, error?.message)
        }
    }

    @Test fun emptyAndMalformedCatalogResponsesFailWithoutChangingDraftInput() = runTest {
        val client = ModelProviderDraftClient()
        server.enqueue(MockResponse().setBody(""))
        val empty = runCatching {
            client.discover(server.url("/v1").toString().trimEnd('/'), "openai", "key")
        }.exceptionOrNull()
        assertEquals("模型服务返回了空响应", empty?.message)

        server.enqueue(MockResponse().setBody("not-json"))
        val malformed = runCatching {
            client.discover(server.url("/v1").toString().trimEnd('/'), "openai", "key")
        }.exceptionOrNull()
        assertTrue(malformed is org.json.JSONException)
    }

    @Test fun catalogTimeoutIsPropagatedForActionableViewModelMapping() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val http = OkHttpClient.Builder().connectTimeout(100, TimeUnit.MILLISECONDS).readTimeout(100, TimeUnit.MILLISECONDS).build()

        val error = runCatching {
            ModelProviderDraftClient(http).discover(server.url("/v1").toString().trimEnd('/'), "openai", "key")
        }.exceptionOrNull()

        assertTrue(error is SocketTimeoutException)
    }
}
