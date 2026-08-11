package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.OkHttpClient
import java.net.SocketTimeoutException
import java.io.File
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RelayRemoteRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: RelayRemoteRepository
    @Before fun start() { server = MockWebServer().also { it.start() }; repository = RelayRemoteRepository(server.url("/").toString(), { "token" }) }
    @After fun stop() = server.shutdown()

    @Test fun `push registration uses device-bound endpoint without token echo`() = runTest {
        server.enqueue(MockResponse().setBody(
            """{"runtime_id":"rt","device_summary":"dev_0123456789ab","provider":"fcm","generation":4,"status":"active","updated_at":"2026-08-05T00:00:00Z"}"""
        ))
        val rawToken = "provider-token-" + "x".repeat(64)

        val result = repository.upsertPushRegistration(RuntimeId("rt"), "fcm", rawToken, 4)

        assertEquals("active", result.status)
        assertEquals(4, result.generation)
        assertFalse(result.toString().contains(rawToken))
        server.takeRequest().apply {
            assertEquals("PUT", method)
            assertEquals("/v1/associations/rt/push-registration", path)
            assertEquals("Bearer token", getHeader("Authorization"))
            val payload = JSONObject(body.readUtf8())
            assertEquals("fcm", payload.getString("provider"))
            assertEquals(rawToken, payload.getString("token"))
            assertEquals(4, payload.getLong("generation"))
        }
    }

    @Test fun `push registration revoke is runtime scoped`() = runTest {
        server.enqueue(MockResponse().setBody(
            """{"runtime_id":"rt","device_summary":"dev_0123456789ab","provider":"fcm","generation":4,"status":"revoked","updated_at":"2026-08-05T00:01:00Z"}"""
        ))

        val result = repository.revokePushRegistration(RuntimeId("rt"))

        assertEquals("revoked", result.status)
        server.takeRequest().apply {
            assertEquals("DELETE", method)
            assertEquals("/v1/associations/rt/push-registration", path)
        }
    }

    @Test fun `session paging remains runtime workspace scoped`() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[{"runtime_id":"rt","workspace_id":"ws","session_id":"s","title":"T","backend_id":"codex","agent_definition_id":"a","agent_definition_version":"1","last_run_status":"running","updated_at":"now","lifecycle":"active"}],"next_cursor":"1"}"""))
        val page = repository.sessions(RuntimeId("rt"), WorkspaceId("ws"), query = "T")
        assertEquals("s", page.items.single().reference.sessionId.value); assertEquals("1", page.nextCursor)
        assertEquals("Bearer token", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `repository refreshes one expired bearer and retries once`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"code":"invalid_token"}"""))
        server.enqueue(MockResponse().setBody("""{"items":[],"next_cursor":null}"""))
        repository = RelayRemoteRepository(
            server.url("/").toString(),
            { "expired" },
            refreshAfter = { failed -> if (failed == "expired") "refreshed" else null },
        )

        assertTrue(repository.agentDefinitions(RuntimeId("rt")).isEmpty())
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer refreshed", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `safe get retries once on transient transport failure`() = runTest {
        var failFirstGet = true
        val transientClient = OkHttpClient.Builder().addInterceptor { chain ->
            if (failFirstGet && chain.request().method == "GET") {
                failFirstGet = false
                throw SocketTimeoutException("transient response timeout")
            }
            chain.proceed(chain.request())
        }.build()
        repository = RelayRemoteRepository(
            server.url("/").toString(),
            { "token" },
            transientClient,
        )
        server.enqueue(
            MockResponse().setBody(
                """{"items":[{"definition_id":"agent","version":"1","display_name":"Agent","backend_id":"opendrsai","backend_health":"healthy","capabilities":[]}]}"""
            )
        )

        assertEquals("agent", repository.agentDefinitions(RuntimeId("rt")).single().id)
        assertEquals(1, server.requestCount)
    }

    @Test fun `session lifecycle parsing filters archived and removed rows`() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[
            {"runtime_id":"rt","workspace_id":"ws","session_id":"active","title":"Active","backend_id":"opendrsai","agent_definition_id":"a","agent_definition_version":"1","last_run_status":"running","updated_at":"2026-07-26T10:00:00Z","lifecycle":"active"},
            {"runtime_id":"rt","workspace_id":"ws","session_id":"archived","title":"Archived","backend_id":"opendrsai","agent_definition_id":"a","agent_definition_version":"1","last_run_status":null,"updated_at":"2026-07-26T09:00:00Z","lifecycle":"archived"},
            {"runtime_id":"rt","workspace_id":"ws","session_id":"removed","title":"Removed","backend_id":"opendrsai","agent_definition_id":"a","agent_definition_version":"1","last_run_status":null,"updated_at":"2026-07-26T08:00:00Z","lifecycle":"removed"}
        ],"next_cursor":null}"""))

        val page = repository.sessions(RuntimeId("rt"), WorkspaceId("ws"))

        assertEquals(listOf("active"), page.items.map { it.reference.sessionId.value })
        assertEquals("active", server.takeRequest().requestUrl?.queryParameter("lifecycle"))
    }

    @Test fun `conversation endpoint loads stable paged Windows transcript`() = runTest {
        server.enqueue(MockResponse().setBody("""{"items":[
            {"item_id":"user:run-1","sequence":1,"kind":"message.user","timestamp":"2026-07-26T10:00:00Z","payload":{"content":"Windows question","run_id":"run-1"}},
            {"item_id":"event-1","sequence":2,"kind":"message.delta","timestamp":"2026-07-26T10:00:01Z","payload":{"delta":"Windows answer","run_id":"run-1"}}
        ],"next_cursor":"2"}"""))

        val page = repository.conversation(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), limit = 100)

        assertEquals(listOf("message.user", "message.delta"), page.items.map { it.kind })
        assertEquals("Windows question", page.items.first().payload["content"])
        assertEquals("2", page.nextCursor)
        server.takeRequest().apply {
            assertEquals("/v1/runtimes/rt/workspaces/ws/sessions/session/conversation?limit=100", path)
            assertEquals("Bearer token", getHeader("Authorization"))
        }
    }

    @Test fun `session snapshot and replay events preserve authoritative sequence`() = runTest {
        server.enqueue(MockResponse().setBody("""{
          "session_id":"session","snapshot_sequence":3,
          "items":[{"item_id":"item-1","session_id":"session","run_id":"run-1","kind":"message",
            "role":"user","revision":1,"session_sequence":1,"source_client":"windows",
            "source_message_id":"windows-1","created_at":"now","updated_at":"now",
            "payload":{"text":"hello"}}],"next_cursor":null
        }"""))
        val snapshot = repository.conversationSnapshot(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"),
        )
        assertEquals(3, snapshot.snapshotSequence)
        assertEquals("windows-1", snapshot.items.single().sourceMessageId)
        assertTrue(server.takeRequest().path!!.endsWith("/oaep-snapshot?limit=100"))

        server.enqueue(MockResponse().setBody("""{"items":[{
          "event_id":"event-4","runtime_id":"rt","workspace_id":"ws","session_id":"session",
          "run_id":"run-2","session_sequence":4,"kind":"run.created","timestamp":"now",
          "payload":{"source_client":"android","source_message_id":"android-1"}
        }],"next_cursor":null}"""))
        val replay = repository.sessionEvents(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), 3,
        )
        assertEquals(4, replay.items.single().sessionSequence)
        assertEquals("android-1", replay.items.single().payload["source_message_id"])
        server.takeRequest().apply {
            assertTrue(path!!.contains("/oaep-events?"))
            assertEquals("3", requestUrl?.queryParameter("after_sequence"))
        }
    }

    @Test fun `capability negotiation prefers complete OAEP and rejects partial advertisement`() = runTest {
        server.enqueue(MockResponse().setBody("""{
          "capabilities":["oaep.v1","oaep.session.snapshot","oaep.session.events",
            "oaep.session.events.stream","event.cursor_expired"],
          "profiles":["oaep.session-stream/1","session-events/1"],
          "protocols":{"oaep":{"version":"1.0","profiles":["oaep.session-stream/1"]},
            "owop":{"version":"1.0"}}
        }"""))
        val selected = repository.protocolSelection(RuntimeId("rt"))
        assertTrue(selected.oaep)
        assertTrue(selected.legacySessionEvents)
        assertTrue(selected.owop)
        assertEquals("oaep", selected.selected)
        assertEquals(ai.drsai.remote.remote.generated.OaepContract.VERSION, selected.version)
        assertEquals(ai.drsai.remote.remote.generated.OaepContract.SCHEMA_SHA256, selected.schemaHash)
        assertEquals(null, selected.fallbackReason)
        assertEquals(null, selected.upgradeAction)

        server.enqueue(MockResponse().setBody("""{
          "capabilities":["oaep.v1"],"profiles":["session-events/1"],
          "protocols":{"oaep":{"version":"1.0","profiles":[]}}
        }"""))
        assertEquals("oaep_capability_partial", runCatching {
            repository.protocolSelection(RuntimeId("rt"))
        }.exceptionOrNull()?.message)
    }

    @Test fun `shared Runtime Relay client version matrix has explicit outcomes`() = runTest {
        val matrixFile = listOf(
            File("../../../cores/protocol/relay/oaep-version-matrix.json"),
            File("../../cores/protocol/relay/oaep-version-matrix.json"),
            File("cores/protocol/relay/oaep-version-matrix.json"),
        ).firstOrNull(File::isFile) ?: error("OAEP version matrix fixture missing")
        val cases = JSONObject(matrixFile.readText()).getJSONArray("cases")
        repeat(cases.length()) { index ->
            val case = cases.getJSONObject(index)
            val response = JSONObject()
                .put("capabilities", case.getJSONArray("capabilities"))
                .put("protocols", case.getJSONObject("protocols"))
            server.enqueue(MockResponse().setBody(response.toString()))
            val result = runCatching { repository.protocolSelection(RuntimeId("rt")) }
            when (case.getString("expected")) {
                "oaep" -> assertEquals(case.getString("name"), "oaep", result.getOrThrow().selected)
                "legacy" -> result.getOrThrow().also { selected ->
                    assertEquals(case.getString("name"), "legacy", selected.selected)
                    assertEquals("oaep_unavailable", selected.fallbackReason)
                    assertEquals("upgrade_runtime", selected.upgradeAction)
                }
                "unavailable" -> assertEquals(
                    "remote_session_protocol_unavailable", result.exceptionOrNull()?.message,
                )
                "reject" -> assertEquals("oaep_capability_partial", result.exceptionOrNull()?.message)
            }
        }
    }

    @Test fun `native OAEP snapshot and page reject legacy guessing`() = runTest {
        server.enqueue(MockResponse().setBody("""{
          "version":"1.0",
          "session":{"id":"session","workspace_id":"ws","title":"T","status":"active",
            "backend":"opendrsai","created_at":"now","updated_at":"now"},
          "runs":[{"id":"run-1","session_id":"session","parent_run_id":null,"status":"running",
            "created_at":"now","updated_at":"now","completed_at":null}],
          "items":[{"id":"item-1","session_id":"session","run_id":"run-1","type":"message",
            "status":"completed","sequence":1,"created_at":"now","updated_at":"now",
            "source":{"backend":"opendrsai"},"content":{"role":"user","text":"hello"}}],
          "snapshot_sequence":3
        }"""))
        val snapshot = repository.oaepSnapshot(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"),
        )
        assertEquals("item-1", snapshot.items.single().id)
        assertEquals("message", snapshot.items.single().type)
        server.takeRequest().requestUrl!!.also { requestUrl ->
            assertEquals(
                "/v1/runtimes/rt/workspaces/ws/sessions/session/oaep-snapshot",
                requestUrl.encodedPath,
            )
            assertEquals("100", requestUrl.queryParameter("limit"))
        }

        server.enqueue(MockResponse().setBody("""{
          "version":"1.0","object":"list","data":[{
            "version":"1.0","event_id":"event-4","session_id":"session","run_id":"run-1",
            "sequence":4,"type":"event.run.started","timestamp":"now","dedupe_key":"event-4",
            "source":{"backend":"runtime","runtime_id":"rt"},"data":{}
          }],"next_sequence":4,"has_more":false
        }"""))
        val page = repository.oaepEvents(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), 3,
        )
        assertEquals(4, page.data.single().sequence)
        server.takeRequest().requestUrl!!.also { requestUrl ->
            assertEquals(
                "/v1/runtimes/rt/workspaces/ws/sessions/session/oaep-events",
                requestUrl.encodedPath,
            )
            assertEquals("3", requestUrl.queryParameter("after_sequence"))
            assertEquals("500", requestUrl.queryParameter("limit"))
        }

        server.enqueue(MockResponse().setBody(
            """{"session_id":"session","snapshot_sequence":3,"items":[]}""",
        ))
        assertTrue(runCatching {
            repository.oaepSnapshot(RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"))
        }.isFailure)
        assertEquals(
            "/v1/runtimes/rt/workspaces/ws/sessions/session/oaep-snapshot",
            server.takeRequest().requestUrl!!.encodedPath,
        )
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
        val body = JSONObject(server.takeRequest().body.readUtf8())
        assertFalse(body.toString().contains("sdcard"))
        assertEquals("idem-run", body.getString("idempotency_key"))
        assertEquals("idem-run", body.getString("source_message_id"))
        server.enqueue(MockResponse().setBody("""{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","backend_id":"codex","status":"cancelled"}"""))
        assertEquals("cancelled", repository.cancel(run))
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

    @Test fun `approval lost response retries with one stable idempotency key`() = runTest {
        server.enqueue(MockResponse().setBody("""{"status":"approved"}""")
            .setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setBody("""{"status":"approved"}"""))

        assertEquals("approved", repository.decide(RuntimeId("rt"), ApprovalId("approval-1"), "approve"))

        val first = JSONObject(server.takeRequest().body.readUtf8())
        val second = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("approval:approval-1:approve", first.getString("idempotency_key"))
        assertEquals(first.getString("idempotency_key"), second.getString("idempotency_key"))
        assertNotEquals(first.getString("request_id"), second.getString("request_id"))
        assertEquals(2, server.requestCount)
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

    @Test fun `uncertain run recovery tolerates runtime restart without reposting`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"code":"runtime_offline"}"""))
        server.enqueue(MockResponse().setBody("""{"status":"succeeded","operation":"run.create","resource":{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"r","backend_id":"opendrsai"}}"""))

        assertNull(repository.recoverRun(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "stable-key"))
        assertEquals(
            "r",
            repository.recoverRun(RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "stable-key")?.runId?.value,
        )
        repeat(2) {
            val request = server.takeRequest()
            assertEquals("GET", request.method)
            assertEquals("/v1/runtimes/rt/idempotency/run.create/stable-key", request.path)
        }
    }

    @Test fun `twenty caller retries keep one source message and idempotency identity`() = runTest {
        val response = """{"runtime_id":"rt","workspace_id":"ws","session_id":"s","run_id":"same-run","backend_id":"opendrsai"}"""
        repeat(20) { server.enqueue(MockResponse().setBody(response)) }
        val session = RemoteSessionRef(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"), "T", "opendrsai",
        )

        val runs = (1..20).map {
            repository.createRun(
                session, "hello", emptyList(), "stable-source-message",
                sourceMessageId = "stable-source-message",
            )
        }

        assertEquals(setOf("same-run"), runs.map { it.runId.value }.toSet())
        repeat(20) {
            val body = JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("stable-source-message", body.getString("idempotency_key"))
            assertEquals("stable-source-message", body.getString("source_message_id"))
        }
    }

    @Test fun `conversation latency report is content free and event correlated`() = runTest {
        server.enqueue(MockResponse().setResponseCode(204))

        repository.recordConversationLatency(
            RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"),
            eventId = "event-one", stage = "client_render", durationMs = 4.25,
        )

        val request = server.takeRequest()
        assertEquals(
            "/v1/runtimes/rt/workspaces/ws/sessions/s/conversation-latency",
            request.path,
        )
        val body = JSONObject(request.body.readUtf8())
        assertEquals("event-one", body.getString("correlation_id"))
        assertEquals("event-one", body.getString("operation_id"))
        assertEquals("client_render", body.getString("stage"))
        assertEquals(setOf("correlation_id", "operation_id", "stage", "duration_ms"), body.keySet())
        val invalidStage = runCatching {
            repository.recordConversationLatency(
                RuntimeId("rt"), WorkspaceId("ws"), SessionId("s"),
                eventId = "event-one", stage = "message", durationMs = 1.0,
            )
        }.exceptionOrNull()
        assertTrue(invalidStage is IllegalArgumentException)
    }
}
