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
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeServiceTest {
    @Test
    fun runtimeAutomaticallyReleasesAfterIdleTimeout() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(ActivityManager::class.java)
        val client = PythonRuntimeClient(context, idleTimeoutMs = 100)
        client.submit(startEnvelope("idle", "idle-run"))
        assertTrue(waitForRuntimeProcess(manager, context.packageName) != null)
        assertTrue(waitForRuntimeProcessExit(manager, context.packageName))
    }

    @Test
    fun runtimeProcessExecutesBundledPythonCoreAndReturnsIdentity() = runBlocking {
        val client = PythonRuntimeClient(ApplicationProvider.getApplicationContext())
        try {
            val result = client.submit(
                PythonRuntimeEnvelope(
                    messageType = PythonRuntimeMessageType.START_RUN,
                    requestId = "instrumentation-request-1",
                    runId = "instrumentation-run-1",
                    sessionId = "instrumentation-session-1",
                    sequence = 0,
                    idempotencyKey = "instrumentation:start:1",
                    payload = JSONObject().put("input", "probe").put("model_id", "probe-model"),
                )
            )

            assertEquals("accepted", result.getString("decision"))
            val python = result.getJSONObject("python_result")
            assertEquals("python_runtime_ready", python.getString("status"))
            assertEquals("instrumentation-run-1", python.getString("run_id"))
            assertEquals(1, python.getInt("protocol_version"))
            assertEquals("runtime_event", python.getJSONArray("outbound").getJSONObject(0).getString("message_type"))
            assertEquals("checkpoint_request", python.getJSONArray("outbound").getJSONObject(1).getString("message_type"))
            assertEquals("model_request", python.getJSONArray("outbound").getJSONObject(2).getString("message_type"))
        } finally {
            client.close()
        }
    }

    @Test
    fun runtimeIsIsolatedAndShutdownStartsWithCleanState() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val firstClient = PythonRuntimeClient(context)
        val firstRun = "instrumentation-isolation-run"
        try {
            val accepted = firstClient.submit(startEnvelope("isolation-start", firstRun))
            assertEquals("accepted", accepted.getString("decision"))

            val activityManager = context.getSystemService(ActivityManager::class.java)
            val runtimeProcess = waitForRuntimeProcess(activityManager, context.packageName)
            assertNotNull("dedicated :runtime process was not observed", runtimeProcess)
            assertNotEquals(Process.myPid(), runtimeProcess!!.pid)
            assertTrue(runtimeProcess.processName.endsWith(":runtime"))
        } finally {
            firstClient.close()
        }

        val activityManager = context.getSystemService(ActivityManager::class.java)
        assertTrue(
            "runtime process did not stop after client shutdown",
            waitForRuntimeProcessExit(activityManager, context.packageName),
        )

        val secondClient = PythonRuntimeClient(context)
        try {
            val staleContinuation = secondClient.submit(
                PythonRuntimeEnvelope(
                    messageType = PythonRuntimeMessageType.MODEL_COMPLETED,
                    requestId = "isolation-stale-continuation",
                    runId = firstRun,
                    sessionId = "instrumentation-session-isolation",
                    sequence = 1,
                    idempotencyKey = "instrumentation:isolation:stale",
                    payload = JSONObject().put("text", "stale"),
                )
            )
            assertEquals("accepted", staleContinuation.getString("decision"))
            assertEquals(
                "python_runtime_failed",
                staleContinuation.getJSONObject("python_result").getString("status"),
            )

            val freshRun = secondClient.submit(startEnvelope("isolation-fresh", "instrumentation-fresh-run"))
            assertEquals("python_runtime_ready", freshRun.getJSONObject("python_result").getString("status"))
        } finally {
            secondClient.close()
        }
    }

    @Test
    fun runtimeRecoversAfterUnexpectedProcessDeath() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var recoveryStartedAt = 0L
        val firstClient = PythonRuntimeClient(context)
        try {
            val accepted = firstClient.submit(startEnvelope("kill-start", "instrumentation-kill-run"))
            assertEquals("accepted", accepted.getString("decision"))
            val runtimeProcess = waitForRuntimeProcess(
                context.getSystemService(ActivityManager::class.java),
                context.packageName,
            )
            assertNotNull(runtimeProcess)
            recoveryStartedAt = SystemClock.elapsedRealtime()
            Process.killProcess(runtimeProcess!!.pid)
            assertTrue(
                waitForRuntimeProcessExit(
                    context.getSystemService(ActivityManager::class.java),
                    context.packageName,
                )
            )
        } finally {
            firstClient.close()
        }

        val recoveredClient = PythonRuntimeClient(context)
        try {
            val recovered = recoveredClient.submit(
                startEnvelope("kill-recovered", "instrumentation-kill-recovered-run")
            )
            assertEquals("accepted", recovered.getString("decision"))
            assertEquals("python_runtime_ready", recovered.getJSONObject("python_result").getString("status"))
            val recoveryInteractiveMs = SystemClock.elapsedRealtime() - recoveryStartedAt
            Log.i("Stage7RecoveryMetric", "PYTHON_RUNTIME_RECOVERY={\"recovery_interactive_ms\":$recoveryInteractiveMs}")
            Unit
        } finally {
            recoveredClient.close()
        }
    }

    private fun startEnvelope(requestSuffix: String, runId: String) = PythonRuntimeEnvelope(
        messageType = PythonRuntimeMessageType.START_RUN,
        requestId = "instrumentation-$requestSuffix",
        runId = runId,
        sessionId = "instrumentation-session-isolation",
        sequence = 0,
        idempotencyKey = "instrumentation:$requestSuffix",
        payload = JSONObject().put("input", "probe").put("model_id", "probe-model"),
    )

    private suspend fun waitForRuntimeProcess(
        activityManager: ActivityManager,
        packageName: String,
    ): ActivityManager.RunningAppProcessInfo? {
        repeat(50) {
            activityManager.runningAppProcesses
                ?.firstOrNull { it.processName == "$packageName:runtime" }
                ?.let { return it }
            kotlinx.coroutines.delay(100)
        }
        return null
    }

    private suspend fun waitForRuntimeProcessExit(
        activityManager: ActivityManager,
        packageName: String,
    ): Boolean {
        repeat(50) {
            val running = activityManager.runningAppProcesses
                ?.any { it.processName == "$packageName:runtime" } == true
            if (!running) return true
            kotlinx.coroutines.delay(100)
        }
        return false
    }
}
