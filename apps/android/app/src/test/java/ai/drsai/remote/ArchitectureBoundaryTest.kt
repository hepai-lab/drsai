package ai.drsai.remote

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArchitectureBoundaryTest {
    @Test fun composeUiDoesNotDependOnConcreteRuntimeImplementations() {
        val uiRoot = sourceRoot("src/main/java/ai/drsai/remote/ui")
        val source = uiRoot.walkTopDown().filter { it.extension == "kt" }.joinToString("\n") { it.readText() }
        assertFalse(source.contains("import ai.drsai.remote.data.LocalAgentRuntime"))
        assertFalse(source.contains("import ai.drsai.remote.data.PlatformAgentRuntime"))
        assertFalse(source.contains("runtime.run("))
        assertFalse(source.contains("platformRuntime.run("))
    }

    @Test fun androidLocalRegistryKeepsForbiddenExecutionCapabilitiesOut() {
        val runtimeRoot = sourceRoot("src/main/java/ai/drsai/remote/runtime")
        val registry = sourceRoot("src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt").readText()
        assertTrue(runtimeRoot.isDirectory)
        listOf("shell.execute", "browser.automate", "filesystem.arbitrary").forEach { forbidden ->
            assertFalse("forbidden local tool: $forbidden", registry.contains("\"$forbidden\""))
        }
    }

    private fun sourceRoot(relative: String): File {
        val candidates = listOf(File(relative), File("app/$relative"), File("apps/android/app/$relative"))
        return candidates.firstOrNull(File::exists)
            ?: error("source_root_not_found:$relative:${File(".").absolutePath}")
    }
}
