package ai.drsai.remote

import ai.drsai.remote.runtime.coordinator.*
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.PromptLayer
import ai.drsai.remote.workbench.model.*
import org.junit.Assert.*
import org.junit.Test

class HybridRuntimeCoordinatorTest {
    private fun descriptor(authority: RuntimeAuthority, vararg capability: RuntimeCapability) = RuntimeDescriptor(
        RuntimeBinding(WorkbenchId(if (authority == RuntimeAuthority.LOCAL_DEVICE) "local" else "remote"), authority),
        authority.name, "2.0", true, RuntimeCapabilitySet(values = capability.toSet()),
    )

    @Test fun capabilityCodecIgnoresUnknownFieldsAndCapabilities() {
        val decoded = RuntimeCapabilityCodec.decode("""{"schema_version":2,"capabilities":["chat","future_tool"],"limits":{"max_tool_calls":4},"future":true}""")
        assertEquals(setOf(RuntimeCapability.CHAT), decoded.values)
        assertEquals(4, decoded.limits.maxToolCalls)
        assertEquals(decoded, RuntimeCapabilityCodec.decode(RuntimeCapabilityCodec.encode(decoded)))
        assertEquals(
            setOf(RuntimeCapability.CHAT, RuntimeCapability.MCP_STDIO, RuntimeCapability.APPROVALS),
            RuntimeCapabilityCodec.decode("""["run.create","mcp.stdio","approval.decide","future"]""").values,
        )
    }

    @Test fun deterministicRequirementsAndRouteCanBeExplicitlyOverridden() {
        val requirements = TaskRequirementInferer.infer(listOf("git.diff", "shell.execute"))
        assertEquals(setOf(RuntimeCapability.CHAT, RuntimeCapability.GIT, RuntimeCapability.SHELL), requirements.capabilities)
        val local = descriptor(RuntimeAuthority.LOCAL_DEVICE, RuntimeCapability.CHAT)
        val remote = descriptor(RuntimeAuthority.REMOTE_RUNTIME, RuntimeCapability.CHAT, RuntimeCapability.GIT, RuntimeCapability.SHELL)
        assertEquals(RuntimeRouteDecision.REMOTE, HybridRuntimeCoordinator.recommend(requirements, local, remote).decision)
        assertEquals(RuntimeRouteDecision.UNSUPPORTED,
            HybridRuntimeCoordinator.recommend(requirements, local, remote, RuntimeAuthority.LOCAL_DEVICE).decision)
    }

    @Test fun desktopExclusivePowerShellGitPtyAndCodexRequestsProduceHonestHandoffDecisions() {
        val required = DesktopHandoffPlanner.requiredCapabilities(
            "请在交互式终端运行 PowerShell，再用 git 提交并调用 Codex CLI",
        )
        assertEquals(
            setOf(RuntimeCapability.SHELL, RuntimeCapability.PTY, RuntimeCapability.GIT, RuntimeCapability.CODEX),
            required,
        )
        val unavailable = DesktopHandoffPlanner.plan("运行 PowerShell", emptyList())
        assertEquals(DesktopHandoffState.UNAVAILABLE, unavailable.state)
        assertTrue(unavailable.message.contains("尚未执行任何命令"))

        val incapable = descriptor(RuntimeAuthority.REMOTE_RUNTIME, RuntimeCapability.CHAT, RuntimeCapability.GIT)
        assertEquals(DesktopHandoffState.UNAVAILABLE, DesktopHandoffPlanner.plan("运行 PowerShell", listOf(incapable)).state)
        val capable = descriptor(
            RuntimeAuthority.REMOTE_RUNTIME, RuntimeCapability.CHAT, RuntimeCapability.SHELL,
            RuntimeCapability.PTY, RuntimeCapability.GIT, RuntimeCapability.CODEX,
        )
        val offered = DesktopHandoffPlanner.plan("运行 PowerShell", listOf(capable))
        assertEquals(DesktopHandoffState.OFFER, offered.state)
        assertEquals(capable.binding.runtimeId, offered.target?.binding?.runtimeId)
        assertTrue(offered.message.contains("Android 尚未执行任何命令"))
        assertEquals(DesktopHandoffState.NOT_REQUIRED, DesktopHandoffPlanner.plan("解释 Kotlin 协程", listOf(capable)).state)
    }

    @Test fun handoffRequiresConfirmationRedactsSecretsAndHasStableDigest() {
        val attachment = HandoffAttachment("a1", "a".repeat(64), "text/plain", 3)
        assertThrows(IllegalArgumentException::class.java) {
            HandoffPackageFactory.create(WorkbenchId("run"), WorkbenchId("remote"), "hello", emptyList(), emptyList(), false)
        }
        val first = HandoffPackageFactory.create(
            WorkbenchId("run"), WorkbenchId("remote"), "Bearer secret-token", listOf("api_key=hidden"), listOf(attachment), true,
        )
        val second = HandoffPackageFactory.create(
            WorkbenchId("run"), WorkbenchId("remote"), "Bearer secret-token", listOf("api_key=hidden"), listOf(attachment), true,
        )
        assertFalse(first.prompt.contains("secret-token"))
        assertFalse(first.instructions.single().contains("hidden"))
        assertEquals(first.digest, second.digest)
    }

    @Test fun handoffBindsProjectInstructionSourcesAndVersionsIntoItsDigest() {
        fun create(version: String) = HandoffPackageFactory.createFromSnapshots(
            WorkbenchId("run"), WorkbenchId("remote"), "hello",
            listOf(PromptFragment(PromptLayer.PROJECT, "policy", "remote:AGENTS.md", version)),
            emptyList(), confirmed = true,
        )
        val first = create("sha-v1")
        val second = create("sha-v2")
        assertEquals(mapOf("remote:AGENTS.md" to "sha-v1"), first.instructionVersions)
        assertNotEquals(first.digest, second.digest)
    }

    @Test fun oneReducerProjectsLocalAndRemoteSemanticsWithoutDuplicateThinking() {
        val events = listOf(
            UnifiedRuntimeEvent("1", "message.delta", content = "ok"),
            UnifiedRuntimeEvent("2", "tool.started", "call"),
            UnifiedRuntimeEvent("3", "tool.progress", "call"),
            UnifiedRuntimeEvent("4", "approval.requested", "approval"),
            UnifiedRuntimeEvent("5", "approval.decided", "approval"),
            UnifiedRuntimeEvent("6", "tool.result", "call"),
            UnifiedRuntimeEvent("7", "artifact.created", "artifact"),
            UnifiedRuntimeEvent("7b", "handoff.requested", "handoff-1", "Desktop Runtime"),
            UnifiedRuntimeEvent("8", "run.completed"),
        )
        val projected = (events + events).fold(UnifiedRunProjection(), UnifiedEventReducer::reduce)
        assertEquals("ok", projected.text)
        assertEquals(UnifiedToolState.SUCCEEDED, projected.tools["call"])
        assertTrue(projected.pendingApprovals.isEmpty())
        assertEquals(setOf("artifact"), projected.artifacts)
        assertEquals(mapOf("handoff-1" to "Desktop Runtime"), projected.handoffs)
        assertEquals("run.completed", projected.terminal)
    }
}
