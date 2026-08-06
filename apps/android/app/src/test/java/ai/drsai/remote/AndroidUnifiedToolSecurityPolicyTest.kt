package ai.drsai.remote

import ai.drsai.remote.runtime.security.AndroidUnifiedToolSecurityPolicy
import ai.drsai.remote.runtime.tools.*
import ai.drsai.remote.workbench.model.RuntimeCapability
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AndroidUnifiedToolSecurityPolicyTest {
    private val context = ToolExecutionContext(
        accountSubject = "alice", runtimeCapabilities = RuntimeCapability.entries.toSet(),
        runId = "run-1", sessionId = "session-1", toolCallId = "call-1",
    )

    @Test fun adversarialUrlMatrixRejectsSsrfAuthorityAndSchemeBypasses() {
        val malicious = buildList {
            addAll(listOf(
                "http://example.com", "https://user:secret@example.com", "https://localhost",
                "https://localhost.localdomain", "https://service.local", "https://127.0.0.1",
                "https://0.0.0.0", "https://10.0.0.1", "https://169.254.169.254",
                "https://172.16.0.1", "https://192.168.1.1", "https://[::1]", "https://example.com:8443",
                "https://example.com/#secret", "file:///etc/passwd", "content://settings/secure",
            ))
            repeat(100) { index -> add("https://127.0.0.${index % 255}") }
        }
        malicious.forEach { value ->
            assertThrows(value, IllegalArgumentException::class.java) {
                AndroidUnifiedToolSecurityPolicy.validatePublicHttpsTarget(value)
            }
        }
        assertEquals("example.com", AndroidUnifiedToolSecurityPolicy.validatePublicHttpsTarget("https://example.com/path?q=1").host)
    }

    @Test fun pathMcpAccountAndApprovalScopesFailClosed() {
        val workspace = definition("workspace.read", ToolRisk.READ_ONLY, setOf("path"), setOf(RuntimeCapability.SAF_READ))
        listOf("../secret", "/absolute", "a/../../b", "content://authority/doc", "a\\..\\b").forEach { path ->
            assertThrows(IllegalArgumentException::class.java) {
                AndroidUnifiedToolSecurityPolicy.validate(workspace, context, JSONObject().put("path", path))
            }
        }
        val mcp = definition("mcp.server.read", ToolRisk.READ_ONLY, source = "mcp")
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUnifiedToolSecurityPolicy.validate(
                mcp, context.copy(runtimeCapabilities = emptySet()), JSONObject(),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUnifiedToolSecurityPolicy.validate(
                mcp, context.copy(runId = null), JSONObject(),
            )
        }
        val write = definition("browser.submit", ToolRisk.EXTERNAL_WRITE)
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUnifiedToolSecurityPolicy.validateApprovedExecution(write, context)
        }
        AndroidUnifiedToolSecurityPolicy.validateApprovedExecution(write, context.copy(approved = true))
        assertThrows(IllegalArgumentException::class.java) {
            AndroidUnifiedToolSecurityPolicy.validate(workspace, context.copy(accountSubject = " "), JSONObject().put("path", "ok"))
        }
    }

    @Test fun registryRunsUnifiedGateBeforeAnyHandlerOrSideEffect() = runTest {
        var calls = 0
        val registry = ToolRegistry()
        registry.register(definition("web.fetch", ToolRisk.READ_ONLY, setOf("url"), setOf(RuntimeCapability.WEB_FETCH))) { _, _ ->
            calls += 1
            "should-not-run"
        }
        val ssrf = registry.execute(context, "web.fetch", """{"url":"https://169.254.169.254/latest/meta-data"}""")
        assertEquals("security_private_target_denied", (ssrf as ToolExecutionOutcome.Rejected).code)
        assertEquals(0, calls)

        val writes = ToolRegistry()
        writes.register(definition("browser.submit", ToolRisk.EXTERNAL_WRITE)) { _, _ ->
            calls += 1
            "should-not-run"
        }
        assertTrue(writes.execute(context, "browser.submit", "{}") is ToolExecutionOutcome.ApprovalRequired)
        assertEquals(0, calls)
    }

    private fun definition(
        id: String,
        risk: ToolRisk,
        required: Set<String> = emptySet(),
        capabilities: Set<RuntimeCapability> = emptySet(),
        source: String = "android-host",
    ) = ToolDefinition(
        id, 1, id, risk, required,
        objectToolSchema(JSONObject().apply { required.forEach { put(it, JSONObject().put("type", "string")) } }, required),
        capabilities, source = source,
    )
}
