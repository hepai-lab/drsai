package ai.drsai.remote

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FullRuntimeSecurityContractTest {
    @Test fun runtimeServiceIsPrivateAndRunsInDedicatedProcess() {
        val manifest = source("src/main/AndroidManifest.xml")
        val service = Regex(
            "<service\\s+android:name=\"\\.runtime\\.python\\.PythonRuntimeService\"[\\s\\S]*?\\/>",
        ).find(manifest)?.value ?: error("python_runtime_service_missing")
        assertTrue(service.contains("android:exported=\"false\""))
        assertTrue(service.contains("android:process=\":runtime\""))
        assertFalse(service.contains("intent-filter"))
    }

    @Test fun sharedPythonCoreHasNoDirectAndroidDatabaseTokenShellOrFilesystemAuthority() {
        val core = repo("cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core")
        val sources = core.listFiles { file -> file.extension == "py" }.orEmpty().joinToString("\n") { it.readText() }
        listOf(
            "import android", "from android", "ChatDatabase", "SecureTokenStore", "subprocess",
            "os.system", "Runtime.getRuntime", "ProcessBuilder", "pathlib.Path",
        ).forEach { forbidden ->
            assertFalse("shared Core contains forbidden authority: $forbidden", sources.contains(forbidden))
        }
        assertTrue(sources.contains("host") || sources.contains("port"))
    }

    private fun source(relative: String): String = repo(relative).readText()

    private fun repo(relative: String): File {
        val candidates = listOf(
            File(relative), File("app/$relative"), File("apps/android/app/$relative"),
            File("../../$relative"), File("../../../$relative"),
        )
        return candidates.firstOrNull(File::exists) ?: error("source_not_found:$relative")
    }
}
