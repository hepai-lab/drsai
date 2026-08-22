package ai.drsai.remote

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.runtime.tools.HttpWebFetchProvider
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.lang.reflect.Proxy
import java.nio.charset.Charset
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WebFetchToolTest {
    private lateinit var server: MockWebServer
    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    @Test fun htmlExtractionRemovesScriptsSupportsEncodingAndFollowsHttpsRedirects() = runBlocking {
        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", server.url("/final")))
        server.enqueue(robotsAllowed())
        val html = """<html><head><meta charset="GBK"><title>中文页面</title><script>alert('secret')</script></head><body><nav>menu</nav><main><h1>标题</h1><p>正文 &amp; evidence</p></main></body></html>"""
        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(
            Buffer().write(html.toByteArray(Charset.forName("GBK"))),
        ))
        val result = provider().fetch(server.url("/start").toString())
        assertEquals("ok", result.status)
        assertEquals("中文页面", result.title)
        assertEquals("标题 正文 & evidence", result.content)
        assertEquals("GBK", result.encoding)
        assertFalse(result.content.contains("alert"))
        assertEquals(server.url("/final").toString(), result.finalUrl)
    }

    @Test fun pdfTextIsExtractedWithoutExecutingOrRenderingContent() = runBlocking {
        server.enqueue(robotsAllowed())
        val pdf = "%PDF-1.4\n1 0 obj << /Length 27 >>\nstream\nBT (Hello PDF) Tj ET\nendstream\nendobj\n%%EOF"
        server.enqueue(MockResponse().setHeader("Content-Type", "application/pdf").setBody(
            Buffer().write(pdf.toByteArray(Charsets.ISO_8859_1)),
        ))
        val result = provider().fetch(server.url("/document.pdf").toString())
        assertEquals("ok", result.status)
        assertEquals("application/pdf", result.contentType)
        assertEquals("Hello PDF", result.content)
    }

    @Test fun robotsAccessResponseSizeAndDowngradeAreRejectedStructurally() = runBlocking {
        server.enqueue(MockResponse().setBody("User-agent: *\nDisallow: /private"))
        assertEquals("robots_denied", provider().fetch(server.url("/private/data").toString()).errorCode)

        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setResponseCode(403))
        assertEquals("access_denied", provider().fetch(server.url("/forbidden").toString()).errorCode)

        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setHeader("Content-Type", "text/plain").setBody("x".repeat(2_000_001)))
        assertEquals("response_too_large", provider().fetch(server.url("/huge").toString()).errorCode)

        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://example.test/insecure"))
        assertEquals("redirect_https_required", provider().fetch(server.url("/redirect").toString()).errorCode)
    }

    @Test fun timeoutAndUnsupportedContentTypeAreStructured() = runBlocking {
        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val short = provider(OkHttpClient.Builder().readTimeout(100, TimeUnit.MILLISECONDS).build())
        val timeout = short.fetch(server.url("/slow").toString())
        assertEquals("timeout", timeout.status)
        assertEquals("fetch_timeout", timeout.errorCode)

        server.enqueue(robotsAllowed())
        server.enqueue(MockResponse().setHeader("Content-Type", "image/png").setBody("png"))
        assertEquals("content_type_unsupported", provider().fetch(server.url("/image").toString()).errorCode)
    }

    @Test fun hostToolIsOnlyVisibleWithFetchCapability() = runBlocking {
        val dao = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, _, _ -> null } as ChatDao
        val registry = defaultLocalToolRegistry(dao, webFetchProvider = ai.drsai.remote.runtime.tools.WebFetchProvider { url ->
            ai.drsai.remote.runtime.tools.WebFetchResponse(url, url, "ok", "2026-08-05T00:00:00Z", content = "verified")
        })
        assertFalse(registry.definitions(ToolExecutionContext("a", emptySet())).any { it.id == "web.fetch" })
        val context = ToolExecutionContext("a", setOf(RuntimeCapability.WEB_FETCH))
        assertTrue(registry.definitions(context).any { it.id == "web.fetch" })
        val outcome = registry.execute(context, "web.fetch", """{"url":"https://example.test"}""")
        assertEquals("verified", JSONObject((outcome as ToolExecutionOutcome.Success).output).getString("content"))
    }

    private fun provider(http: OkHttpClient = OkHttpClient()) = HttpWebFetchProvider(
        http, clock = { Instant.parse("2026-08-05T00:00:00Z") }, allowInsecureLoopbackForTests = true,
    )

    private fun robotsAllowed() = MockResponse().setBody("User-agent: *\nDisallow:")
}
