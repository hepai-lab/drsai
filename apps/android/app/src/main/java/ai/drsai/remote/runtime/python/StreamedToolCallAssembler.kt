package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ToolCallDelta
import org.json.JSONArray
import org.json.JSONObject

internal class StreamedToolCallAssembler(
    private val maxCalls: Int = 8,
    private val maxArgumentsChars: Int = 1_048_576,
) {
    private data class Pending(
        var id: String? = null,
        var name: String? = null,
        val arguments: StringBuilder = StringBuilder(),
    )

    private val pending = linkedMapOf<Int, Pending>()

    fun append(delta: ToolCallDelta) {
        if (delta.index !in 0 until maxCalls) fail("index_out_of_range:${delta.index}")
        val call = pending.getOrPut(delta.index) { Pending() }
        delta.id?.takeIf(String::isNotBlank)?.let { value ->
            if (call.id != null) fail("duplicate_id:${delta.index}")
            call.id = value
        }
        delta.name?.takeIf(String::isNotBlank)?.let { value ->
            if (call.name != null) fail("duplicate_name:${delta.index}")
            call.name = value
        }
        if (delta.arguments.isNotEmpty()) {
            if (call.arguments.length + delta.arguments.length > maxArgumentsChars) fail("arguments_too_large:${delta.index}")
            call.arguments.append(delta.arguments)
        }
    }

    fun finish(): JSONArray {
        if (pending.isEmpty()) return JSONArray()
        val indexes = pending.keys.sorted()
        if (indexes != (0 until indexes.size).toList()) fail("index_gap")
        val ids = mutableSetOf<String>()
        return JSONArray(indexes.map { index ->
            val call = pending.getValue(index)
            val id = call.id ?: fail("id_missing:$index")
            val name = call.name ?: fail("name_missing:$index")
            if (!ids.add(id)) fail("id_reused:$id")
            val arguments = try {
                JSONObject(call.arguments.toString().ifBlank { "{}" })
            } catch (_: Throwable) {
                fail("arguments_invalid_json:$index")
            }
            JSONObject().put("call_id", id).put("name", name).put("arguments", arguments)
        })
    }

    private fun fail(reason: String): Nothing = throw ApiException(
        502,
        "model_tool_stream_invalid:$reason",
        retryable = false,
        code = "model_tool_stream_invalid",
    )
}
