package ai.drsai.remote.data

import ai.drsai.remote.runtime.python.ModelRuntimeCapabilities
import org.json.JSONArray
import org.json.JSONObject

internal object ModelToolSchemaProtocolAdapter {
    fun adapt(capabilities: ModelRuntimeCapabilities, schemas: JSONArray): JSONArray = when (capabilities.wireApi) {
        "openai" -> openAi(schemas)
        "anthropic" -> anthropic(schemas)
        else -> throw schemaError("unsupported_wire_api")
    }

    fun openAi(schemas: JSONArray): JSONArray = JSONArray().also { output ->
        repeat(schemas.length()) { index ->
            val function = canonicalFunction(schemas.optJSONObject(index), index)
            output.put(JSONObject().put("type", "function").put("function", JSONObject()
                .put("name", toHaiToolName(function.getString("name")))
                .put("description", function.getString("description"))
                .put("parameters", deepCopy(function.getJSONObject("parameters")))))
        }
    }

    fun anthropic(schemas: JSONArray): JSONArray = JSONArray().also { output ->
        repeat(schemas.length()) { index ->
            val function = canonicalFunction(schemas.optJSONObject(index), index)
            output.put(JSONObject()
                .put("name", toHaiToolName(function.getString("name")))
                .put("description", function.getString("description"))
                .put("input_schema", deepCopy(function.getJSONObject("parameters"))))
        }
    }

    private fun canonicalFunction(source: JSONObject?, index: Int): JSONObject {
        source ?: throw schemaError("tool_not_object:$index")
        val function = source.optJSONObject("function")?.also {
            if (source.optString("type", "function") != "function") throw schemaError("tool_type_invalid:$index")
        } ?: source
        val name = function.optString("name").trim()
        if (name.isBlank()) throw schemaError("tool_name_missing:$index")
        val parameters = function.optJSONObject("parameters")
            ?: throw schemaError("tool_parameters_missing:$name")
        validateSchema(parameters, "$name.parameters")
        return JSONObject()
            .put("name", name)
            .put("description", function.optString("description", name))
            .put("parameters", parameters)
    }

    private fun validateSchema(schema: JSONObject, path: String) {
        val type = schema.optString("type")
        if (type.isBlank()) throw schemaError("schema_type_missing:$path")
        if (type !in setOf("object", "array", "string", "number", "integer", "boolean", "null")) {
            throw schemaError("schema_type_invalid:$path:$type")
        }
        schema.optJSONArray("enum")?.let { values ->
            if (values.length() == 0) throw schemaError("schema_enum_empty:$path")
        }
        if (type == "object") {
            val properties = schema.optJSONObject("properties")
                ?: throw schemaError("schema_properties_missing:$path")
            val names = properties.keys().asSequence().toSet()
            names.forEach { name ->
                val child = properties.optJSONObject(name) ?: throw schemaError("schema_property_invalid:$path.$name")
                validateSchema(child, "$path.$name")
            }
            schema.optJSONArray("required")?.let { required ->
                repeat(required.length()) { index ->
                    val name = required.optString(index)
                    if (name.isBlank() || name !in names) throw schemaError("schema_required_unknown:$path:$name")
                }
            }
        }
        if (type == "array") {
            val items = schema.optJSONObject("items") ?: throw schemaError("schema_items_missing:$path")
            validateSchema(items, "$path[]")
        }
    }

    private fun deepCopy(value: JSONObject) = JSONObject(value.toString())

    private fun schemaError(reason: String) = ApiException(
        422,
        "model_tool_schema_invalid:$reason",
        retryable = false,
        code = "model_tool_schema_invalid",
    )
}
