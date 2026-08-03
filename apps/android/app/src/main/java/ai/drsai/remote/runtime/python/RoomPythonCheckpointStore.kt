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
