package ai.drsai.remote.runtime.python

import org.json.JSONObject

object PythonRunRecovery {
    private val resumablePhases = setOf("waiting_model", "waiting_tool", "waiting_approval", "running", "paused")
    private val terminalPhases = setOf("completed", "cancelled", "failed")

    suspend fun resumeEnvelope(
        runId: String,
        sessionId: String,
        store: PythonStateStoreHostPort,
    ): PythonRuntimeEnvelope {
        val checkpoint = store.loadCheckpoint(runId) ?: error("python_checkpoint_missing")
        val phase = checkpoint.state.optString("phase")
        require(phase !in terminalPhases) { "python_checkpoint_terminal" }
        require(phase in resumablePhases) { "python_checkpoint_phase_unsupported" }
        val recoveryMode = when (phase) {
            "waiting_tool" -> "replay_receipt_or_reconcile"
            "waiting_approval" -> "restore_approval"
            "waiting_model" -> "restore_model_request"
            "paused" -> "await_explicit_continue"
            else -> "continue_checkpoint"
        }
        return PythonRuntimeEnvelope(
            messageType = PythonRuntimeMessageType.RESUME_RUN,
            requestId = "$runId:resume:${checkpoint.sequence}",
            runId = runId,
            sessionId = sessionId,
            sequence = 0,
            idempotencyKey = "$runId:resume:${checkpoint.sequence}",
            payload = JSONObject()
                .put("state", checkpoint.state)
                .put("resume_phase", phase)
                .put("recovery_mode", recoveryMode),
        )
    }
}
