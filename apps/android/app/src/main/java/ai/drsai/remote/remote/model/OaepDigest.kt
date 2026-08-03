package ai.drsai.remote.remote.model

import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.generated.OaepItem
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

fun oaepItemsDigest(items: List<OaepItem>): String {
    val canonical = canonicalOaep(items
        .sortedWith(compareBy<OaepItem> { it.runId }.thenBy { it.sequence }.thenBy { it.id })
        .map { item ->
            val json = OaepJsonCodec.itemJson(item)
            linkedMapOf(
                "id" to item.id,
                "session_id" to item.sessionId,
                "run_id" to item.runId,
                "type" to item.type,
                "status" to item.status,
                "sequence" to item.sequence,
                "source" to json.getJSONObject("source"),
                "content" to json.getJSONObject("content"),
            )
        })
    return MessageDigest.getInstance("SHA-256")
        .digest(canonical.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

private fun canonicalOaep(value: Any?): String = when (value) {
    null -> "null"
    is Boolean -> if (value) "true" else "false"
    is Byte, is Short, is Int, is Long -> value.toString()
    is Float -> canonicalOaepNumber(value.toDouble())
    is Double -> canonicalOaepNumber(value)
    is Number -> value.toString()
    is String -> buildString {
        append('"')
        value.forEach { character ->
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) append("\\u%04x".format(character.code)) else append(character)
            }
        }
        append('"')
    }
    is JSONObject -> value.keys().asSequence().toList().sorted()
        .joinToString(prefix = "{", postfix = "}", separator = ",") { key ->
            "${canonicalOaep(key)}:${canonicalOaep(value.get(key).let { if (it === JSONObject.NULL) null else it })}"
        }
    is JSONArray -> (0 until value.length()).joinToString(
        prefix = "[", postfix = "]", separator = ","
    ) { index -> canonicalOaep(value.get(index).let { if (it === JSONObject.NULL) null else it }) }
    is Map<*, *> -> value.entries.map { entry ->
        require(entry.key is String) { "oaep_digest_key_invalid" }
        entry.key as String to entry.value
    }.sortedBy { it.first }.joinToString(prefix = "{", postfix = "}", separator = ",") { (key, nested) ->
        "${canonicalOaep(key)}:${canonicalOaep(nested)}"
    }
    is Iterable<*> -> value.joinToString(prefix = "[", postfix = "]", separator = ",", transform = ::canonicalOaep)
    is Array<*> -> value.asIterable().joinToString(prefix = "[", postfix = "]", separator = ",", transform = ::canonicalOaep)
    else -> error("oaep_digest_value_invalid:${value::class.java.simpleName}")
}

private fun canonicalOaepNumber(value: Double): String {
    require(value.isFinite()) { "oaep_digest_number_invalid" }
    return if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()
}
