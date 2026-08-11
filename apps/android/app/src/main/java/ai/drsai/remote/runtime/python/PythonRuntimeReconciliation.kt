package ai.drsai.remote.runtime.python

import ai.drsai.remote.runtime.coordinator.ChatRunRequest
import java.security.MessageDigest
import org.json.JSONObject

object PythonRuntimeReconciliation {
    fun envelope(request: ChatRunRequest, failure: String): PythonRuntimeEnvelope? {
        val binding = when {
            failure.startsWith("python_tool_needs_reconciliation:") ->
                "tool" to failure.substringAfter(':')
            failure.startsWith("artifact_needs_reconciliation:") ->
                "artifact" to failure.substringAfter(':')
            else -> return null
        }
        val (kind, operationId) = binding
        require(operationId.isNotBlank()) { "reconciliation_operation_id_required" }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("${request.runId}\u0000$kind\u0000$operationId".encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
        return PythonRuntimeEnvelope(
            messageType = PythonRuntimeMessageType.RUNTIME_EVENT,
            requestId = "reconciliation:${digest.take(32)}",
            runId = request.runId,
            sessionId = request.conversation.id,
            sequence = 0,
            idempotencyKey = "${request.runId}:reconciliation:$digest",
            payload = JSONObject()
                .put("kind", "side_effect.reconciliation_required")
                .put("operation_id", operationId.take(128))
                .put("side_effect_kind", kind)
                .put("operation", "$kind.reconcile"),
        )
    }
}
