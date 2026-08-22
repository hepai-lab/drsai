package ai.drsai.remote

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.BingHtmlWebSearchProvider
import ai.drsai.remote.runtime.tools.FallbackWebSearchProvider
import ai.drsai.remote.runtime.tools.WebSearchItem
import ai.drsai.remote.runtime.tools.WebSearchProvider
import ai.drsai.remote.runtime.tools.WebSearchResponse
import ai.drsai.remote.runtime.tools.WikipediaWebSearchProvider
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.lang.reflect.Proxy
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WebSearchToolTest {
    private lateinit var server: MockWebServer

    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    @Test fun providerNormalizesEnglishAndChineseQueriesToStableResultSchema() = runBlocking {
        server.enqueue(MockResponse().setBody(fixture("HEPiX", "https://en.wikipedia.org/wiki/HEPiX")))
        server.enqueue(MockResponse().setBody(fixture("安卓", "https://zh.wikipedia.org/wiki/Android")))
        val provider = provider()

        listOf("HEPiX 2026", "安卓 智能体").forEach { query ->
            val result = provider.search(query, 3).toJson()
            assertEquals("p9-web-search-v1", result.getString("schema_version"))
            assertEquals("ok", result.getString("status"))
            assertEquals("wikipedia-fixture", result.getString("provider"))
            assertEquals(query, result.getString("query"))
            assertEquals("2026-08-05T00:00:00Z", result.getString("searched_at"))
            result.getJSONArray("results").getJSONObject(0).also { item ->
                assertTrue(item.getString("title").isNotBlank())
                assertTrue(item.getString("url").startsWith("https://"))
                assertEquals("2026-08-04T12:00:00Z", item.getString("last_modified_at"))
                assertEquals("wikipedia-fixture", item.getString("provider"))
            }
            assertEquals(query, server.takeRequest().requestUrl?.queryParameter("gsrsearch"))
        }
    }

    @Test fun emptyTimeoutHttpAndMalformedResponsesAreStructured() = runBlocking {
        server.enqueue(MockResponse().setBody("{}"))
        assertEquals("empty", provider().search("nothing", 5).status)

        server.enqueue(MockResponse().setResponseCode(503))
        provider().search("unavailable", 5).also {
            assertEquals("provider_error", it.status)
            assertEquals("http_503", it.errorCode)
        }

        server.enqueue(MockResponse().setBody("not-json"))
        provider().search("malformed", 5).also {
            assertEquals("provider_error", it.status)
            assertEquals("provider_response_invalid", it.errorCode)
        }

        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val timeoutProvider = provider(
            OkHttpClient.Builder().connectTimeout(100, TimeUnit.MILLISECONDS)
                .readTimeout(100, TimeUnit.MILLISECONDS).build(),
        )
        timeoutProvider.search("slow", 5).also {
            assertEquals("timeout", it.status)
            assertEquals("provider_timeout", it.errorCode)
        }
        Unit
    }

    @Test fun hostToolIsCapabilityGatedAndReturnsProviderEnvelope() = runBlocking {
        val dao = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, _, _ -> null } as ChatDao
        val provider = WebSearchProvider { query, limit ->
            WebSearchResponse(
                query, "fixture", "ok", "2026-08-05T00:00:00Z",
                listOf(WebSearchItem("Result", "https://example.test/result", "verified")),
            ).also { assertEquals(2, limit) }
        }
        val registry = defaultLocalToolRegistry(dao, webSearchProvider = provider)
        val offline = ToolExecutionContext("alice", emptySet())
        val online = ToolExecutionContext("alice", setOf(RuntimeCapability.WEB_SEARCH))
        assertFalse(registry.definitions(offline).any { it.id == "web.search" })
        assertTrue(registry.definitions(online).any { it.id == "web.search" })
        val schema = registry.toModelSchemas(online).let { schemas ->
            (0 until schemas.length()).map(schemas::getJSONObject).single { it.getString("name") == "web.search" }
        }
        assertEquals(listOf("web_search"), listOf(schema.getJSONArray("required_capabilities").getString(0)))
        val outcome = registry.execute(online, "web.search", """{"query":"HEPiX 2026","limit":2}""")
        val payload = JSONObject((outcome as ToolExecutionOutcome.Success).output)
        assertEquals("ok", payload.getString("status"))
        assertEquals("https://example.test/result", payload.getJSONArray("results").getJSONObject(0).getString("url"))
    }

    @Test fun bingProviderParsesBoundedDirectHttpsResultsAndFallbackSkipsFailure() = runBlocking {
        server.enqueue(MockResponse().setBody("""
            <ol id="b_results">
              <li class="b_algo"><div class="b_algoheader"><a href="https://example.org/hepix"><h2><strong>HEPiX</strong> 2026</h2></a></div><div class="b_caption"><p>Forum &amp; conference result</p></div></li>
              <li class="b_algo"><div class="b_algoheader"><a href="https://www.bing.com/internal"><h2>Internal</h2></a></div></li>
            </ol>
        """.trimIndent()))
        val bing = BingHtmlWebSearchProvider(
            endpoint = server.url("/search"),
            providerId = "bing-fixture",
            clock = { Instant.parse("2026-08-05T00:00:00Z") },
        )
        val response = FallbackWebSearchProvider(listOf(
            WebSearchProvider { query, _ -> WebSearchResponse(
                query, "empty-regional-html", "empty", "2026-08-05T00:00:00Z",
            ) },
            WebSearchProvider { query, _ -> WebSearchResponse(
                query, "down", "provider_error", "2026-08-05T00:00:00Z", errorCode = "http_503",
            ) },
            bing,
        )).search("HEPiX 2026", 1)
        assertEquals("ok", response.status)
        assertEquals("bing-fixture", response.provider)
        assertEquals(1, response.items.size)
        assertEquals("HEPiX 2026", response.items.single().title)
        assertEquals("Forum & conference result", response.items.single().snippet)
        assertEquals("HEPiX 2026", server.takeRequest().requestUrl?.queryParameter("q"))
    }

    private fun provider(http: OkHttpClient = OkHttpClient()) = WikipediaWebSearchProvider(
        http = http,
        endpoint = server.url("/w/api.php"),
        providerId = "wikipedia-fixture",
        clock = { Instant.parse("2026-08-05T00:00:00Z") },
    )

    private fun fixture(title: String, url: String) = JSONObject()
        .put("query", JSONObject().put("pages", org.json.JSONArray().put(
            JSONObject()
                .put("pageid", 1)
                .put("title", title)
                .put("fullurl", url)
                .put("extract", "A  normalized   search result")
                .put("revisions", org.json.JSONArray().put(
                    JSONObject().put("timestamp", "2026-08-04T12:00:00Z"),
                )),
        )))
        .toString()
}
