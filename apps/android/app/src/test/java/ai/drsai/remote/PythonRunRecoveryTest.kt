package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import org.json.JSONObject
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PythonRunRecoveryTest {
    @Test
    fun `builds versioned resume command from latest nonterminal checkpoint`() = runTest {
        val store = FakeStore(HostCheckpoint("run-1", 7, JSONObject().put("phase", "waiting_model").put("model_id", "m")))

        val resume = PythonRunRecovery.resumeEnvelope("run-1", "session-1", store)

        assertEquals(PythonRuntimeMessageType.RESUME_RUN, resume.messageType)
        assertEquals("waiting_model", resume.payload.getString("resume_phase"))
        assertEquals("restore_model_request", resume.payload.getString("recovery_mode"))
        assertEquals("run-1:resume:7", resume.idempotencyKey)
        assertEquals("waiting_model", resume.payload.getJSONObject("state").getString("phase"))
    }

    @Test
    fun `recovery phase selects deterministic host action`() = runTest {
        val expected = mapOf(
            "waiting_model" to "restore_model_request",
            "waiting_tool" to "replay_receipt_or_reconcile",
            "waiting_approval" to "restore_approval",
            "paused" to "await_explicit_continue",
        )
        expected.forEach { (phase, mode) ->
            val store = FakeStore(HostCheckpoint("run-1", 4, JSONObject().put("phase", phase)))
            assertEquals(mode, PythonRunRecovery.resumeEnvelope("run-1", "session-1", store).payload.getString("recovery_mode"))
        }
    }

    @Test
    fun `terminal checkpoint cannot be resumed`() = runTest {
        val store = FakeStore(HostCheckpoint("run-1", 7, JSONObject().put("phase", "completed")))
        val error = runCatching { PythonRunRecovery.resumeEnvelope("run-1", "session-1", store) }.exceptionOrNull()
        assertEquals("python_checkpoint_terminal", error?.message)
    }

    private class FakeStore(private val checkpoint: HostCheckpoint?) : PythonStateStoreHostPort {
        override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = Unit
        override suspend fun loadCheckpoint(runId: String) = checkpoint
    }
}
