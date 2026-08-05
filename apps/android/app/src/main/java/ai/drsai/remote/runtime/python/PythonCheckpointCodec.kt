package ai.drsai.remote.runtime.python

import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

const val PYTHON_CHECKPOINT_SCHEMA_VERSION = 2
const val PYTHON_CHECKPOINT_MIN_READER_VERSION = 2

data class DecodedPythonCheckpoint(
    val sequence: Long,
    val state: JSONObject,
    val schemaVersion: Int,
    val migratedFrom: Int? = null,
)

object PythonCheckpointCodec {
    fun encode(sequence: Long, state: JSONObject): String {
        require(sequence >= 0) { "python_checkpoint_sequence_invalid" }
        return JSONObject()
            .put("schema_version", PYTHON_CHECKPOINT_SCHEMA_VERSION)
            .put("min_reader_version", PYTHON_CHECKPOINT_MIN_READER_VERSION)
            .put("sequence", sequence)
            .put("state", state)
            .put("payload_sha256", digest(state))
            .toString()
    }

    fun decode(raw: String): DecodedPythonCheckpoint {
        val root = JSONObject(raw)
        require(root.has("sequence") && root.has("state")) { "python_checkpoint_fields_missing" }
        val version = root.optInt("schema_version", 1)
        require(version in 1..PYTHON_CHECKPOINT_SCHEMA_VERSION) { "python_checkpoint_version_unsupported" }
        val state = root.getJSONObject("state")
        if (version == 1) {
            return DecodedPythonCheckpoint(root.getLong("sequence"), state, PYTHON_CHECKPOINT_SCHEMA_VERSION, 1)
        }
        require(root.getInt("min_reader_version") <= PYTHON_CHECKPOINT_SCHEMA_VERSION) {
            "python_checkpoint_reader_too_old"
        }
        require(root.getString("payload_sha256") == digest(state)) { "python_checkpoint_checksum_mismatch" }
        return DecodedPythonCheckpoint(root.getLong("sequence"), state, version)
    }

    fun merge(currentRaw: String?, checkpoint: HostCheckpoint): String {
        val current = currentRaw?.takeIf { JSONObject(it).has("sequence") }?.let(::decode)
        require(checkpoint.sequence >= (current?.sequence ?: -1)) { "python_checkpoint_sequence_regression" }
        val merged = current?.state ?: JSONObject()
        checkpoint.state.keys().forEach { key -> merged.put(key, checkpoint.state.get(key)) }
        return encode(checkpoint.sequence, merged)
    }

    private fun digest(value: JSONObject): String = MessageDigest.getInstance("SHA-256")
        .digest(canonical(value).encodeToByteArray()).joinToString("") { "%02x".format(it) }

    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") { key ->
            "${JSONObject.quote(key)}:${canonical(value.get(key))}"
        }
        is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
        is String -> JSONObject.quote(value)
        is Boolean, is Number -> value.toString()
        else -> JSONObject.quote(value.toString())
    }
}
