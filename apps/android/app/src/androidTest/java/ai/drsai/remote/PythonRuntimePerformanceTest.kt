package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import kotlin.math.ceil
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimePerformanceTest {
    @Test
    fun recordsColdStartMemoryStorageAndReleaseMetrics() {
        runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val activityManager = context.getSystemService(ActivityManager::class.java)
        val coldStarts = mutableListOf<Long>()
        val pssSamples = mutableListOf<Double>()
        val cpuSamples = mutableListOf<Double>()

        repeat(10) { index ->
            val client = PythonRuntimeClient(context)
            val started = System.nanoTime()
            client.bind()
            val runtimeBefore = waitForRuntimeProcess(activityManager, context.packageName)
            assertTrue("runtime process missing after bind", runtimeBefore != null)
            val cpuBefore = processCpuTicks(runtimeBefore!!.pid)
            val result = client.submit(
                PythonRuntimeEnvelope(
                    messageType = PythonRuntimeMessageType.START_RUN,
                    requestId = "performance-request-$index",
                    runId = "performance-run-$index",
                    sessionId = "performance-session-$index",
                    sequence = 0,
                    idempotencyKey = "performance:start:$index",
                    payload = JSONObject().put("input", "probe").put("model_id", "probe-model"),
                )
            )
            coldStarts += (System.nanoTime() - started) / 1_000_000
            val elapsedMs = coldStarts.last().coerceAtLeast(1)
            val cpuAfter = processCpuTicks(runtimeBefore.pid)
            if (cpuBefore != null && cpuAfter != null) {
                cpuSamples += (cpuAfter - cpuBefore).coerceAtLeast(0) * 1000.0 / elapsedMs
            }
            assertEquals("python_runtime_ready", result.getJSONObject("python_result").getString("status"))

            val runtime = waitForRuntimeProcess(activityManager, context.packageName)
            assertTrue("runtime process missing", runtime != null)
            val memory = activityManager.getProcessMemoryInfo(intArrayOf(runtime!!.pid)).single()
            pssSamples += memory.totalPss / 1024.0
            client.close()
            assertTrue("runtime process was not released", waitForRuntimeExit(activityManager, context.packageName))
        }

        val storageBytes = File(context.applicationInfo.sourceDir).length() + directoryBytes(context.dataDir)
        val batteryManager = context.getSystemService(BatteryManager::class.java)
        val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val powerManager = context.getSystemService(PowerManager::class.java)
        val evidence = JSONObject()
            .put("cold_start_ms", JSONArray(coldStarts))
            .put("cold_start_p95_ms", percentile95(coldStarts.map(Long::toDouble)))
            .put("foreground_pss_mb", JSONArray(pssSamples))
            .put("foreground_pss_p95_mb", percentile95(pssSamples))
            .put("peak_pss_mb", pssSamples.maxOrNull())
            .put("cpu_percent", JSONArray(cpuSamples))
            .put("cpu_p95_percent", percentile95(cpuSamples))
            .put("storage_mb", storageBytes / 1024.0 / 1024.0)
            .put("battery_percent", batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("battery_temperature_c", batteryIntent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)?.div(10.0))
            .put(
                "thermal_status",
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) powerManager.currentThermalStatus
                else JSONObject.NULL,
            )
            .put("runtime_release_verified", true)
            Log.i(TAG, "$MARKER$evidence")
        }
    }

    private suspend fun waitForRuntimeProcess(
        manager: ActivityManager,
        packageName: String,
    ): ActivityManager.RunningAppProcessInfo? {
        repeat(50) {
            manager.runningAppProcesses?.firstOrNull { it.processName == "$packageName:runtime" }?.let { return it }
            delay(100)
        }
        return null
    }

    private suspend fun waitForRuntimeExit(manager: ActivityManager, packageName: String): Boolean {
        repeat(50) {
            if (manager.runningAppProcesses?.none { it.processName == "$packageName:runtime" } != false) return true
            delay(100)
        }
        return false
    }

    private fun percentile95(values: List<Double>): Double {
        val sorted = values.sorted()
        return sorted[(ceil(sorted.size * 0.95).toInt() - 1).coerceAtLeast(0)]
    }

    private fun directoryBytes(file: File): Long = when {
        file.isFile -> file.length()
        file.isDirectory -> file.listFiles()?.sumOf(::directoryBytes) ?: 0L
        else -> 0L
    }

    private fun processCpuTicks(pid: Int): Long? = runCatching {
        val fields = File("/proc/$pid/stat").readText().trim().split(' ')
        fields[13].toLong() + fields[14].toLong()
    }.getOrNull()

    companion object {
        const val TAG = "PythonRuntimePerf"
        const val MARKER = "PYTHON_RUNTIME_PERF="
    }
}
