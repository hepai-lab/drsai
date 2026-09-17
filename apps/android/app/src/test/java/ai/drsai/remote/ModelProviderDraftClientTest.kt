package ai.drsai.remote

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelProviderDraftClient
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.OkHttpClient
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test fun connectionCheckVerifiesConfiguredModelsExist() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"deepseek-v4-flash"}]}"""))
        val report = ModelProviderDraftClient().testConnection(
            server.url("/v1").toString().trimEnd('/'), "openai", "secret", listOf("deepseek-v4-flash"),
        )
        assertEquals("CATALOG_VERIFIED", report.stage)
        assertEquals(listOf("deepseek-v4-flash"), report.verifiedModels)

        server.enqueue(MockResponse().setBody("""{"data":[{"id":"another-model"}]}"""))
        val missing = runCatching { ModelProviderDraftClient().testConnection(
            server.url("/v1").toString().trimEnd('/'), "openai", "secret", listOf("deepseek-v4-pro"),
        ) }.exceptionOrNull() as ApiException
        assertEquals("provider_model_not_found", missing.code)
        assertEquals(404, missing.status)
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
        assertEquals("The API key is invalid or expired", error?.message)
    }

    @Test fun providerHttpFailuresHaveActionableMessages() = runTest {
        val cases = listOf(
            402 to "Insufficient model service balance; check the account",
            403 to "This API key cannot access the model catalog",
            404 to "The API address is incorrect; model catalog not found",
            429 to "Requests are too frequent or quota is insufficient; try again later",
            500 to "The model service is temporarily unavailable",
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
        assertEquals("The model service returned an empty response", empty?.message)

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

        assertTrue(error is ApiException)
        assertEquals("provider_timeout", (error as ApiException).code)
        assertTrue(error.retryable)
    }

    @Test fun providerErrorBodyIsPreservedButCredentialsAreRedacted() = runTest {
        server.enqueue(MockResponse().setResponseCode(403).setBody(
            """{"error":{"message":"model access denied; api_key=sk-secret-secret"}}""",
        ))
        val error = runCatching {
            ModelProviderDraftClient().discover(server.url("/v1").toString().trimEnd('/'), "openai", "key")
        }.exceptionOrNull() as ApiException
        assertEquals("provider_permission_denied", error.code)
        assertTrue(error.message.orEmpty().contains("model access denied"))
        assertFalse(error.message.orEmpty().contains("sk-secret"))
    }

    @Test fun dnsAndTlsFailuresHaveStableNonMisleadingCodes() {
        val dns = ai.drsai.remote.data.ProviderConnectionFailureClassifier.classify(UnknownHostException("private-host")) as ApiException
        val tls = ai.drsai.remote.data.ProviderConnectionFailureClassifier.classify(SSLHandshakeException("certificate")) as ApiException
        assertEquals("provider_dns_failed", dns.code)
        assertEquals("provider_tls_failed", tls.code)
        assertTrue(dns.message!!.contains("API host"))
        assertTrue(tls.message!!.contains("TLS"))
    }
}
