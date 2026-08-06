package ai.drsai.remote.runtime.python

import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import org.json.JSONObject

/** Stores Core and host-side receipts on the authoritative workbench Run row. */
class RoomPythonCheckpointStore(private val database: ChatDatabase) : PythonStateStoreHostPort {
    override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) = database.withTransaction {
        val dao = database.workbenchDao()
        val encoded = PythonCheckpointCodec.merge(dao.pythonState(checkpoint.runId), checkpoint)
        check(dao.updatePythonState(checkpoint.runId, encoded, System.currentTimeMillis()) == 1) {
            "python_checkpoint_run_missing"
        }
    }

    override suspend fun loadCheckpoint(runId: String): HostCheckpoint? {
        val raw = database.workbenchDao().pythonState(runId) ?: return null
        if (!JSONObject(raw).has("sequence")) return null
        val decoded = PythonCheckpointCodec.decode(raw)
        return HostCheckpoint(runId, decoded.sequence, decoded.state)
    }
}

/** Binds a recoverable Core checkpoint to the durable OAEP authority watermark. */
class OaepBoundPythonCheckpointStore(
    private val database: ChatDatabase,
    private val delegate: PythonStateStoreHostPort,
    private val subject: String,
    private val organization: String,
    private val runtimeId: String,
    private val sessionId: String,
    private val runId: String,
) : PythonStateStoreHostPort {
    override suspend fun saveCheckpoint(checkpoint: HostCheckpoint) {
        require(checkpoint.runId == runId) { "python_checkpoint_oaep_run_mismatch" }
        val authority = database.androidOaepDao().session(subject, organization, runtimeId, sessionId)
            ?: error("python_checkpoint_oaep_session_missing")
        val run = database.androidOaepDao().run(subject, organization, runtimeId, sessionId, runId)
            ?: error("python_checkpoint_oaep_run_missing")
        val state = JSONObject(checkpoint.state.toString()).put(
            "_oaep_binding",
            JSONObject()
                .put("runtime_id", runtimeId)
                .put("session_id", sessionId)
                .put("run_id", runId)
                .put("run_status", run.status)
                .put("snapshot_sequence", authority.lastSequence),
        )
        delegate.saveCheckpoint(checkpoint.copy(state = state))
    }

    override suspend fun loadCheckpoint(runId: String): HostCheckpoint? {
        require(runId == this.runId) { "python_checkpoint_oaep_run_mismatch" }
        val checkpoint = delegate.loadCheckpoint(runId) ?: return null
        val binding = checkpoint.state.optJSONObject("_oaep_binding")
            ?: error("python_checkpoint_oaep_binding_missing")
        require(binding.getString("runtime_id") == runtimeId &&
            binding.getString("session_id") == sessionId && binding.getString("run_id") == runId
        ) { "python_checkpoint_oaep_scope_mismatch" }
        val authority = database.androidOaepDao().session(subject, organization, runtimeId, sessionId)
            ?: error("python_checkpoint_oaep_session_missing")
        require(authority.lastSequence >= binding.getLong("snapshot_sequence")) {
            "python_checkpoint_oaep_watermark_regression"
        }
        return checkpoint
    }
}
