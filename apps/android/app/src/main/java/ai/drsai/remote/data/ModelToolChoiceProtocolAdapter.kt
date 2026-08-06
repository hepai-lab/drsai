package ai.drsai.remote.data

import org.json.JSONObject

internal object ModelToolChoiceProtocolAdapter {
    const val VERSION = "p9-tool-choice-v1"

    fun automatic() = JSONObject().put("policy_version", VERSION).put("mode", "auto")
    fun none() = JSONObject().put("policy_version", VERSION).put("mode", "none")

    fun openAi(policy: JSONObject): Any = when (val mode = validate(policy)) {
        "auto", "required", "none" -> mode
        "specified" -> JSONObject().put("type", "function").put("function", JSONObject()
            .put("name", toHaiToolName(policy.getString("specified_tool"))))
        else -> error("unreachable_tool_choice:$mode")
    }

    fun anthropic(policy: JSONObject): JSONObject? = when (val mode = validate(policy)) {
        "auto" -> JSONObject().put("type", "auto")
        "required" -> JSONObject().put("type", "any")
        "none" -> null
        "specified" -> JSONObject().put("type", "tool")
            .put("name", toHaiToolName(policy.getString("specified_tool")))
        else -> error("unreachable_tool_choice:$mode")
    }

    private fun validate(policy: JSONObject): String {
        if (policy.optString("policy_version") != VERSION) throw policyError("version")
        val mode = policy.optString("mode")
        if (mode !in setOf("auto", "required", "none", "specified")) throw policyError("mode")
        val specified = policy.optString("specified_tool")
        if (mode == "specified" && specified.isBlank()) throw policyError("specified_tool_missing")
        if (mode != "specified" && specified.isNotBlank()) throw policyError("specified_tool_unexpected")
        return mode
    }

    private fun policyError(reason: String) = ApiException(
        422, "model_tool_choice_invalid:$reason", retryable = false, code = "model_tool_choice_invalid",
    )
}
