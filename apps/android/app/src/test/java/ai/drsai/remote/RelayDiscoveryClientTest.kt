package ai.drsai.remote

import ai.drsai.remote.remote.data.HttpRelayDiscoveryService
import ai.drsai.remote.remote.data.parseAccessGrantCode
import ai.drsai.remote.remote.data.RelayHttpException
import ai.drsai.remote.remote.data.associationErrorMessage
import ai.drsai.remote.remote.data.compatibleWindowsRuntimeVersion
import ai.drsai.remote.remote.data.runtimeConnectionState
import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.security.RelayAssociationDevice
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.RelayDeviceKeyRotation
import ai.drsai.remote.remote.security.RelayDeviceSigner
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.json.JSONObject
import java.io.File

class RelayDiscoveryClientTest {
    private lateinit var server: MockWebServer

    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    @Test fun `authorized runtime discovery parses identity generation and cursor`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[{"runtime":{"runtime_id":"rt-a","instance_id":"boot-2","version":"1.4.6",
            "protocol_version":"owop/1","status":"degraded","connection_generation":2},"display_name":"Office"}],
            "next_cursor":"20"}
        """.trimIndent()).setResponseCode(200))
        val service = HttpRelayDiscoveryService(server.url("/api/runtime-relay").toString(), { "oidc-token" })
        val page = service.listRuntimes(cursor = "0", query = "Office")
        assertEquals("rt-a", page.items.single().reference.runtimeId.value)
        assertEquals(RemoteConnectionState.INCOMPATIBLE, page.items.single().state)
        assertEquals(2, page.items.single().connectionGeneration)
        assertEquals("20", page.nextCursor)
        server.takeRequest().apply {
            assertEquals("Bearer oidc-token", getHeader("Authorization"))
            assertEquals("0", requestUrl?.queryParameter("cursor"))
            assertEquals("Office", requestUrl?.queryParameter("query"))
        }
    }

    @Test fun `workspace page is runtime scoped and supports empty state`() = runTest {
        server.enqueue(MockResponse().setBody("{\"items\":[],\"next_cursor\":null}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        val empty = service.listWorkspaces(RuntimeId("rt-a"))
        assertTrue(empty.items.isEmpty())
        assertNull(empty.nextCursor)
    }

    @Test fun `unassociated runtime discovery retries bearer only after explicit invalid device proof`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody(
            """{"code":"invalid_device_proof","correlation_id":"safe-correlation"}"""
        ))
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"items":[],"next_cursor":null}"""
        ))
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(),
            { "token" },
            deviceProof = RelayDeviceProof(
                CapturingSigner(),
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-0123456789abcdef" },
            ),
        )

        assertTrue(service.listRuntimes().items.isEmpty())

        server.takeRequest().apply {
            assertEquals("android.test-device", getHeader("X-Relay-Device-Id"))
            assertEquals("Bearer token", getHeader("Authorization"))
        }
        server.takeRequest().apply {
            assertNull(getHeader("X-Relay-Device-Id"))
            assertNull(getHeader("X-Relay-Device-Signature"))
            assertEquals("Bearer token", getHeader("Authorization"))
        }
    }

    @Test fun `runtime discovery does not downgrade non device authentication failures`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody(
            """{"code":"invalid_token"}"""
        ))
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"items":[],"next_cursor":null}"""
        ))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(),
            { "expired" },
            refreshAfter = {
                refreshes += 1
                "fresh"
            },
            deviceProof = RelayDeviceProof(
                CapturingSigner(),
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-0123456789abcdef" },
            ),
        )

        assertTrue(service.listRuntimes().items.isEmpty())
        assertEquals(1, refreshes)
        listOf("Bearer expired", "Bearer fresh").forEach { expected ->
            server.takeRequest().apply {
                assertEquals(expected, getHeader("Authorization"))
                assertEquals("android.test-device", getHeader("X-Relay-Device-Id"))
            }
        }
    }

    @Test fun `catalog DTO ignores absolute paths process data and credentials`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {"items":[{"runtime":{"runtime_id":"rt-a","instance_id":"boot","version":"1.5.3",
                "protocol_version":"2.0.0","status":"online","connection_generation":1,
                "last_seen_at":"2026-07-28T00:00:00Z","pid":4242,"internal_port":18642,
                "credential":"runtime-secret"},"display_name":"Office",
                "windows_path":"C:\\Users\\private"}],"next_cursor":null}
                """.trimIndent(),
            )
        )
        server.enqueue(
            MockResponse().setBody(
                """
                {"items":[{"runtime_id":"rt-a","workspace_id":"ws","display_name":"Project",
                "lifecycle":"active","revision":1,"updated_at":"2026-07-28T00:00:00Z",
                "absolute_path":"C:\\Users\\private\\project","ssh_key":"secret"}],
                "next_cursor":null}
                """.trimIndent(),
            )
        )
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })

        val runtime = service.listRuntimes().items.single()
        val workspace = service.listWorkspaces(RuntimeId("rt-a")).items.single()
        val projection = "$runtime $workspace"

        assertEquals("2026-07-28T00:00:00Z", runtime.lastSeenAt)
        assertEquals("Project", workspace.displayName)
        assertEquals(false, projection.contains("C:\\Users"))
        assertEquals(false, projection.contains("runtime-secret"))
        assertEquals(false, projection.contains("18642"))
        assertEquals(false, projection.contains("4242"))
        assertEquals(
            setOf(
                "reference", "instanceId", "version", "protocolVersion",
                "connectionGeneration", "state", "capabilities", "lastSeenAt",
            ),
            runtime::class.java.declaredFields.map { it.name }.filterNot {
                it.startsWith("$")
            }.toSet(),
        )
    }

    @Test fun `runtime compatibility follows the version declared by the connected windows owner`() {
        assertTrue(compatibleWindowsRuntimeVersion("1.5.3"))
        assertTrue(compatibleWindowsRuntimeVersion("1.5.4"))
        assertTrue(compatibleWindowsRuntimeVersion("2.0.0"))
        assertEquals(false, compatibleWindowsRuntimeVersion("1.4.7"))
        assertEquals(false, compatibleWindowsRuntimeVersion("1.5.3-rc1"))
        assertEquals(false, compatibleWindowsRuntimeVersion("unknown"))
    }

    @Test fun `paused runtime remains recognizable and is not treated as incompatible`() {
        assertEquals(RemoteConnectionState.PAUSED, runtimeConnectionState("paused", "1.5.3"))
    }

    @Test fun `workspace page sends bounded limit and opaque cursor`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[{"runtime_id":"rt-a","workspace_id":"active","display_name":"Active",
            "lifecycle":"active","revision":3,"updated_at":"2026-07-26T10:00:00Z"}],
            "next_cursor":"opaque-page-two"}
        """.trimIndent()))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })

        val page = service.listWorkspacePage(
            RuntimeId("rt-a"),
            cursor = "opaque-page-one",
            limit = 1,
        )

        assertEquals("opaque-page-two", page.nextCursor)
        server.takeRequest().requestUrl?.apply {
            assertEquals("opaque-page-one", queryParameter("cursor"))
            assertEquals("1", queryParameter("limit"))
            assertEquals("active", queryParameter("lifecycle"))
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `workspace page rejects invalid limit before network`() = runTest {
        HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .listWorkspacePage(RuntimeId("rt-a"), limit = 0)
    }

    @Test fun `workspace lifecycle is parsed and only active rows survive defensively`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[
              {"runtime_id":"rt-a","workspace_id":"active","display_name":"Active","lifecycle":"active","revision":3,"updated_at":"2026-07-26T10:00:00Z"},
              {"runtime_id":"rt-a","workspace_id":"archived","display_name":"Archived","lifecycle":"archived","revision":4,"updated_at":"2026-07-26T11:00:00Z"},
              {"runtime_id":"rt-a","workspace_id":"removed","display_name":"Removed","lifecycle":"removed","revision":5,"updated_at":"2026-07-26T12:00:00Z"}
            ],"next_cursor":null}
        """.trimIndent()))

        val page = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .listWorkspaces(RuntimeId("rt-a"))

        assertEquals(listOf("active"), page.items.map { it.workspaceId.value })
        assertEquals(3, page.items.single().revision)
        assertEquals("active", server.takeRequest().requestUrl?.queryParameter("lifecycle"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `workspace response from another runtime fails closed`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"items":[{"runtime_id":"rt-b","workspace_id":"ws","display_name":"Wrong"}],"next_cursor":null}
        """.trimIndent()))
        HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .listWorkspaces(RuntimeId("rt-a"))
    }

    @Test fun `manual workspace sync posts once and returns one atomic active revision`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"runtime_id":"rt-a","catalog_revision":"9","synced_at":"2026-07-28T04:00:00Z",
             "items":[
               {"runtime_id":"rt-a","workspace_id":"active","display_name":"Project",
                "lifecycle":"active","revision":4,"updated_at":"2026-07-28T03:59:59Z",
                "absolute_path":"C:\\private","credential":"secret"},
               {"runtime_id":"rt-a","workspace_id":"archived","display_name":"Old",
                "lifecycle":"archived","revision":5,"updated_at":"2026-07-28T03:59:58Z"}
             ]}
        """.trimIndent()))
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(),
            { "token" },
            deviceProof = RelayDeviceProof(
                CapturingSigner(),
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-0123456789abcdef" },
            ),
        )

        val result = service.syncWorkspaces(RuntimeId("rt-a"))

        assertEquals("9", result.catalogRevision)
        assertEquals("2026-07-28T04:00:00Z", result.syncedAt)
        assertEquals(listOf("active"), result.items.map { it.workspaceId.value })
        assertEquals(false, result.toString().contains("C:\\private"))
        assertEquals(false, result.toString().contains("secret"))
        server.takeRequest().apply {
            assertEquals("POST", method)
            assertEquals("/v1/runtimes/rt-a/workspaces/sync", path)
            assertEquals("{}", body.readUtf8())
            assertEquals("Bearer token", getHeader("Authorization"))
            assertEquals("android.test-device", getHeader("X-Relay-Device-Id"))
        }
        assertEquals(1, server.requestCount)
    }

    @Test fun `manual workspace sync keeps structured offline and timeout failures`() = runTest {
        server.enqueue(MockResponse().setResponseCode(503)
            .setBody("""{"code":"host_offline","correlation_id":"offline-safe"}"""))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })

        val failure = runCatching {
            service.syncWorkspaces(RuntimeId("rt-a"))
        }.exceptionOrNull() as RelayHttpException

        assertEquals(503, failure.status)
        assertEquals("host_offline", failure.errorCode)
        assertEquals("offline-safe", failure.correlationId)
        assertEquals(1, server.requestCount)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `manual workspace sync rejects cross runtime projection`() = runTest {
        server.enqueue(MockResponse().setBody("""
            {"runtime_id":"rt-b","catalog_revision":"1","synced_at":"2026-07-28T04:00:00Z","items":[]}
        """.trimIndent()))
        HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .syncWorkspaces(RuntimeId("rt-a"))
    }

    @Test fun `401 refreshes and replays exactly once`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"items\":[],\"next_cursor\":null}"))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "expired" }, { failed ->
            refreshes += 1
            assertEquals("expired", failed)
            "fresh"
        })
        assertTrue(service.listRuntimes().items.isEmpty())
        assertEquals(1, refreshes)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
        assertEquals(2, server.requestCount)
    }

    @Test fun `plain access grant is strictly validated`() {
        assertEquals("abcdefghijklmnop", parseAccessGrantCode("abcdefghijklmnop"))
        assertEquals(
            "A_secure-code_123456",
            parseAccessGrantCode(
                "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            ),
        )
        assertEquals(
            "Dev_secure-code_1234",
            parseAccessGrantCode(
                "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=Dev_secure-code_1234",
                "https://ai-dev.ihep.ac.cn",
            ),
        )
        kotlin.runCatching { parseAccessGrantCode("short") }.onSuccess { error("short grant accepted") }
        kotlin.runCatching { parseAccessGrantCode("../../secret-secret") }.onSuccess { error("path grant accepted") }
        listOf(
            "opendrsai://associate?v=2&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=http%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fevil.example&code=A_secure-code_123456",
            "opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456&code=Duplicate_code_123",
            "opendrsai://associate/extra?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
            "opendrsai://associate:123?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456",
        ).forEach { invalid ->
            kotlin.runCatching { parseAccessGrantCode(invalid) }.onSuccess { error("invalid grant accepted: $invalid") }
        }
    }

    @Test fun `association derives principal only from bearer token`() = runTest {
        server.enqueue(MockResponse().setBody("{\"runtime_id\":\"rt-associated\"}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        assertEquals("rt-associated", service.associate("abcdefghijklmnop").value)
        server.takeRequest().apply {
            assertEquals("Bearer token", getHeader("Authorization")); assertEquals(null, getHeader("X-Subject"))
            val bodyText = body.readUtf8()
            assertTrue(bodyText.contains("\"code\":\"abcdefghijklmnop\""))
            assertTrue(!bodyText.contains("opendrsai://"))
        }
    }

    @Test fun `association refreshes expired oidc token exactly once`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"code\":\"oidc_auth_invalid\"}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"runtime_id\":\"rt-refreshed\"}"))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "expired" }, {
            refreshes += 1
            "fresh"
        })
        assertEquals("rt-refreshed", service.associate("abcdefghijklmnop").value)
        assertEquals(1, refreshes)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `user can revoke only the selected runtime association`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"association_id":"association-one","runtime_id":"runtime-one","status":"revoked","revoked_at":"2026-07-26T00:00:00Z"}"""
        ))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })

        service.revokeAssociation(RuntimeId("runtime-one"))

        server.takeRequest().apply {
            assertEquals("DELETE", method)
            assertEquals("/v1/associations/runtime-one", path)
            assertEquals("Bearer token", getHeader("Authorization"))
            assertNull(getHeader("X-Subject"))
        }
    }

    @Test fun `foreground heartbeat uses signed association proof and strict false body`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """
            {"association_id":"association-one","runtime_id":"runtime-one","status":"active",
            "access_state":"accessing","last_seen_at":"2026-07-28T01:02:03Z"}
            """.trimIndent()
        ))
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(),
            { "token" },
            deviceProof = RelayDeviceProof(
                CapturingSigner(),
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-0123456789abcdef" },
            ),
        )

        service.recordPresence(RuntimeId("runtime-one"), accessing = false)

        server.takeRequest().apply {
            assertEquals("POST", method)
            assertEquals("/v1/associations/runtime-one/presence", path)
            assertEquals("Bearer token", getHeader("Authorization"))
            assertEquals("android.test-device", getHeader("X-Relay-Device-Id"))
            assertEquals("1785100000", getHeader("X-Relay-Device-Timestamp"))
            assertEquals("nonce-0123456789abcdef", getHeader("X-Relay-Device-Nonce"))
            assertEquals(86, getHeader("X-Relay-Device-Signature")?.length)
            assertEquals(false, JSONObject(body.readUtf8()).getBoolean("accessing"))
        }
    }

    @Test fun `device presence refreshes oidc once and signs both attempts`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(),
            { "expired-token" },
            refreshAfter = {
                refreshes += 1
                "refreshed-token"
            },
            deviceProof = RelayDeviceProof(
                CapturingSigner(),
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-0123456789abcdef" },
            ),
        )

        service.recordPresence(RuntimeId("runtime-one"), accessing = false)

        assertEquals(1, refreshes)
        listOf("Bearer expired-token", "Bearer refreshed-token").forEach { expectedBearer ->
            server.takeRequest().apply {
                assertEquals(expectedBearer, getHeader("Authorization"))
                assertEquals("android.test-device", getHeader("X-Relay-Device-Id"))
                assertEquals(86, getHeader("X-Relay-Device-Signature")?.length)
                assertEquals(false, JSONObject(body.readUtf8()).getBoolean("accessing"))
            }
        }
    }

    @Test fun `association revoke refreshes oidc once and preserves structured failure`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401))
        server.enqueue(MockResponse().setResponseCode(403).setBody(
            """{"code":"association_required","correlation_id":"revoke-correlation"}"""
        ))
        var refreshes = 0
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "expired" }, {
            refreshes += 1
            "fresh"
        })

        val failure = runCatching {
            service.revokeAssociation(RuntimeId("runtime-one"))
        }.exceptionOrNull() as RelayHttpException

        assertEquals(1, refreshes)
        assertEquals(403, failure.status)
        assertEquals("association_required", failure.errorCode)
        assertEquals("revoke-correlation", failure.correlationId)
        assertEquals("Bearer expired", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer fresh", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `association errors have stable user messages`() {
        assertEquals("二维码已过期，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_expired")))
        assertEquals("二维码已使用，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_consumed")))
        assertEquals("二维码已撤销，请在电脑端刷新后重试", associationErrorMessage(RelayHttpException(400, "c", "access_grant_revoked")))
        assertEquals("HepAI 登录已过期，请重新登录", associationErrorMessage(RelayHttpException(401, "c", "oidc_auth_invalid")))
        assertEquals("操作过于频繁，请稍后重试", associationErrorMessage(RelayHttpException(429, "c")))
        assertEquals("二维码环境与当前应用不一致", associationErrorMessage(IllegalArgumentException("access_grant_environment_mismatch")))
    }

    @Test fun `association reads structured relay error without exposing scanned payload`() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setHeader("X-Correlation-Id", "corr-safe")
            .setBody("{\"code\":\"access_grant_expired\",\"message\":\"expired\"}"))
        val service = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
        val failure = runCatching { service.associate("abcdefghijklmnop") }.exceptionOrNull() as RelayHttpException
        assertEquals("access_grant_expired", failure.errorCode)
        assertEquals("corr-safe", failure.correlationId)
        assertTrue(!failure.message.orEmpty().contains("abcdefghijklmnop"))
    }

    @Test fun `shared pairing fixtures parse without drift`() {
        val candidates = listOf(
            File("../../../cores/protocol/relay/mobile-pairing-fixtures.json"),
            File("../../cores/protocol/relay/mobile-pairing-fixtures.json"),
            File("cores/protocol/relay/mobile-pairing-fixtures.json"),
        )
        val fixtureFile = candidates.firstOrNull(File::isFile) ?: error("shared pairing fixtures not found")
        val fixtures = JSONObject(fixtureFile.readText())
        val valid = fixtures.getJSONArray("valid")
        repeat(valid.length()) { index ->
            val item = valid.getJSONObject(index)
            assertEquals(item.getString("code"), parseAccessGrantCode(item.getString("payload"), item.getString("issuer")))
        }
        val invalid = fixtures.getJSONArray("invalid")
        repeat(invalid.length()) { index ->
            kotlin.runCatching { parseAccessGrantCode(invalid.getString(index)) }
                .onSuccess { error("invalid shared fixture accepted") }
        }
    }

    @Test fun `shared runtime directory fixture preserves frozen identity fields`() = runTest {
        val candidates = listOf(
            File("../../../cores/protocol/relay/runtime-directory-fixtures.json"),
            File("../../cores/protocol/relay/runtime-directory-fixtures.json"),
            File("cores/protocol/relay/runtime-directory-fixtures.json"),
        )
        val fixtureFile = candidates.firstOrNull(File::isFile)
            ?: error("shared runtime directory fixture not found")
        val fixture = JSONObject(fixtureFile.readText()).getJSONObject("runtime_list")
        server.enqueue(MockResponse().setBody(fixture.toString()))

        val runtime = HttpRelayDiscoveryService(server.url("/").toString(), { "token" })
            .listRuntimes()
            .items
            .single()

        assertEquals("runtime-fixture", runtime.reference.runtimeId.value)
        assertEquals("Fixture Windows", runtime.reference.displayName)
        assertEquals(RemoteConnectionState.ONLINE, runtime.state)
        assertEquals(7L, runtime.connectionGeneration)
        assertEquals(setOf("workspace.list", "session.list"), runtime.capabilities)
    }

    @Test fun `device key rotation commits only after Relay success and keeps stable device id`() = runTest {
        val signer = RotatingSigner()
        val service = HttpRelayDiscoveryService(
            server.url("/").toString(), { "token" },
            deviceProof = RelayDeviceProof(
                signer,
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-rotation-0123456789" },
            ),
        )
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"association_id":"a","runtime_id":"rt","subject_summary":"sub_x","device_summary":"dev_x","device_name":"Android","status":"active","access_state":"online","created_at":"2026-01-01T00:00:00Z"}"""
        ))
        service.rotateDeviceKey(RuntimeId("rt"))
        assertEquals(1, signer.generation)
        assertEquals("android.stable-device", signer.associationDevice.deviceId)
        server.takeRequest().apply {
            assertEquals("/v1/associations/rt/device-key/rotate", requestUrl?.encodedPath)
            assertEquals("android.stable-device", getHeader("X-Relay-Device-Id"))
            assertEquals("B".repeat(43), JSONObject(body.readUtf8()).getString("new_device_public_key"))
        }

        val failedSigner = RotatingSigner()
        val failed = HttpRelayDiscoveryService(
            server.url("/").toString(), { "token" },
            deviceProof = RelayDeviceProof(
                failedSigner,
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-rotation-9876543210" },
            ),
        )
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        kotlin.runCatching { failed.rotateDeviceKey(RuntimeId("rt")) }
            .onSuccess { error("failed rotation committed") }
        assertEquals(0, failedSigner.generation)
        assertEquals("A".repeat(43), failedSigner.associationDevice.devicePublicKey)
        server.takeRequest()

        val recoveringSigner = RotatingSigner()
        val recovering = HttpRelayDiscoveryService(
            server.url("/").toString(), { "token" },
            deviceProof = RelayDeviceProof(
                recoveringSigner,
                epochSeconds = { 1_785_100_000L },
                nonce = { "nonce-recovery-0123456789" },
            ),
        )
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody(
            """{"association_id":"a","runtime_id":"rt","subject_summary":"sub_x","device_summary":"dev_x","device_name":"Android","status":"active","access_state":"online","created_at":"2026-01-01T00:00:00Z"}"""
        ))
        recovering.rotateDeviceKey(RuntimeId("rt"))
        assertEquals(1, recoveringSigner.generation)
        val oldProof = server.takeRequest().getHeader("X-Relay-Device-Signature")
        val pendingProof = server.takeRequest().getHeader("X-Relay-Device-Signature")
        assertNotEquals(oldProof, pendingProof)
    }

    private class CapturingSigner : RelayDeviceSigner {
        override val associationDevice = RelayAssociationDevice(
            deviceId = "android.test-device",
            deviceName = "Android test device",
            devicePublicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )

        override fun sign(message: ByteArray): ByteArray = ByteArray(64) { it.toByte() }
    }

    private class RotatingSigner : RelayDeviceSigner {
        var generation = 0
        override val associationDevice: RelayAssociationDevice
            get() = RelayAssociationDevice(
                deviceId = "android.stable-device",
                deviceName = "Android test device",
                devicePublicKey = if (generation == 0) "A".repeat(43) else "B".repeat(43),
            )

        override fun sign(message: ByteArray): ByteArray = ByteArray(64) { generation.toByte() }

        override fun beginKeyRotation(): RelayDeviceKeyRotation =
            RelayDeviceKeyRotation(
                "B".repeat(43),
                signAction = { ByteArray(64) { 1 } },
                commitAction = { generation = 1 },
            )
    }
}
