package ai.drsai.remote.runtime.python

import org.json.JSONObject

data class PythonRuntimeExecutionResult(
    val decision: MailboxDecision,
    val requestId: String?,
    val code: String,
    val status: String?,
    val outbound: List<PythonRuntimeEnvelope>,
) {
    companion object {
        fun fromJson(root: JSONObject): PythonRuntimeExecutionResult {
            val python = root.optJSONObject("python_result")
            val outbound = python?.optJSONArray("outbound")
            return PythonRuntimeExecutionResult(
                decision = MailboxDecision.valueOf(root.getString("decision").uppercase()),
                requestId = root.optString("request_id").ifBlank { null },
                code = root.getString("code"),
                status = python?.optString("status")?.ifBlank { null },
                outbound = buildList {
                    if (outbound != null) {
                        repeat(outbound.length()) { index ->
                            add(PythonRuntimeEnvelope.fromJson(outbound.getJSONObject(index).toString()))
                        }
                    }
                },
            )
        }
    }
}
