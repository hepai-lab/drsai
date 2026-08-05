package ai.drsai.remote

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.runtime.python.HostCheckpoint
import ai.drsai.remote.runtime.python.RoomPythonCheckpointStore
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchId
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomPythonCheckpointStoreTest {
    @Test
    fun checkpointMergesCoreStateAndHostToolReceiptOnRunRow() = runBlocking {
        val database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
        try {
            RoomRunJournal(database).createIfAbsent(
                RunCommand(
                    "subject", "", RuntimeBinding(WorkbenchId("android-local"), RuntimeAuthority.LOCAL_DEVICE),
                    WorkbenchId("local"), WorkbenchId("session-1"), WorkbenchId("run-1"),
                    "opendrsai", "start:run-1", "hello",
                )
            )
            val store = RoomPythonCheckpointStore(database)
            store.saveCheckpoint(HostCheckpoint("run-1", 2, JSONObject().put("phase", "waiting_tool")))
            store.saveCheckpoint(
                HostCheckpoint(
                    "run-1",
                    3,
                    JSONObject().put(
                        "_host_tool_results",
                        JSONObject().put("call-1", JSONObject().put("succeeded", true)),
                    ),
                )
            )

            val restored = requireNotNull(store.loadCheckpoint("run-1"))
            assertEquals(3, restored.sequence)
            assertEquals("waiting_tool", restored.state.getString("phase"))
            assertEquals(true, restored.state.getJSONObject("_host_tool_results").getJSONObject("call-1").getBoolean("succeeded"))
        } finally {
            database.close()
        }
    }
}
