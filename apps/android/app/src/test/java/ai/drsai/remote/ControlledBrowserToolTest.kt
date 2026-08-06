package ai.drsai.remote

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.runtime.tools.HttpControlledBrowserProvider
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import java.lang.reflect.Proxy
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ControlledBrowserToolTest {
    private lateinit var server: MockWebServer
    @Before fun setUp() { server = MockWebServer().also { it.start() } }
    @After fun tearDown() { server.shutdown() }

    @Test fun navigationReadsBoundedPassivePageAndDiscoversLinksAndForms() = runBlocking {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("""
            <html><head><title>Account</title><script>secret()</script></head><body>
            <main><h1>Welcome</h1><a href="/help">Help</a>
            <form action="/login" method="post"><input name="email" type="email"><input name="password" type="password"></form>
            </main></body></html>
        """.trimIndent()))
        val page = provider().navigate("alice", null, server.url("/").toString())
        assertEquals("Account", page.title)
        assertTrue(page.text.contains("Welcome"))
        assertFalse(page.text.contains("secret"))
        assertEquals(server.url("/help").toString(), page.links.single())
        assertEquals(setOf("email", "password"), page.forms.single().fields)
        assertTrue(page.forms.single().sensitive)
        assertEquals(page, providerWithNoStatePlaceholder(page))
    }

    @Test fun formSubmissionRequiresApprovalAndLoginCookieStaysSubjectIsolated() = runBlocking {
        val provider = provider()
        val registry = registry(provider)
        val capability = setOf(RuntimeCapability.BROWSER_SESSION)
        server.enqueue(MockResponse().setBody("""<form action="/login" method="post"><input name="user"><input name="password" type="password"></form>"""))
        val opened = registry.execute(
            ToolExecutionContext("alice", capability), "browser.navigate",
            JSONObject().put("url", server.url("/").toString()).toString(),
        ) as ToolExecutionOutcome.Success
        val session = JSONObject(opened.output).getString("session_id")
        val args = JSONObject().put("session_id", session).put("form_id", "form-0")
            .put("fields", JSONObject().put("user", "alice").put("password", "secret")).toString()
        assertTrue(registry.execute(ToolExecutionContext("alice", capability), "browser.submit", args) is ToolExecutionOutcome.ApprovalRequired)

        server.enqueue(MockResponse().setHeader("Set-Cookie", "auth=session-secret; HttpOnly").setBody("<h1>Logged in</h1>"))
        assertTrue(registry.execute(ToolExecutionContext("alice", capability, approved = true), "browser.submit", args) is ToolExecutionOutcome.Success)
        server.enqueue(MockResponse().setBody("<h1>Private account</h1>"))
        val next = provider.navigate("alice", session, server.url("/account").toString())
        assertTrue(next.text.contains("Private account"))
        server.takeRequest()
        server.takeRequest()
        assertEquals("auth=session-secret", server.takeRequest().getHeader("Cookie"))
        runCatching { provider.read("bob", session) }.onSuccess { throw AssertionError("cross-subject session read") }
        Unit
    }

    @Test fun downloadRequiresApprovalAndReturnsOnlyBoundedMetadata() = runBlocking {
        val provider = provider()
        val registry = registry(provider)
        val context = ToolExecutionContext("alice", setOf(RuntimeCapability.BROWSER_SESSION))
        server.enqueue(MockResponse().setBody("<h1>Files</h1>"))
        val opened = registry.execute(context, "browser.navigate", JSONObject().put("url", server.url("/").toString()).toString()) as ToolExecutionOutcome.Success
        val session = JSONObject(opened.output).getString("session_id")
        val args = JSONObject().put("session_id", session).put("url", server.url("/report.txt").toString()).toString()
        assertTrue(registry.execute(context, "browser.download", args) is ToolExecutionOutcome.ApprovalRequired)
        server.enqueue(MockResponse().setHeader("Content-Type", "text/plain").setHeader("Content-Disposition", "attachment; filename=report.txt").setBody("evidence"))
        val output = registry.execute(context.copy(approved = true), "browser.download", args) as ToolExecutionOutcome.Success
        val metadata = JSONObject(output.output)
        assertEquals(8L, metadata.getLong("size_bytes"))
        assertEquals(64, metadata.getString("sha256").length)
        assertEquals("report.txt", metadata.getString("file_name"))
        assertFalse(output.output.contains("evidence"))
    }

    @Test fun browserToolsAreHiddenWithoutValidatedNetworkCapability() {
        val registry = registry(provider())
        assertFalse(registry.definitions(ToolExecutionContext("a", emptySet())).any { it.id.startsWith("browser.") })
        val definitions = registry.definitions(ToolExecutionContext("a", setOf(RuntimeCapability.BROWSER_SESSION)))
            .filter { it.id.startsWith("browser.") }
        assertEquals(setOf("browser.navigate", "browser.read", "browser.submit", "browser.download"), definitions.map { it.id }.toSet())
        assertTrue(definitions.filter { it.id in setOf("browser.submit", "browser.download") }.all { it.toRuntimeSchema().getBoolean("requires_approval") })
    }

    @Test fun maliciousRedirectBinaryNavigationAndChunkedGiantResponseAreDenied() = runBlocking {
        val provider = provider()
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "file:///data/local/secret"))
        assertEquals("network_https_required", runCatching {
            provider.navigate("alice", null, server.url("/redirect").toString())
        }.exceptionOrNull()?.message)

        server.enqueue(MockResponse().setHeader("Content-Type", "image/png").setBody("png"))
        assertEquals("browser_content_type_denied", runCatching {
            provider.navigate("alice", null, server.url("/image").toString())
        }.exceptionOrNull()?.message)

        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setChunkedBody("x".repeat(2_000_001), 8_192))
        assertEquals("browser_response_too_large", runCatching {
            provider.navigate("alice", null, server.url("/giant").toString())
        }.exceptionOrNull()?.message)
    }

    private fun provider() = HttpControlledBrowserProvider(OkHttpClient(), allowHttpForTests = true)
    private fun registry(provider: HttpControlledBrowserProvider) = defaultLocalToolRegistry(
        dao(), browserProvider = provider, allowPrivateNetworkForTests = true,
    )
    private fun dao() = Proxy.newProxyInstance(ChatDao::class.java.classLoader, arrayOf(ChatDao::class.java)) { _, _, _ -> null } as ChatDao

    // Keeps the first test explicit that BrowserPage is a value-only, path-free snapshot.
    private fun providerWithNoStatePlaceholder(page: ai.drsai.remote.runtime.tools.BrowserPage) = page.copy()
}
