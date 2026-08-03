package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.RuntimeEvent

object PythonRuntimeEventMapper {
    fun map(envelope: PythonRuntimeEnvelope): RuntimeEvent? {
        require(envelope.messageType == PythonRuntimeMessageType.RUNTIME_EVENT) { "runtime_event_required" }
        val payload = envelope.payload
        return when (payload.getString("kind")) {
            "run.started" -> RuntimeEvent.Started(envelope.runId)
            "message.delta" -> RuntimeEvent.TextDelta(payload.optString("text"))
            "tool.started" -> RuntimeEvent.ToolStarted(payload.getString("name"))
            "tool.result" -> RuntimeEvent.ToolFinished(payload.getString("name"))
            "tool.error" -> RuntimeEvent.ToolFailed(payload.getString("name"), payload.optString("code", "tool_failed"))
            "tool.downgraded" -> RuntimeEvent.ToolDowngraded(payload.getString("reason"))
            "run.completed" -> RuntimeEvent.Completed
            "run.cancelled" -> RuntimeEvent.Cancelled
            "run.paused" -> RuntimeEvent.Paused
            "run.failed" -> RuntimeEvent.Failed(
                payload.optString("message", payload.optString("code", "python_runtime_failed")),
                payload.optBoolean("retryable", true),
            )
            "approval.requested", "approval.decided", "checkpoint.saved" -> null
            else -> null
        }
    }
}
