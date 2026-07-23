package ai.drsai.remote.runtime.security

import ai.drsai.remote.workbench.model.ApprovalStatus
import ai.drsai.remote.workbench.model.WorkbenchId
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

data class ApprovalBinding(
    val runId: WorkbenchId,
    val toolCallId: String,
    val toolId: String,
    val argumentsDigest: String,
    val scope: String,
) {
    init {
        require(toolCallId.isNotBlank()) { "tool_call_id_required" }
        require(toolId.isNotBlank()) { "tool_id_required" }
        require(argumentsDigest.matches(Regex("^[a-f0-9]{64}$"))) { "arguments_digest_invalid" }
        require(scope.isNotBlank()) { "approval_scope_required" }
    }

    companion object {
        fun create(runId: WorkbenchId, toolCallId: String, toolId: String, rawArguments: String, scope: String) =
            ApprovalBinding(runId, toolCallId, toolId, sha256(canonicalJson(rawArguments)), scope)

        private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }

        private fun canonicalJson(raw: String): String = canonical(JSONObject(raw.ifBlank { "{}" }))

        private fun canonical(value: Any?): String = when (value) {
            null, JSONObject.NULL -> "null"
            is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(prefix = "{", postfix = "}") {
                JSONObject.quote(it) + ":" + canonical(value.get(it))
            }
            is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.get(it)) }
            is String -> JSONObject.quote(value)
            is Number, is Boolean -> value.toString()
            else -> JSONObject.quote(value.toString())
        }
    }
}

enum class ApprovalDecision { ALLOW_ONCE, ALLOW_SESSION, DECLINE, CANCEL }

data class ApprovalRequestState(
    val approvalId: WorkbenchId,
    val binding: ApprovalBinding,
    val status: ApprovalStatus = ApprovalStatus.PENDING,
    val expiresAtMillis: Long,
    val decidedAtMillis: Long? = null,
    val decision: ApprovalDecision? = null,
) {
    fun decide(candidate: ApprovalBinding, decision: ApprovalDecision, nowMillis: Long): ApprovalRequestState {
        require(status == ApprovalStatus.PENDING) { "approval_already_decided" }
        require(nowMillis <= expiresAtMillis) { "approval_expired" }
        require(candidate == binding) { "approval_binding_mismatch" }
        val nextStatus = when (decision) {
            ApprovalDecision.ALLOW_ONCE, ApprovalDecision.ALLOW_SESSION -> ApprovalStatus.APPROVED
            ApprovalDecision.DECLINE -> ApprovalStatus.DECLINED
            ApprovalDecision.CANCEL -> ApprovalStatus.CANCELLED
        }
        return copy(status = nextStatus, decidedAtMillis = nowMillis, decision = decision)
    }

    fun expire(nowMillis: Long): ApprovalRequestState =
        if (status == ApprovalStatus.PENDING && nowMillis > expiresAtMillis) copy(status = ApprovalStatus.EXPIRED) else this
}

object SensitiveDataRedactor {
    private val bearer = Regex("(?i)bearer\\s+[a-z0-9._~+/-]+=*")
    private val jsonSecret = Regex("(?i)(\"(?:access_token|refresh_token|api_key|password|cookie)\"\\s*:\\s*)\"[^\"]*\"")
    private val assignmentSecret = Regex("(?i)((?:access_token|refresh_token|api_key|password|cookie)\\s*[=:]\\s*)[^\\s,;]+")
    private val privateKey = Regex("-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----")

    fun redact(value: String): String = value
        .replace(privateKey, "[REDACTED_PRIVATE_KEY]")
        .replace(bearer, "Bearer [REDACTED]")
        .replace(jsonSecret, "$1\"[REDACTED]\"")
        .replace(assignmentSecret, "$1[REDACTED]")
}
