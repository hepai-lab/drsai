package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.OkHttpClient
import java.net.SocketTimeoutException
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RelayRemoteRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: RelayRemoteRepository
    @Before fun start() { server = MockWebServer().also { it.start() }; repository = RelayRemoteRepository(server.url("/").toString(), { "token" }) }
    @After fun stop() = server.shutdown()

    @Test fun `session paging remains runtime workspace scoped`() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[{"runtime_id":"rt","workspace_id":"ws","session_id":"s","title":"T","backend_id":"codex","agent_definition_id":"a","agent_definition_version":"1","last_run_status":"running","updated_at":"now","lifecycle":"active"}],"next_cursor":"1"}"""))
        val page = repository.sessions(RuntimeId("rt"), WorkspaceId("ws"), query = "T")
        assertEquals("s", page.items.single().reference.sessionId.value); assertEquals("1", page.nextCursor)
        assertEquals("Bearer token", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `exact healthy definition creates session and stable idempotency header body`() = runTest {
        server.enqueue(MockResponse().setBody("""{"runtime_id":"rt","workspace_id":"ws","session_id":"s","title":"T","backend_id":"codex"}"""))
        val definition = RemoteAgentDefinition("a", "1.2.3", "Agent", "codex", "healthy", setOf("chat"))
        assertEquals("s", repository.createSession(RuntimeId("rt"), WorkspaceId("ws"), "T", definition, "idem-session").sessionId.value)
        assertTrue(server.takeRequest().body.readUtf8().contains("\"idempotency_key\":\"idem-session\""))
    }

    @Test fun `run sends attachment references never local path and cancel is scoped`() = runTest {
        val session = RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "T", "codex")
        server.enqueue(MockResponse().setBody("""{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","backend_id":"codex"}"""))
        val run = repository.createRun(session, "hi", listOf("att_1"), "idem-run")
        assertFalse(server.takeRequest().body.readUtf8().contains("sdcard"))
        server.enqueue(MockResponse().setBody("{}")); repository.cancel(run)
        assertTrue(server.takeRequest().path!!.contains("/workspaces/ws/runs/r/cancel"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `latest definition is rejected before network`() = runTest {
        repository.createSession(RuntimeId("rt"), WorkspaceId("ws"), "T",
            RemoteAgentDefinition("a", "latest", "A", "codex", "healthy", emptySet()), "idem-session")
    }

    @Test fun `session timeout queries idempotency result before any retry`() = runTest {
        var failFirstPost = true
        val timeoutClient = OkHttpClient.Builder().addInterceptor { chain ->
            if (failFirstPost && chain.request().method == "POST") {
                failFirstPost = false
                throw SocketTimeoutException("response lost")
            }
            chain.proceed(chain.request())
        }.build()
        repository = RelayRemoteRepository(server.url("/").toString(), { "token" }, timeoutClient)
        server.enqueue(MockResponse().setBody("""{"status":"succeeded","operation":"session.create","resource":{"runtime_id":"rt","workspace_id":"ws","session_id":"recovered","title":"T","backend_id":"opendrsai"}}"""))

        val session = repository.createSession(
            RuntimeId("rt"), WorkspaceId("ws"), "T",
            RemoteAgentDefinition("a", "1.2.3", "Agent", "opendrsai", "healthy", setOf("chat")),
            "stable-idempotency-key",
        )

        assertEquals("recovered", session.sessionId.value)
        assertEquals("/v1/runtimes/rt/idempotency/session.create/stable-idempotency-key", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }

    @Test fun `foreground approval refresh is read only and audit remains scoped`() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","approval_id":"a","agent_definition_id":"agent","backend_id":"opendrsai","operation":"shell.execute","risk_summary":"run command","scope":"workspace","expires_at":"2026-01-01T00:00:00Z","correlation_id":"corr","status":"pending"}]}"""))
        val approvals = repository.approvals(RuntimeId("rt"), WorkspaceId("ws"))
        val approvalRequest = server.takeRequest()
        assertEquals("GET", approvalRequest.method)
        assertEquals("a", approvals.single().approvalId.value)
        assertEquals(0L, approvalRequest.bodySize)

        server.enqueue(MockResponse().setBody("""{"items":[{"audit_id":"aud","runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","action":"approval.approved","subject":"alice","timestamp":"2026-01-01T00:00:00Z","correlation_id":"corr","approval_id":"a"}]}"""))
        val audit = repository.audit(RuntimeId("rt"), WorkspaceId("ws"), RunId("r"))
        assertEquals("corr", audit.single().correlationId)
        assertTrue(server.takeRequest().path!!.endsWith("/audit?run_id=r"))
    }

    @Test fun `session run history and rest events retain complete authority scope`() = runTest {
        server.enqueue(MockResponse().setBody("""{"runtime_id":"rt","workspace_id":"ws","session_id":"s","title":"Remote","backend_id":"opendrsai","agent_definition_id":"a","agent_definition_version":"1","updated_at":"now","lifecycle":"active","last_run_status":"completed"}"""))
        assertEquals("Remote", repository.session(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s")).title)

        server.enqueue(MockResponse().setBody("""{"items":[{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","backend_id":"opendrsai","status":"completed","correlation_id":"corr","created_at":"now","retry_of":null,"message":"hello","attachment_refs":[]}],"next_cursor":null}"""))
        val run = repository.runs(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s")).items.single()
        assertEquals("hello", run.message)

        server.enqueue(MockResponse().setBody("""{"items":[{"event_id":"e","sequence":1,"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","kind":"message.delta","timestamp":"now","payload":{"delta":"world"}}],"next_cursor":null}"""))
        val event = repository.events(run.identity).items.single()
        assertEquals("world", event.payload.getString("delta"))
        assertEquals(run.identity, event.event.identity)
    }

    @Test fun `run timeout queries authoritative idempotency result without duplicate post`() = runTest {
        var failFirstPost = true
        val timeoutClient = OkHttpClient.Builder().addInterceptor { chain ->
            if (failFirstPost && chain.request().method == "POST") {
                failFirstPost = false
                throw SocketTimeoutException("response lost")
            }
            chain.proceed(chain.request())
        }.build()
        repository = RelayRemoteRepository(server.url("/").toString(), { "token" }, timeoutClient)
        server.enqueue(MockResponse().setBody("""{"status":"succeeded","operation":"run.create","resource":{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","backend_id":"opendrsai","status":"queued","correlation_id":"c","created_at":"now","message":"hello","attachment_refs":[]}}"""))
        val session = RemoteSessionRef(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "T", "opendrsai")

        assertEquals("r", repository.createRun(session, "hello", emptyList(), "stable-run-key").runId.value)
        assertEquals("/v1/runtimes/rt/idempotency/run.create/stable-run-key", server.takeRequest().path)
        assertEquals(1, server.requestCount)
    }
}
