package ai.drsai.remote.runtime.python

import org.json.JSONObject
import org.json.JSONArray

object PythonRunRecovery {
    private val resumablePhases = setOf("waiting_model", "waiting_tool", "waiting_approval", "running", "paused")
    private val terminalPhases = setOf("completed", "cancelled", "failed")

    suspend fun resumeEnvelope(
        runId: String,
        sessionId: String,
        store: PythonStateStoreHostPort,
        allowedToolNames: Set<String>? = null,
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
        val state = JSONObject(checkpoint.state.toString())
        if (allowedToolNames != null) {
            val tools = state.optJSONArray("tools") ?: JSONArray()
            state.put("tools", JSONArray().apply {
                repeat(tools.length()) { index ->
                    tools.getJSONObject(index).takeIf { it.optString("name") in allowedToolNames }?.let(::put)
                }
            })
            val skills = state.optJSONArray("skills") ?: JSONArray()
            state.put("skills", JSONArray().apply {
                repeat(skills.length()) { index ->
                    val skill = skills.getJSONObject(index)
                    val required = skill.optJSONArray("tools") ?: JSONArray()
                    if ((0 until required.length()).all { required.getString(it) in allowedToolNames }) put(skill)
                }
            })
        }
        return PythonRuntimeEnvelope(
            messageType = PythonRuntimeMessageType.RESUME_RUN,
            requestId = "$runId:resume:${checkpoint.sequence}",
            runId = runId,
            sessionId = sessionId,
            sequence = 0,
            idempotencyKey = "$runId:resume:${checkpoint.sequence}",
            payload = JSONObject()
                .put("state", state)
                .put("resume_phase", phase)
                .put("recovery_mode", recoveryMode),
        )
    }
}
