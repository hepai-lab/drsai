package ai.drsai.remote.data

import org.json.JSONArray
import org.json.JSONObject

internal object ModelToolChoiceProtocolAdapter {
    const val VERSION = "p9-tool-choice-v1"

    fun automatic() = JSONObject().put("policy_version", VERSION).put("mode", "auto")
    fun none() = JSONObject().put("policy_version", VERSION).put("mode", "none")

    fun openAi(policy: JSONObject): Any? = when (val mode = validate(policy)) {
        "auto", "none" -> mode
        // Some OpenAI-compatible reasoning models reject required/named
        // tool_choice. The Kernel still enforces tool use; constrain the
        // request-visible tool surface instead and omit the vendor field.
        "required", "specified" -> null
        else -> error("unreachable_tool_choice:$mode")
    }

    fun constrainOpenAiTools(policy: JSONObject, tools: JSONArray): JSONArray {
        val mode = validate(policy)
        if (mode !in setOf("required", "specified")) return JSONArray(tools.toString())
        val canonicalNames = if (mode == "specified") {
            listOf(policy.getString("specified_tool"))
        } else {
            val matching = policy.optJSONArray("matching_tools")
                ?: throw policyError("matching_tools_missing")
            (0 until matching.length()).map { index -> matching.optString(index).trim() }
                .filter(String::isNotBlank)
                .distinct()
                .ifEmpty { throw policyError("matching_tools_missing") }
        }
        val wireNames = canonicalNames.map(::toHaiToolName).toSet()
        val constrained = JSONArray()
        repeat(tools.length()) { index ->
            val tool = tools.optJSONObject(index) ?: throw policyError("tool_not_object")
            val name = tool.optJSONObject("function")?.optString("name").orEmpty()
            if (name in wireNames) constrained.put(JSONObject(tool.toString()))
        }
        if (constrained.length() != wireNames.size) throw policyError("matching_tool_unavailable")
        return constrained
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
        // Python/OAEP serializes an absent optional field as JSON null. Android
        // org.json's optString(JSONObject.NULL) returns the literal "null",
        // which previously made auto/none look like a named-tool request.
        val specified = if (!policy.has("specified_tool") || policy.isNull("specified_tool")) {
            ""
        } else {
            policy.optString("specified_tool")
        }
        if (mode == "specified" && specified.isBlank()) throw policyError("specified_tool_missing")
        if (mode != "specified" && specified.isNotBlank()) throw policyError("specified_tool_unexpected")
        return mode
    }

    private fun policyError(reason: String) = ApiException(
        422, "model_tool_choice_invalid:$reason", retryable = false, code = "model_tool_choice_invalid",
    )
}
