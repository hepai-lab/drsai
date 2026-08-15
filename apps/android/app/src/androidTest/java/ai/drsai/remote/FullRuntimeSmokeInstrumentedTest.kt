package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FullRuntimeSmokeInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun sharedPythonRuntimeCompletesModelToolResultAndFinalAnswer(): Unit = runBlocking {
        val runtime = PythonRuntimeClient(context, idleTimeoutMs = -1)
        val model = ClockFixtureModel(callTool = true)
        try {
            runtime.bind()
            val report = FullRuntimeSmokeRunner(runtime, model).run("fixture-model")
            assertTrue(report.passed)
            assertEquals(2, report.modelRequests)
            assertEquals(1, report.toolCalls)
            assertEquals(1, report.successfulToolResults)
            assertEquals(1, report.finalAnswers)
            assertTrue(report.runCompleted)
            assertFalse(report.runFailed)

            val identity = FullRuntimeSmokeIdentity(
                "account-${UUID.randomUUID()}", "provider", 7, "fixture-model", "1.5.7", 10,
            )
            val store = FullRuntimeSmokeStore(context)
            assertFalse(store.isVerified(identity))
            store.saveVerified(identity, report, System.currentTimeMillis())
            assertTrue(store.isVerified(identity))
            assertFalse(store.isVerified(identity.copy(providerRevision = 8)))
            assertFalse(store.isVerified(identity.copy(modelId = "other-model")))
            assertFalse(store.isVerified(identity.copy(credentialGeneration = 11)))
        } finally {
            runtime.close()
        }
    }

    @Test fun directAnswerCannotMarkAgentAvailable(): Unit = runBlocking {
        val runtime = PythonRuntimeClient(context, idleTimeoutMs = -1)
        try {
            runtime.bind()
            val report = FullRuntimeSmokeRunner(runtime, ClockFixtureModel(callTool = false)).run("fixture-model")
            assertFalse(report.passed)
            assertTrue(report.modelRequests >= 1)
            assertEquals(0, report.toolCalls)
            assertEquals(0, report.successfulToolResults)
            assertEquals(0, report.finalAnswers)
            assertTrue(report.runFailed)
            assertThrows(IllegalArgumentException::class.java) {
                FullRuntimeSmokeStore(context).saveVerified(
                    FullRuntimeSmokeIdentity("account", "provider", 1, "model", "1.5.7", 1), report, 1,
                )
            }
        } finally {
            runtime.close()
        }
    }

    private class ClockFixtureModel(private val callTool: Boolean) : PythonModelHostPort {
        private var first = true
        override fun stream(request: HostModelRequest): Flow<HostModelChunk> {
            if (callTool && first) {
                first = false
                return flowOf(HostModelChunk(
                    request.requestId,
                    finishReason = "tool_calls",
                    toolCalls = JSONArray().put(JSONObject()
                        .put("call_id", "smoke-clock-call")
                        .put("name", "get_current_time")
                        .put("arguments", JSONObject())),
                ))
            }
            return flowOf(HostModelChunk(request.requestId, "Full Runtime 功能检查完成。", "stop"))
        }
    }
}
