package ai.drsai.remote.runtime.python

import org.json.JSONObject

const val PYTHON_RUNTIME_PROTOCOL_VERSION = 1
private const val MAX_IDENTIFIER_LENGTH = 128
private const val MAX_IDEMPOTENCY_KEY_LENGTH = 256

enum class PythonRuntimeMessageType(val wireName: String) {
    START_RUN("start_run"), CANCEL_RUN("cancel_run"), RESUME_RUN("resume_run"),
    MODEL_CHUNK("model_chunk"), MODEL_COMPLETED("model_completed"), MODEL_FAILED("model_failed"),
    TOOL_RESULT("tool_result"), APPROVAL_RESULT("approval_result"),
    LIFECYCLE_CHANGED("lifecycle_changed"), ARTIFACT_RESULT("artifact_result"), RUNTIME_EVENT("runtime_event"),
    MODEL_REQUEST("model_request"), TOOL_CALL_REQUEST("tool_call_request"),
    APPROVAL_REQUEST("approval_request"), CHECKPOINT_REQUEST("checkpoint_request"),
    ARTIFACT_REQUEST("artifact_request");

    companion object {
        fun fromWireName(value: String): PythonRuntimeMessageType =
            entries.firstOrNull { it.wireName == value } ?: error("message_type_invalid")
    }
}

data class PythonRuntimeEnvelope(
    val messageType: PythonRuntimeMessageType,
    val requestId: String,
    val runId: String,
    val sessionId: String,
    val sequence: Long,
    val idempotencyKey: String,
    val payload: JSONObject,
    val protocolVersion: Int = PYTHON_RUNTIME_PROTOCOL_VERSION,
) {
    init {
        require(protocolVersion == PYTHON_RUNTIME_PROTOCOL_VERSION) { "unsupported_protocol_version" }
        requireIdentifier("request_id", requestId)
        requireIdentifier("run_id", runId)
        requireIdentifier("session_id", sessionId)
        require(idempotencyKey.isNotEmpty() && idempotencyKey.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
            "idempotency_key_invalid"
        }
        require(sequence >= 0) { "sequence_invalid" }
    }

    fun toJson(): String = JSONObject()
        .put("protocol_version", protocolVersion)
        .put("message_type", messageType.wireName)
        .put("request_id", requestId)
        .put("run_id", runId)
        .put("session_id", sessionId)
        .put("sequence", sequence)
        .put("idempotency_key", idempotencyKey)
        .put("payload", payload)
        .toString()

    companion object {
        private val expectedFields = setOf(
            "protocol_version", "message_type", "request_id", "run_id", "session_id",
            "sequence", "idempotency_key", "payload",
        )

        fun fromJson(value: String): PythonRuntimeEnvelope {
            val root = JSONObject(value)
            require(root.keys().asSequence().toSet() == expectedFields) { "envelope_fields_invalid" }
            return PythonRuntimeEnvelope(
                protocolVersion = root.getInt("protocol_version"),
                messageType = PythonRuntimeMessageType.fromWireName(root.getString("message_type")),
                requestId = root.getString("request_id"),
                runId = root.getString("run_id"),
                sessionId = root.getString("session_id"),
                sequence = root.getLong("sequence"),
                idempotencyKey = root.getString("idempotency_key"),
                payload = root.getJSONObject("payload"),
            )
        }
    }
}

private fun requireIdentifier(name: String, value: String) {
    require(value.isNotEmpty() && value.length <= MAX_IDENTIFIER_LENGTH) { "${name}_invalid" }
}
