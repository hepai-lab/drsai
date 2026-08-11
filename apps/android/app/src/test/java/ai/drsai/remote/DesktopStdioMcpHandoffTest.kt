package ai.drsai.remote

import ai.drsai.remote.runtime.coordinator.*
import ai.drsai.remote.runtime.tools.McpStreamableHttpClient
import ai.drsai.remote.workbench.model.*
import org.junit.Assert.*
import org.junit.Test

class DesktopStdioMcpHandoffTest {
    private fun remote(
        id: String,
        online: Boolean,
        vararg capabilities: RuntimeCapability,
    ) = RuntimeDescriptor(
        RuntimeBinding(WorkbenchId(id), RuntimeAuthority.REMOTE_RUNTIME),
        id,
        "1",
        online,
        RuntimeCapabilitySet(values = capabilities.toSet()),
    )

    @Test fun localHttpMcpAndRemoteStdioMcpRemainDistinctEvenWithSameServerName() {
        assertEquals("mcp.research.lookup", McpStreamableHttpClient.modelToolName("research", "lookup"))
        assertEquals(
            setOf(RuntimeCapability.CHAT, RuntimeCapability.MCP),
            TaskRequirementInferer.infer(listOf("mcp.call")).capabilities,
        )
        assertEquals(
            setOf(RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO),
            TaskRequirementInferer.infer(listOf("mcp.stdio.call")).capabilities,
        )
        val desktop = remote("desktop", true, RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO)
        assertEquals(
            DesktopHandoffState.NOT_REQUIRED,
            DesktopHandoffPlanner.plan("调用 MCP server research 的 lookup", listOf(desktop)).state,
        )
        val stdio = DesktopHandoffPlanner.plan("调用 stdio MCP server: research 的 lookup", listOf(desktop))
        assertEquals(DesktopHandoffState.OFFER, stdio.state)
        assertEquals(DesktopHandoffKind.MCP_STDIO, stdio.kind)
        assertEquals("research", stdio.resourceId)
    }

    @Test fun offlineOrGenericMcpRemoteCannotPretendToProvideStdio() {
        val generic = remote("generic", true, RuntimeCapability.CHAT, RuntimeCapability.MCP)
        val offline = remote("offline", false, RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO)
        for (decision in listOf(
            DesktopHandoffPlanner.plan("使用 MCP stdio @research", listOf(generic)),
            DesktopHandoffPlanner.plan("使用 MCP stdio @research", listOf(offline)),
        )) {
            assertEquals(DesktopHandoffState.UNAVAILABLE, decision.state)
            assertEquals(setOf(RuntimeCapability.MCP_STDIO), decision.required)
            assertTrue(decision.message.contains("Android 不支持本地 stdio MCP"))
            assertTrue(decision.message.contains("尚未调用任何工具"))
            assertEquals("research", decision.resourceId)
        }
    }

    @Test fun onlineStdioTargetIsDeterministicAndShowsLocationAndApproval() {
        val zeta = remote("zeta", true, RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO)
        val alpha = remote("alpha", true, RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO)
        val decision = DesktopHandoffPlanner.plan("请用桌面 stdio MCP server：research", listOf(zeta, alpha))
        assertEquals(DesktopHandoffState.OFFER, decision.state)
        assertEquals("alpha", decision.target?.displayName)
        assertEquals("Desktop Runtime", decision.executionLocation)
        assertTrue(decision.message.contains("执行位置为 Desktop Runtime"))
        assertTrue(decision.message.contains("仍需审批"))
    }

    @Test fun stdioHandoffPackageRequiresConfirmationAndBindsTransportAndResourceIntoDigest() {
        val create = { resource: String ->
            HandoffPackageFactory.create(
                WorkbenchId("run"), WorkbenchId("desktop"), "call stdio MCP", emptyList(), emptyList(),
                confirmed = true, kind = DesktopHandoffKind.MCP_STDIO, resourceId = resource,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            HandoffPackageFactory.create(
                WorkbenchId("run"), WorkbenchId("desktop"), "call stdio MCP", emptyList(), emptyList(),
                confirmed = false, kind = DesktopHandoffKind.MCP_STDIO, resourceId = "research",
            )
        }
        val research = create("research")
        assertEquals(DesktopHandoffKind.MCP_STDIO, research.kind)
        assertEquals("Desktop Runtime", research.executionLocation)
        assertEquals("stdio", research.transport)
        assertEquals("research", research.resourceId)
        assertTrue(research.remoteToolApprovalRequired)
        assertNotEquals(research.digest, create("research-v2").digest)
        assertThrows(IllegalArgumentException::class.java) { create("../escape") }
    }
}
