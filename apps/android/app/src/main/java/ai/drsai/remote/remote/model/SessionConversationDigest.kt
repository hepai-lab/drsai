package ai.drsai.remote.remote.model

import ai.drsai.remote.remote.generated.GeneratedConversationSnapshot
import ai.drsai.remote.remote.generated.GeneratedSessionConversationItem
import java.security.MessageDigest

/**
 * Canonical transcript digest shared by real-device V3 acceptance.
 *
 * Transport cursors, timestamps and snapshot watermarks are intentionally not
 * included: the digest represents the converged user-visible transcript.
 */
fun sessionConversationDigest(snapshot: GeneratedConversationSnapshot): String =
    sessionConversationDigest(snapshot.items)

fun sessionConversationDigest(items: List<GeneratedSessionConversationItem>): String {
    val canonical = items
        .sortedWith(compareBy<GeneratedSessionConversationItem> { it.sessionSequence }
            .thenBy { it.itemId })
        .joinToString(prefix = "[", postfix = "]", separator = ",") { item ->
            canonicalJson(
                linkedMapOf(
                    "item_id" to item.itemId,
                    "session_id" to item.sessionId,
                    "run_id" to item.runId,
                    "kind" to item.kind,
                    "role" to item.role,
                    "revision" to item.revision,
                    "session_sequence" to item.sessionSequence,
                    "source_client" to item.sourceClient,
                    "source_message_id" to item.sourceMessageId,
                    "payload" to item.payload,
                ),
            )
        }
    return MessageDigest.getInstance("SHA-256")
        .digest(canonical.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

private fun canonicalJson(value: Any?): String = when (value) {
    null -> "null"
    is Boolean -> if (value) "true" else "false"
    is Byte, is Short, is Int, is Long -> value.toString()
    is Float -> canonicalNumber(value.toDouble())
    is Double -> canonicalNumber(value)
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
                else -> if (character.code < 0x20) {
                    append("\\u%04x".format(character.code))
                } else {
                    append(character)
                }
            }
        }
        append('"')
    }
    is Map<*, *> -> value.entries
        .map { entry ->
            require(entry.key is String) { "conversation_digest_key_invalid" }
            entry.key as String to entry.value
        }
        .sortedBy { it.first }
        .joinToString(prefix = "{", postfix = "}", separator = ",") { (key, nested) ->
            "${canonicalJson(key)}:${canonicalJson(nested)}"
        }
    is Iterable<*> -> value.joinToString(
        prefix = "[",
        postfix = "]",
        separator = ",",
        transform = ::canonicalJson,
    )
    is Array<*> -> value.asIterable().joinToString(
        prefix = "[",
        postfix = "]",
        separator = ",",
        transform = ::canonicalJson,
    )
    else -> error("conversation_digest_value_invalid:${value::class.java.simpleName}")
}

private fun canonicalNumber(value: Double): String {
    require(value.isFinite()) { "conversation_digest_number_invalid" }
    return if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()
}
