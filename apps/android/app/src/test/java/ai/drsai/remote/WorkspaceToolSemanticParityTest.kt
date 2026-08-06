package ai.drsai.remote

import ai.drsai.remote.runtime.device.SafWorkspaceGateway
import ai.drsai.remote.runtime.device.WorkspacePathSemantics
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceToolSemanticParityTest {
    @Test fun sharedFixtureProducesIdenticalRelativePathLineAndGlobSemantics() {
        val fixture = JSONObject(fixtureFile().readText())
        fixture.getJSONArray("safe_paths").let { values ->
            repeat(values.length()) { assertTrue(SafWorkspaceGateway.safeParts(values.getString(it)).isNotEmpty()) }
        }
        fixture.getJSONArray("denied_paths").let { values ->
            repeat(values.length()) { index ->
                assertThrows(IllegalArgumentException::class.java) { SafWorkspaceGateway.safeParts(values.getString(index)) }
            }
        }
        fixture.getJSONArray("line_slices").let { values -> repeat(values.length()) { index ->
            val case = values.getJSONObject(index)
            assertEquals(case.getString("expected"), WorkspacePathSemantics.lineSlice(case.getString("text"), case.getInt("start"), case.getInt("end")))
        } }
        fixture.getJSONArray("glob_cases").let { values -> repeat(values.length()) { index ->
            val case = values.getJSONObject(index)
            assertEquals(case.getBoolean("matches"), WorkspacePathSemantics.globRegex(case.getString("pattern")).matches(case.getString("path")))
        } }
    }

    @Test fun fixtureMapsDesktopToolsToAndroidSafToolsWithoutAbsolutePathCapability() {
        val mappings = JSONObject(fixtureFile().readText()).getJSONObject("mappings")
        assertEquals("workspace.read", mappings.getString("run_read"))
        assertEquals("workspace.glob", mappings.getString("run_glob"))
        assertEquals("workspace.grep", mappings.getString("run_grep"))
        assertEquals("workspace.write", mappings.getString("run_write"))
        assertEquals("workspace.edit", mappings.getString("run_edit"))
        val source = sourceFile().readText()
        listOf("workspace.list", "workspace.read", "workspace.search", "workspace.glob", "workspace.grep", "workspace.write", "workspace.edit")
            .forEach { assertTrue(source.contains("\"$it\"")) }
        assertTrue(source.contains("SafWorkspaceStore"))
        assertTrue(source.contains("saf_permission_missing"))
    }

    private fun fixtureFile(): File = candidates("cores/protocol/android-runtime/fixtures/workspace-tool-parity-v1.json").first(File::isFile)
    private fun sourceFile(): File = candidates("apps/android/app/src/main/java/ai/drsai/remote/runtime/device/AndroidLocalCapabilities.kt").first(File::isFile)
    private fun candidates(path: String) = listOf(File(path), File("../$path"), File("../../$path"), File("../../../$path"))
}
