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
            UnifiedRuntimeEvent("8", "run.completed"),
        )
        val projected = (events + events).fold(UnifiedRunProjection(), UnifiedEventReducer::reduce)
        assertEquals("ok", projected.text)
        assertEquals(UnifiedToolState.SUCCEEDED, projected.tools["call"])
        assertTrue(projected.pendingApprovals.isEmpty())
        assertEquals(setOf("artifact"), projected.artifacts)
        assertEquals("run.completed", projected.terminal)
    }
}
