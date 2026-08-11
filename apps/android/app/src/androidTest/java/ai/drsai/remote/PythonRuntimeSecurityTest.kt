package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import android.content.Context
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeSecurityTest {
    @Test
    fun runtimePayloadSecretIsNotPersistedToAppData() {
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val client = PythonRuntimeClient(context)
            try {
                val result = client.submit(
                    PythonRuntimeEnvelope(
                        messageType = PythonRuntimeMessageType.START_RUN,
                        requestId = "security-request",
                        runId = "security-run",
                        sessionId = "security-session",
                        sequence = 0,
                        idempotencyKey = "security:start",
                        payload = JSONObject().put("input", CANARY).put("model_id", "probe-model"),
                    )
                )
                assertEquals("python_runtime_ready", result.getJSONObject("python_result").getString("status"))
                val persisted = context.dataDir.walkTopDown()
                    .filter(File::isFile)
                    .filter { it.length() <= MAX_SCAN_FILE_BYTES }
                    .any { file -> runCatching { file.readBytes().indexOf(CANARY.toByteArray()) >= 0 }.getOrDefault(false) }
                assertFalse("runtime payload canary was persisted in app data", persisted)
                Log.i(TAG, "PYTHON_RUNTIME_SECURITY={\"app_data_canary_findings\":0}")
            } finally {
                client.close()
            }
        }
    }

    private fun ByteArray.indexOf(needle: ByteArray): Int {
        if (needle.isEmpty()) return 0
        for (start in 0..size - needle.size) {
            if (needle.indices.all { this[start + it] == needle[it] }) return start
        }
        return -1
    }

    companion object {
        const val TAG = "PythonRuntimeSecurity"
        const val CANARY = "OPENDRSAI_RUNTIME_SECRET_CANARY_7f91c2e5"
        const val MAX_SCAN_FILE_BYTES = 8L * 1024 * 1024
    }
}
