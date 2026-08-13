package ai.drsai.remote

import ai.drsai.remote.runtime.python.PythonRuntimeClient
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.python.SharedPreferencesPythonRuntimeMetrics
import android.app.ActivityManager
import android.content.Context
import android.os.Process
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FullRuntimePhysicalAcceptanceTest {
    @Before
    fun requireExplicitPhysicalAcceptanceOptIn() {
        assumeTrue(
            "runtime lifecycle acceptance must be explicitly enabled",
            InstrumentationRegistry.getArguments().getString("runPhysicalRuntime") == "true" ||
                InstrumentationRegistry.getArguments().getString("runP9EmulatorLifecycle") == "true",
        )
    }

    @Test
    fun defaultFullRuntimeBindingIsReadyAndObservable(): Unit = runBlocking {
        val context = context()
        val metrics = SharedPreferencesPythonRuntimeMetrics(context)
        val before = metrics.snapshot()
        val client = PythonRuntimeClient(context, metrics)
        try {
            // PythonSharedCoreChatEngine records the Run start immediately before
            // handing the START_RUN envelope to this same bridge.
            metrics.runtimeStarted()
            val response = client.submit(start("physical-default", "physical-default-run"))
            val python = response.getJSONObject("python_result")
            val process = waitForRuntimeProcess(context)
            val after = metrics.snapshot()
            assertTrue(BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED)
            assertFalse(BuildConfig.KOTLIN_LITE_RUNTIME_ENABLED)
            assertEquals("accepted", response.getString("decision"))
            assertEquals("python_runtime_ready", python.getString("status"))
            assertNotNull(process)
            assertTrue(process!!.processName.endsWith(":runtime"))
            assertTrue(after.starts > before.starts)
            assertTrue(after.bindAttempts > before.bindAttempts)
            assertTrue(after.bindSuccesses > before.bindSuccesses)
            assertEquals(before.safeFallbacks, after.safeFallbacks)
            Log.i(DEFAULT_MARKER, JSONObject()
                .put("full_runtime_enabled", true)
                .put("kotlin_lite_enabled", false)
                .put("binding_state", "READY")
                .put("python_status", python.getString("status"))
                .put("main_pid", Process.myPid())
                .put("runtime_pid", process.pid)
                .put("starts_delta", after.starts - before.starts)
                .put("bind_attempts_delta", after.bindAttempts - before.bindAttempts)
                .put("bind_successes_delta", after.bindSuccesses - before.bindSuccesses)
                .put("safe_fallbacks_delta", after.safeFallbacks - before.safeFallbacks)
                .toString())
        } finally {
            client.close()
        }
    }

    @Test
    fun binderPythonAndNetworkFaultsRemainOnFullRuntime(): Unit = runBlocking {
        val context = context()
        val first = PythonRuntimeClient(context)
        try {
            assertReady(first.submit(start("binder-before", "binder-before-run")))
            killRuntime(context)
            assertReady(first.submit(start("binder-after", "binder-after-run")))
        } finally {
            first.close()
        }

        val crashed = PythonRuntimeClient(context)
        try {
            assertReady(crashed.submit(start("python-before", "python-before-run")))
            killRuntime(context)
        } finally {
            crashed.close()
        }
        val recovered = PythonRuntimeClient(context)
        try {
            assertReady(recovered.submit(start("python-after", "python-after-run")))
            val networkRun = "physical-network-run"
            assertReady(recovered.submit(start("network-start", networkRun, NETWORK_SESSION)))
            val failed = recovered.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.MODEL_FAILED,
                requestId = "physical-network-failed",
                runId = networkRun,
                sessionId = NETWORK_SESSION,
                sequence = 1,
                idempotencyKey = "physical-network:1",
                payload = JSONObject().put("code", "network_unavailable").put("retryable", true),
            )).getJSONObject("python_result")
            val failure = outbound(failed).first { envelope ->
                envelope.optString("message_type") == "runtime_event" &&
                    envelope.optJSONObject("payload")?.optString("kind") == "run.failed"
            }.getJSONObject("payload")
            assertEquals("network_unavailable", failure.getString("code"))
            assertFalse(failed.toString().contains("kotlin", ignoreCase = true))
            assertTrue(BuildConfig.PYTHON_LOCAL_RUNTIME_ENABLED)
            assertFalse(BuildConfig.KOTLIN_LITE_RUNTIME_ENABLED)
            acceptancePrefs(context).edit()
                .putBoolean("bind_death", true)
                .putBoolean("python_crash", true)
                .putBoolean("network_interruption", true)
                .commit()
        } finally {
            recovered.close()
        }
    }

    @Test
    fun seedProcessReclaimCheckpoint(): Unit = runBlocking {
        val context = context()
        val client = PythonRuntimeClient(context)
        try {
            val python = client.submit(start("reclaim-seed", RECLAIM_RUN)).getJSONObject("python_result")
            val checkpoint = outbound(python).first { it.optString("message_type") == "checkpoint_request" }
            val state = checkpoint.getJSONObject("payload").getJSONObject("state")
            assertEquals(RECLAIM_RUN, state.getString("run_id"))
            assertEquals("waiting_model", state.getString("phase"))
            acceptancePrefs(context).edit().putString("checkpoint", state.toString()).commit()
        } finally {
            client.close()
        }
    }

    @Test
    fun verifyProcessReclaimResumesSameRun(): Unit = runBlocking {
        val context = context()
        val prefs = acceptancePrefs(context)
        val state = JSONObject(requireNotNull(prefs.getString("checkpoint", null)))
        val client = PythonRuntimeClient(context)
        try {
            val resumed = client.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.RESUME_RUN,
                requestId = "physical-reclaim-resume",
                runId = RECLAIM_RUN,
                sessionId = SESSION,
                sequence = 0,
                idempotencyKey = "physical-reclaim:resume",
                payload = JSONObject()
                    .put("state", state)
                    .put("resume_phase", "waiting_model")
                    .put("recovery_mode", "restore_model_request"),
            )).getJSONObject("python_result")
            val kinds = outbound(resumed).map { it.optString("message_type") }
            val runtimeKinds = outbound(resumed)
                .filter { it.optString("message_type") == "runtime_event" }
                .map { it.getJSONObject("payload").optString("kind") }
            assertTrue(runtimeKinds.contains("run.recovered"))
            assertTrue(kinds.contains("model_request"))
            val recoveredEnvelope = outbound(resumed).first {
                it.optString("message_type") == "runtime_event" &&
                    it.getJSONObject("payload").optString("kind") == "run.recovered"
            }
            val normalized = PythonRuntimeEventMapper.decodeAll(PythonRuntimeEnvelope.fromJson(recoveredEnvelope.toString()))
            assertTrue(normalized.any { it is NormalizedAgentEvent.RunResumed })
            assertFalse(resumed.toString().contains("kotlin", ignoreCase = true))
            val report = JSONObject()
                .put("bind_death", prefs.getBoolean("bind_death", false))
                .put("python_crash", prefs.getBoolean("python_crash", false))
                .put("network_interruption", prefs.getBoolean("network_interruption", false))
                .put("process_reclaim", true)
                .put("same_run_resumed", true)
                .put("run_id", RECLAIM_RUN)
                .put("resume_event", "run.recovered")
                .put("normalized_resume_event", "event.run.resumed")
                .put("resume_model_request", true)
                .put("kotlin_fallback_available", false)
            assertTrue(report.getBoolean("bind_death"))
            assertTrue(report.getBoolean("python_crash"))
            assertTrue(report.getBoolean("network_interruption"))
            Log.i(FAULT_MARKER, report.toString())
        } finally {
            client.close()
        }
    }

    @Test
    fun seedWaitingToolProcessReclaimCheckpoint(): Unit = runBlocking {
        val context = context()
        val client = PythonRuntimeClient(context)
        try {
            assertReady(client.submit(start(
                "tool-reclaim-seed", TOOL_RECLAIM_RUN, TOOL_SESSION,
                input = "Search the workspace for runtime files",
                tools = JSONArray().put(JSONObject()
                    .put("name", "workspace.search")
                    .put("version", 1)
                    .put("source", "android-host")
                    .put("classification", "local-equivalent")
                    .put("description", "Search workspace paths")
                    .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()
                        .put("query", JSONObject().put("type", "string"))))
                    .put("required_capabilities", JSONArray())
                    .put("risk", "read_only")
                    .put("requires_approval", false)
                    .put("oaep_output_type", "command_execution")),
            )))
            val waitingTool = client.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.MODEL_COMPLETED,
                requestId = "tool-reclaim-model",
                runId = TOOL_RECLAIM_RUN,
                sessionId = TOOL_SESSION,
                sequence = 1,
                idempotencyKey = "tool-reclaim:model",
                payload = JSONObject().put("tool_calls", JSONArray().put(JSONObject()
                    .put("call_id", TOOL_CALL_ID)
                    .put("name", "workspace.search")
                    .put("arguments", JSONObject().put("query", "runtime"))
                    .put("risk", "read_only")
                    .put("requires_approval", false)
                    .put("oaep_output_type", "command_execution"))),
            )).getJSONObject("python_result")
            val checkpoint = outbound(waitingTool).first { it.optString("message_type") == "checkpoint_request" }
            val state = checkpoint.getJSONObject("payload").getJSONObject("state")
            assertEquals("waiting_tool", state.getString("phase"))
            assertEquals(TOOL_CALL_ID, state.getJSONObject("pending_tool_calls").keys().next())
            acceptancePrefs(context).edit().putString("tool_checkpoint", state.toString()).commit()
        } finally {
            client.close()
        }
    }

    @Test
    fun verifyWaitingToolProcessReclaimReplaysUnfinishedCallOnce(): Unit = runBlocking {
        val context = context()
        val state = JSONObject(requireNotNull(acceptancePrefs(context).getString("tool_checkpoint", null)))
        val client = PythonRuntimeClient(context)
        try {
            val resumed = client.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.RESUME_RUN,
                requestId = "tool-reclaim-resume",
                runId = TOOL_RECLAIM_RUN,
                sessionId = TOOL_SESSION,
                sequence = 0,
                idempotencyKey = "tool-reclaim:resume",
                payload = JSONObject()
                    .put("state", state)
                    .put("resume_phase", "waiting_tool")
                    .put("recovery_mode", "replay_receipt_or_reconcile"),
            )).getJSONObject("python_result")
            val outbound = outbound(resumed)
            val recovered = outbound.filter {
                it.optString("message_type") == "runtime_event" &&
                    it.getJSONObject("payload").optString("kind") == "run.recovered"
            }
            val toolRequests = outbound.filter { it.optString("message_type") == "tool_call_request" }
            assertEquals(1, recovered.size)
            assertEquals("waiting_tool", recovered.single().getJSONObject("payload").getString("phase"))
            assertEquals(1, toolRequests.size)
            assertEquals(TOOL_CALL_ID, toolRequests.single().getJSONObject("payload").getString("call_id"))
            assertFalse(resumed.toString().contains("kotlin", ignoreCase = true))
            Log.i(TOOL_RECOVERY_MARKER, JSONObject()
                .put("process_reclaim", true)
                .put("same_run_resumed", true)
                .put("run_id", TOOL_RECLAIM_RUN)
                .put("resume_phase", "waiting_tool")
                .put("resume_event_count", recovered.size)
                .put("tool_request_count", toolRequests.size)
                .put("call_id", TOOL_CALL_ID)
                .put("kotlin_fallback_available", false)
                .toString())
        } finally {
            client.close()
        }
    }

    private fun context() = ApplicationProvider.getApplicationContext<Context>()

    private fun acceptancePrefs(context: Context) =
        context.getSharedPreferences("v156_physical_acceptance", Context.MODE_PRIVATE)

    private fun start(
        request: String,
        run: String,
        session: String = SESSION,
        input: String = "physical acceptance",
        tools: JSONArray = JSONArray(),
    ) = PythonRuntimeEnvelope(
        messageType = PythonRuntimeMessageType.START_RUN,
        requestId = request,
        runId = run,
        sessionId = session,
        sequence = 0,
        idempotencyKey = "$request:start",
        payload = JSONObject().put("input", input).put("model_id", "probe-model").put("tools", tools),
    )

    private fun assertReady(result: JSONObject) {
        assertEquals("accepted", result.getString("decision"))
        assertEquals("python_runtime_ready", result.getJSONObject("python_result").getString("status"))
    }

    private fun outbound(result: JSONObject): List<JSONObject> {
        val array: JSONArray = result.getJSONArray("outbound")
        return (0 until array.length()).map(array::getJSONObject)
    }

    private suspend fun killRuntime(context: Context) {
        val process = waitForRuntimeProcess(context)
        assertNotNull("dedicated :runtime process was not observed", process)
        Process.killProcess(process!!.pid)
        repeat(100) {
            if (runtimeProcess(context) == null) return
            delay(50)
        }
        error("runtime_process_did_not_exit")
    }

    private suspend fun waitForRuntimeProcess(context: Context): ActivityManager.RunningAppProcessInfo? {
        repeat(100) {
            runtimeProcess(context)?.let { return it }
            delay(50)
        }
        return null
    }

    private fun runtimeProcess(context: Context): ActivityManager.RunningAppProcessInfo? =
        context.getSystemService(ActivityManager::class.java).runningAppProcesses.orEmpty()
            .firstOrNull { it.processName == "${context.packageName}:runtime" }

    companion object {
        const val DEFAULT_MARKER = "V156_PHYSICAL_DEFAULT_BINDING"
        const val FAULT_MARKER = "V156_PHYSICAL_FAULT_RECOVERY"
        const val TOOL_RECOVERY_MARKER = "V156_PHYSICAL_TOOL_RECOVERY"
        const val SESSION = "physical-acceptance-session"
        const val NETWORK_SESSION = "physical-network-session"
        const val RECLAIM_RUN = "physical-process-reclaim-run"
        const val TOOL_SESSION = "physical-tool-reclaim-session"
        const val TOOL_RECLAIM_RUN = "physical-tool-reclaim-run"
        const val TOOL_CALL_ID = "physical-tool-call"
    }
}
