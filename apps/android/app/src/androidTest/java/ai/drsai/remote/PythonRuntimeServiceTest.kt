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
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeServiceTest {
    @Before
    fun stopRuntimeLeftByAnotherInstrumentationClass() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(ActivityManager::class.java)
        manager.runningAppProcesses
            ?.firstOrNull { it.processName == "${context.packageName}:runtime" }
            ?.let { Process.killProcess(it.pid) }
        assertTrue(
            "stale runtime process did not stop before test isolation",
            waitForRuntimeProcessExit(manager, context.packageName),
        )
    }

    @Test
    fun runtimeAutomaticallyReleasesAfterIdleTimeout() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(ActivityManager::class.java)
        val client = PythonRuntimeClient(context, idleTimeoutMs = 100)
        try {
            client.submit(startEnvelope("idle", "idle-run"))
            assertTrue(waitForRuntimeProcess(manager, context.packageName) != null)
            assertTrue(waitForRuntimeProcessExit(manager, context.packageName))
        } finally {
            client.close()
        }
    }

    @Test
    fun runtimeProcessExecutesBundledPythonCoreAndReturnsIdentity() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val client = PythonRuntimeClient(context)
        try {
            val result = client.submit(
                PythonRuntimeEnvelope(
                    messageType = PythonRuntimeMessageType.START_RUN,
                    requestId = "instrumentation-request-1",
                    runId = "instrumentation-run-1",
                    sessionId = "instrumentation-session-1",
                    sequence = 0,
                    idempotencyKey = "instrumentation:start:1",
                    payload = JSONObject()
                        .put("input", "probe")
                        .put("model_id", "probe-model")
                        .put("host_capabilities", JSONArray(listOf("chat", "safe_device_info")))
                        .put("host_port", JSONObject()
                            .put("schema_version", 1)
                            .put("protocol_version", "p9-host-port-v1")
                            .put("surface", "android")
                            .put("capabilities", JSONArray()
                                .put(JSONObject().put("id", "chat").put("version", 1).put("required", false))
                                .put(JSONObject().put("id", "safe_device_info").put("version", 1).put("required", false))))
                        .put("tools", JSONArray().put(JSONObject()
                            .put("name", "clock")
                            .put("version", 1)
                            .put("source", "android-host")
                            .put("classification", "local-equivalent")
                            .put("description", "Clock")
                            .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
                            .put("risk", "read_only")
                            .put("requires_approval", false))),
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
            val startedPayload = python.getJSONArray("outbound").getJSONObject(0).getJSONObject("payload")
            val checkpointState = python.getJSONArray("outbound").getJSONObject(1)
                .getJSONObject("payload").getJSONObject("state")
            val modelPayload = python.getJSONArray("outbound").getJSONObject(2).getJSONObject("payload")
            val snapshotDigest = checkpointState.getJSONObject("capability_snapshot").getString("sha256")
            val modelToolDigest = checkpointState.getJSONObject("model_tool_snapshot").getString("sha256")
            val executionRegistryDigest = checkpointState.getJSONObject("execution_tool_registry").getString("sha256")
            val toolLoopPolicyDigest = checkpointState.getJSONObject("tool_loop_policy").getString("sha256")
            assertEquals(1, startedPayload.getInt("tool_count"))
            assertEquals("p9-host-port-v1", startedPayload.getString("host_port_protocol_version"))
            assertEquals(64, startedPayload.getString("host_port_sha256").length)
            assertEquals(snapshotDigest, startedPayload.getString("capability_snapshot_sha256"))
            assertEquals(snapshotDigest, modelPayload.getString("capability_snapshot_sha256"))
            assertEquals("p9-model-tools-v1", startedPayload.getString("model_tool_snapshot_version"))
            assertEquals(modelToolDigest, startedPayload.getString("model_tool_snapshot_sha256"))
            assertEquals(modelToolDigest, modelPayload.getString("model_tool_snapshot_sha256"))
            assertEquals("p9-execution-tools-v1", startedPayload.getString("execution_tool_registry_version"))
            assertEquals(executionRegistryDigest, startedPayload.getString("execution_tool_registry_sha256"))
            assertEquals("p9-tool-loop-v1", startedPayload.getString("tool_loop_policy_version"))
            assertEquals(toolLoopPolicyDigest, startedPayload.getString("tool_loop_policy_sha256"))
            assertEquals(0, checkpointState.getInt("tool_round_count"))
            assertEquals("clock", modelPayload.getJSONArray("tools").getJSONObject(0).getString("name"))
            val identity = client.runtimeIdentity()
            assertNotNull("verified Agent Kernel identity was not exported from :runtime", identity)
            assertEquals("drsai-agent-kernel", identity!!.kernelId)
            assertEquals("p9.1", identity.kernelVersion)
            assertEquals(64, identity.kernelSha256.length)
            assertEquals("p9-agent-kernel-v1", identity.promptVersion)
            assertEquals("p9-tools-v1", identity.toolManifestVersion)
            assertTrue(identity.runtimeProcessName.endsWith(":runtime"))
            assertTrue(identity.runtimePid > 0)
            assertEquals("p9-capabilities-v1", identity.capabilityManifestVersion)
            assertEquals("p9-host-port-v1", identity.hostPortProtocolVersion)
            assertEquals("p9-model-tools-v1", identity.modelToolSnapshotVersion)
        } finally {
            client.close()
            assertTrue(waitForRuntimeProcessExit(
                context.getSystemService(ActivityManager::class.java),
                context.packageName,
            ))
        }
    }

    @Test
    fun checkpointRestoresIdenticalConversationAfterRuntimeProcessRestart() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(ActivityManager::class.java)
        val first = PythonRuntimeClient(context)
        lateinit var checkpointState: JSONObject
        lateinit var beforeDigest: String
        lateinit var beforeMessages: String
        try {
            val started = first.submit(startEnvelope("restart-context", "restart-run"))
                .getJSONObject("python_result").getJSONArray("outbound")
            checkpointState = started.getJSONObject(1).getJSONObject("payload").getJSONObject("state")
            val model = started.getJSONObject(2).getJSONObject("payload")
            beforeDigest = model.getJSONObject("conversation_context").getString("sha256")
            beforeMessages = model.getJSONArray("messages").toString()
        } finally {
            first.close()
        }
        assertTrue(waitForRuntimeProcessExit(manager, context.packageName))

        val second = PythonRuntimeClient(context)
        try {
            val resumed = second.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.RESUME_RUN,
                requestId = "restart-resume-request",
                runId = "restart-run",
                sessionId = "instrumentation-session-isolation",
                sequence = 1,
                idempotencyKey = "restart:resume",
                payload = JSONObject().put("state", checkpointState),
            )).getJSONObject("python_result").getJSONArray("outbound")
            assertEquals("run.recovered", resumed.getJSONObject(0).getJSONObject("payload").getString("kind"))
            val model = resumed.getJSONObject(1).getJSONObject("payload")
            assertEquals(beforeMessages, model.getJSONArray("messages").toString())
            assertEquals(beforeDigest, model.getJSONObject("conversation_context").getString("sha256"))
        } finally {
            second.close()
            assertTrue(waitForRuntimeProcessExit(manager, context.packageName))
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
            assertTrue(waitForRuntimeProcessExit(activityManager, context.packageName))
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
            assertTrue(waitForRuntimeProcessExit(
                context.getSystemService(ActivityManager::class.java),
                context.packageName,
            ))
        }
    }

    @Test
    fun chineseUnfamiliarEntityCannotBypassBundledPythonRetrievalPolicy() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val client = PythonRuntimeClient(context)
        val runId = "instrumentation-forced-retrieval-run"
        try {
            val started = client.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.START_RUN,
                requestId = "instrumentation-forced-retrieval-start",
                runId = runId,
                sessionId = "instrumentation-forced-retrieval-session",
                sequence = 0,
                idempotencyKey = "instrumentation:forced-retrieval:start",
                payload = JSONObject()
                    .put("input", "HEPiX2026是什么？")
                    .put("model_id", "probe-model")
                    .put("tools", JSONArray().put(JSONObject()
                        .put("name", "web.search")
                        .put("version", 1)
                        .put("source", "android-host")
                        .put("classification", "local-equivalent")
                        .put("description", "Search the public web")
                        .put("parameters", JSONObject().put("type", "object").put("properties", JSONObject()))
                        .put("risk", "read_only")
                        .put("requires_approval", false))),
            ))
            assertEquals("python_runtime_ready", started.getJSONObject("python_result").getString("status"))

            val guessed = client.submit(PythonRuntimeEnvelope(
                messageType = PythonRuntimeMessageType.MODEL_COMPLETED,
                requestId = "instrumentation-forced-retrieval-guess",
                runId = runId,
                sessionId = "instrumentation-forced-retrieval-session",
                sequence = 1,
                idempotencyKey = "instrumentation:forced-retrieval:guess",
                payload = JSONObject().put("content", "这是未经检索的猜测"),
            )).getJSONObject("python_result").getJSONArray("outbound")
            val semanticKinds = (0 until guessed.length()).mapNotNull { index ->
                guessed.getJSONObject(index).takeIf { it.getString("message_type") == "runtime_event" }
                    ?.getJSONObject("payload")?.getString("kind")
            }
            assertEquals(listOf("tool.decision", "verification.required"), semanticKinds)
            assertEquals("required_tool_omitted", guessed.getJSONObject(0).getJSONObject("payload").getString("category"))
            assertEquals("model_request", guessed.getJSONObject(guessed.length() - 1).getString("message_type"))
            assertTrue(guessed.toString().contains("web.search"))
            assertTrue(!guessed.toString().contains("这是未经检索的猜测"))
        } finally {
            client.close()
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
