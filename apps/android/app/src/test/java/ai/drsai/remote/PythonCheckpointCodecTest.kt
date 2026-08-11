package ai.drsai.remote

import ai.drsai.remote.runtime.python.*
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PythonCheckpointCodecTest {
    @Test fun `v1 checkpoint migrates in memory and next write becomes checksummed v2`() {
        val v1 = JSONObject().put("schema_version", 1).put("sequence", 3)
            .put("state", JSONObject().put("phase", "waiting_tool")).toString()
        val decoded = PythonCheckpointCodec.decode(v1)
        assertEquals(1, decoded.migratedFrom)
        val merged = PythonCheckpointCodec.merge(v1, HostCheckpoint("run", 4, JSONObject().put("receipt", true)))
        val root = JSONObject(merged)
        assertEquals(2, root.getInt("schema_version"))
        assertEquals("waiting_tool", PythonCheckpointCodec.decode(merged).state.getString("phase"))
    }

    @Test fun `future old-reader and corrupted checkpoints fail without rewrite`() {
        val valid = PythonCheckpointCodec.encode(1, JSONObject().put("phase", "running"))
        val corrupted = JSONObject(valid).put("payload_sha256", "0".repeat(64)).toString()
        assertEquals("python_checkpoint_checksum_mismatch", runCatching { PythonCheckpointCodec.decode(corrupted) }.exceptionOrNull()?.message)
        val future = JSONObject(valid).put("schema_version", 3).toString()
        assertEquals("python_checkpoint_version_unsupported", runCatching { PythonCheckpointCodec.decode(future) }.exceptionOrNull()?.message)
        val oldReader = JSONObject(valid).put("min_reader_version", 3).toString()
        assertEquals("python_checkpoint_reader_too_old", runCatching { PythonCheckpointCodec.decode(oldReader) }.exceptionOrNull()?.message)
    }

    @Test fun `known incompatible checkpoints terminate migration but transient failures propagate`() {
        listOf(
            "python_checkpoint_fields_missing",
            "python_checkpoint_version_unsupported",
            "python_checkpoint_reader_too_old",
            "python_checkpoint_checksum_mismatch",
            "python_checkpoint_sequence_invalid",
        ).forEach { code ->
            assertEquals("python_checkpoint_incompatible", PythonCheckpointMigrationPolicy.terminalFailureCode(
                IllegalArgumentException(code),
            ))
        }
        assertEquals(null, PythonCheckpointMigrationPolicy.terminalFailureCode(IllegalStateException("database_busy")))
    }

    @Test fun `checksum is canonical across object key order`() {
        val first = PythonCheckpointCodec.encode(1, JSONObject().put("b", 2).put("a", 1))
        val second = PythonCheckpointCodec.encode(1, JSONObject().put("a", 1).put("b", 2))
        assertEquals(JSONObject(first).getString("payload_sha256"), JSONObject(second).getString("payload_sha256"))
    }
}
