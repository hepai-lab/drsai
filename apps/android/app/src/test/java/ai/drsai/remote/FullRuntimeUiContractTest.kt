package ai.drsai.remote

import ai.drsai.remote.data.DEFAULT_AGENT
import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FullRuntimeUiContractTest {
    @Test fun localAgentAndUiNeverAdvertiseLiteOrUnverifiedDesktopParity() {
        assertFalse(BuildConfig.DESKTOP_AGENT_PARITY_COMPLETE)
        assertTrue(DEFAULT_AGENT.description.contains("Android Agent Runtime Preview"))
        assertTrue(DEFAULT_AGENT.description.contains("Desktop 能力对等尚未完成"))
        assertFalse(DEFAULT_AGENT.description.contains("Android Full Agent Runtime"))
        assertFalse(DEFAULT_AGENT.description.contains("轻量智能 Agent"))

        val models = source("src/main/java/ai/drsai/remote/data/Models.kt")
        val ui = source("src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt")
        val build = source("build.gradle.kts")
        assertTrue(build.contains("buildConfigField(\"boolean\", \"DESKTOP_AGENT_PARITY_COMPLETE\", desktopAgentParityComplete.toString())"))
        assertFalse(build.contains("buildConfigField(\"boolean\", \"DESKTOP_AGENT_PARITY_COMPLETE\", \"true\")"))
        assertTrue(build.contains("p9AcceptanceItems.all"))
        assertFalse(models.contains("运行在 Android 本机的轻量智能 Agent"))
        assertTrue(ui.contains("执行路由"))
        assertTrue(ui.contains("Android Agent Runtime Preview · Desktop parity incomplete"))
        assertTrue(ui.contains("Full Runtime 脱敏诊断已复制"))
        assertTrue(ui.contains("重试绑定"))
    }

    @Test fun exportedDiagnosticProvesFullRuntimeAndNoKotlinFallback() {
        val text = FullRuntimeDiagnosticUi(
            buildEnabled = true,
            bindingState = "READY",
            health = "READY",
            starts = 2,
            bindAttempts = 2,
            bindSuccesses = 2,
            desktopParityComplete = false,
            route = "Local Preview",
            availableTools = listOf("get_current_time"),
            permissionRequiredTools = listOf("workspace.read"),
            kernelVersion = "p9.1",
            kernelSha256 = "a".repeat(64),
            promptVersion = "p9-agent-kernel-v1",
            promptSha256 = "b".repeat(64),
            toolManifestVersion = "p9-tools-v1",
            skillManifestVersion = "p9-skill-manifest-v1",
            skillManifestSha256 = "d".repeat(64),
            capabilityManifestVersion = "p9-capabilities-v1",
            capabilityManifestSha256 = "c".repeat(64),
            hostPortProtocolVersion = "p9-host-port-v1",
            modelToolSnapshotVersion = "p9-model-tools-v1",
        ).exportText()

        assertTrue(text.contains("build_enabled=true"))
        assertTrue(text.contains("binding=READY"))
        assertTrue(text.contains("process=:runtime"))
        assertTrue(text.contains("desktop_parity_complete=false"))
        assertTrue(text.contains("route=Local Preview"))
        assertTrue(text.contains("kotlin_fallback_available=false"))
        assertTrue(text.contains("permission_required_tools=workspace.read"))
        assertTrue(text.contains("kernel_version=p9.1"))
        assertTrue(text.contains("kernel_sha256=${"a".repeat(64)}"))
        assertTrue(text.contains("prompt_version=p9-agent-kernel-v1"))
        assertTrue(text.contains("tool_manifest_version=p9-tools-v1"))
        assertTrue(text.contains("skill_manifest_version=p9-skill-manifest-v1"))
        assertTrue(text.contains("skill_manifest_sha256=${"d".repeat(64)}"))
        assertTrue(text.contains("capability_manifest_version=p9-capabilities-v1"))
        assertTrue(text.contains("host_port_protocol_version=p9-host-port-v1"))
        assertTrue(text.contains("model_tool_snapshot_version=p9-model-tools-v1"))
    }

    private fun source(relative: String): String {
        val candidates = listOf(File(relative), File("app/$relative"), File("apps/android/app/$relative"))
        return candidates.firstOrNull(File::isFile)?.readText() ?: error("source_not_found:$relative")
    }
}
