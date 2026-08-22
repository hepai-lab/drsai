package ai.drsai.remote.runtime.tools

import org.json.JSONArray
import org.json.JSONObject

/** Model-visible catalog: host tools come from ToolRegistry; Core tools live here once. */
object FullRuntimeToolCatalog {
    fun schemas(hostSchemas: JSONArray): JSONArray = JSONArray().also { output ->
        repeat(hostSchemas.length()) { output.put(JSONObject(hostSchemas.getJSONObject(it).toString())) }
        coreSchemas().forEach(output::put)
    }

    private fun coreSchemas(): List<JSONObject> = listOf(
        schema(
            "core.text_stats",
            "Count characters, words, and lines in text inside the shared Python Core",
            objectSchema(
                JSONObject().put("text", JSONObject().put("type", "string").put("maxLength", 10_000)),
                setOf("text"),
            ),
        ),
        schema(
            "core.data_compute",
            "Run bounded declarative numeric calculations without code, files, imports, or network access",
            objectSchema(
                JSONObject()
                    .put("operation", JSONObject().put("type", "string").put("enum", JSONArray(listOf(
                        "count", "sum", "mean", "median", "min", "max", "sort", "histogram",
                    ))))
                    .put("values", JSONObject().put("type", "array").put("minItems", 1).put("maxItems", 10_000)
                        .put("items", JSONObject().put("type", "number")))
                    .put("bins", JSONObject().put("type", "integer").put("minimum", 1).put("maximum", 100)),
                setOf("operation", "values"),
            ),
        ),
        schema(
            "core.update_plan",
            "Publish a concise structured execution plan and update step statuses",
            objectSchema(
                JSONObject()
                    .put("expected_version", JSONObject().put("type", "integer").put("minimum", 0))
                    .put("text", JSONObject().put("type", "string"))
                    .put("explanation", JSONObject().put("type", "string"))
                    .put("steps", JSONObject().put("type", "array").put("maxItems", 50)
                        .put("items", JSONObject().put("type", "object")
                            .put("properties", JSONObject()
                                .put("id", JSONObject().put("type", "string"))
                                .put("title", JSONObject().put("type", "string"))
                                .put("status", JSONObject().put("type", "string")
                                    .put("enum", JSONArray(listOf("pending", "in_progress", "completed", "failed")))))
                            .put("required", JSONArray(listOf("title", "status"))))),
                setOf("expected_version", "steps"),
            ),
        ),
        schema(
            "delegate",
            "Run up to three focused logical subagents and summarize their results",
            objectSchema(
                JSONObject().put("tasks", JSONObject().put("type", "array").put("maxItems", 3)
                    .put("items", JSONObject().put("type", "object")
                        .put("properties", JSONObject()
                            .put("task_id", JSONObject().put("type", "string"))
                            .put("prompt", JSONObject().put("type", "string"))
                            .put("type", JSONObject().put("type", "string").put("enum", JSONArray(listOf("explore", "general"))))
                            .put("allowed_tools", JSONObject().put("type", "array").put("maxItems", 32)
                                .put("items", JSONObject().put("type", "string"))))
                        .put("required", JSONArray(listOf("task_id", "prompt"))))),
                setOf("tasks"),
            ),
        ),
    )

    private fun schema(name: String, description: String, parameters: JSONObject) = JSONObject()
        .put("name", name)
        .put("version", 1)
        .put("source", "shared-core")
        .put("classification", "shared")
        .put("description", description)
        .put("parameters", parameters)
        .put("risk", "read_only")
        .put("requires_approval", false)
        .put("title", description)
        .put("summary", "Allow $name to run inside the shared Core")
        .put("required_capabilities", JSONArray())

    private fun objectSchema(properties: JSONObject, required: Set<String>) = JSONObject()
        .put("type", "object")
        .put("properties", properties)
        .put("required", JSONArray(required.sorted()))
}
