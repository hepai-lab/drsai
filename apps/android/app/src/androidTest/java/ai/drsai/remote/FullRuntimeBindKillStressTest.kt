package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import android.app.ActivityManager
import android.content.Context
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FullRuntimeBindKillStressTest {
    @Test
    fun oneHundredBindKillRebindCyclesNeverHangOrDuplicateRuntime() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(ActivityManager::class.java)
        val arguments = InstrumentationRegistry.getArguments()
        val cycles = arguments.getString("cycles")?.toIntOrNull()?.coerceIn(1, 20) ?: DEFAULT_CYCLES
        val batch = arguments.getString("batch")?.toIntOrNull()?.coerceAtLeast(0) ?: 0
        val bindMs = mutableListOf<Long>()
        val firstEventMs = mutableListOf<Long>()

        repeat(cycles) { index ->
            val globalIndex = batch * cycles + index
            val client = PythonRuntimeClient(context)
            try {
                val bindStarted = SystemClock.elapsedRealtime()
                withTimeout(BIND_TIMEOUT_MS) { client.bind() }
                bindMs += SystemClock.elapsedRealtime() - bindStarted

                val eventStarted = SystemClock.elapsedRealtime()
                val result = withTimeout(FIRST_EVENT_TIMEOUT_MS) { client.submit(PythonRuntimeEnvelope(
                    messageType = PythonRuntimeMessageType.START_RUN,
                    requestId = "bind-kill-request-$globalIndex",
                    runId = "bind-kill-run-$globalIndex",
                    sessionId = "bind-kill-session-$globalIndex",
                    sequence = 0,
                    idempotencyKey = "bind-kill:$globalIndex",
                    payload = JSONObject().put("input", "probe").put("model_id", "probe-model"),
                )) }
                firstEventMs += SystemClock.elapsedRealtime() - eventStarted
                assertEquals("python_runtime_ready", result.getJSONObject("python_result").getString("status"))

                val processes = runtimeProcesses(manager, context.packageName)
                assertEquals("exactly one runtime process must own the binding", 1, processes.size)
                val runtime = processes.single()
                assertNotNull(runtime)
                Process.killProcess(runtime.pid)
                assertTrue("runtime process permanently hung at cycle $globalIndex", waitForRuntimeExit(manager, context.packageName))
                // Give ActivityManager a bounded window to finish service-death
                // bookkeeping before requesting the next isolated cold start.
                delay(PROCESS_DEATH_SETTLE_MS)
            } finally {
                client.close()
            }
        }

        val evidence = JSONObject()
            .put("batch", batch)
            .put("cycles", cycles)
            .put("permanent_hangs", 0)
            .put("duplicate_runtime_processes", 0)
            .put("bind_p95_ms", percentile95(bindMs))
            .put("first_event_p95_ms", percentile95(firstEventMs))
            .put("bind_samples_ms", JSONArray(bindMs))
            .put("first_event_samples_ms", JSONArray(firstEventMs))
        Log.i(MARKER, evidence.toString())
        // The release thresholds apply to the aggregate 100-sample distribution.
        // Each individual operation is still fail-fast bounded by the hard timeouts above.
        Unit
    }

    private fun runtimeProcesses(manager: ActivityManager, packageName: String) =
        manager.runningAppProcesses.orEmpty().filter { it.processName == "$packageName:runtime" }

    private suspend fun waitForRuntimeExit(manager: ActivityManager, packageName: String): Boolean {
        repeat(100) {
            if (runtimeProcesses(manager, packageName).isEmpty()) return true
            delay(50)
        }
        return false
    }

    private fun percentile95(values: List<Long>): Long {
        val sorted = values.sorted()
        return sorted[((sorted.size * 95 + 99) / 100 - 1).coerceAtLeast(0)]
    }

    companion object {
        const val DEFAULT_CYCLES = 10
        // Four bounded 2-second health attempts plus short process-restart delays.
        // The release performance gate remains the aggregate bind P95 <= 2s.
        const val BIND_TIMEOUT_MS = 12_000L
        // Keep the per-sample watchdog above the release percentile threshold:
        // one slow OEM scheduling outlier must still be recorded so the
        // aggregate P95 <= 5s gate can judge the complete 100-cycle run.
        const val FIRST_EVENT_TIMEOUT_MS = 10_000L
        const val PROCESS_DEATH_SETTLE_MS = 300L
        const val MARKER = "V156_FULL_RUNTIME_BIND_KILL"
    }
}
