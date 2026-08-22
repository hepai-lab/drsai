package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.RuntimeV2EventRecorder
import ai.drsai.remote.runtime.python.HostCheckpoint
import ai.drsai.remote.runtime.python.PythonCheckpointCodec
import ai.drsai.remote.runtime.python.PythonCheckpointMigrationPolicy
import ai.drsai.remote.runtime.python.RoomPythonCheckpointStore
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchEvent
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P9RuntimeMigrationInstrumentedTest {
    @Test
    fun v156DataCheckpointReceiptAndIncompatibleRunsMigrateWithoutIdentityLoss() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "p9-v156-runtime-migration-${System.nanoTime()}.db"
        context.deleteDatabase(name)
        var database = Room.databaseBuilder(context, ChatDatabase::class.java, name)
            .allowMainThreadQueries().build()
        try {
            database.dao().saveConversation(ConversationEntity(
                "session-1", "alice", "v1.5.6 history", "local:opendrsai", modelId = "model",
                createdAt = 1, updatedAt = 2,
            ))
            database.dao().saveMessage(MessageEntity(
                "message-1", "session-1", "assistant", "completed history remains readable", createdAt = 3,
            ))
            val journal = RoomRunJournal(database)
            val completed = command("completed-run", "completed-key")
            val active = command("active-run", "active-key")
            val lite = command("lite-run", "lite-key")
            val incompatible = command("future-run", "future-key")
            createRunning(journal, completed)
            val runningCompleted = requireNotNull(journal.checkpoint(completed.runId))
            journal.append(
                WorkbenchEvent(WorkbenchId("completed-run:2"), completed.runId, completed.binding.runtimeId, 2,
                    "2026-08-05T00:00:02Z", "run.completed"),
                runningCompleted.copy(status = WorkbenchRunStatus.COMPLETED, lastSequence = 2),
            )
            createRunning(journal, active)
            createRunning(journal, lite)
            createRunning(journal, incompatible)

            val receipt = JSONObject().put("call_id", "call-1").put("succeeded", true)
                .put("content", JSONObject().put("written", true)).put("artifact_ids", JSONArray())
            val v1 = JSONObject().put("sequence", 7).put("state", JSONObject()
                .put("phase", "waiting_tool")
                .put("skill_versions", JSONObject().put("workspace.edit", 1))
                .put("_host_tool_intents", JSONObject().put("call-1", JSONObject()
                    .put("call_id", "call-1").put("status", "receipt_persisted")))
                .put("_host_tool_results", JSONObject().put("call-1", receipt)))
            assertEquals(1, database.workbenchDao().updatePythonState("active-run", v1.toString(), 10))
            val future = JSONObject().put("schema_version", 99).put("min_reader_version", 99)
                .put("sequence", 1).put("state", JSONObject()).put("payload_sha256", "0".repeat(64))
            assertEquals(1, database.workbenchDao().updatePythonState("future-run", future.toString(), 11))

            database.close()
            database = Room.databaseBuilder(context, ChatDatabase::class.java, name)
                .allowMainThreadQueries().build()

            assertEquals("completed history remains readable",
                database.dao().visibleMessageSnapshot("session-1").single().content)
            val reopenedJournal = RoomRunJournal(database)
            assertEquals(WorkbenchRunStatus.COMPLETED, reopenedJournal.checkpoint(completed.runId)?.status)
            val checkpointStore = RoomPythonCheckpointStore(database)
            val migrated = requireNotNull(checkpointStore.loadCheckpoint("active-run"))
            assertEquals(7L, migrated.sequence)
            assertTrue(migrated.state.getJSONObject("_host_tool_results").has("call-1"))
            checkpointStore.saveCheckpoint(HostCheckpoint(
                "active-run", 8, JSONObject().put("phase", "waiting_model"),
            ))
            val upgradedRaw = requireNotNull(database.workbenchDao().pythonState("active-run"))
            val upgraded = PythonCheckpointCodec.decode(upgradedRaw)
            assertEquals(2, upgraded.schemaVersion)
            assertTrue(upgraded.state.getJSONObject("_host_tool_results").has("call-1"))

            val recorder = RuntimeV2EventRecorder(reopenedJournal)
            val recovered = recorder.recover("alice").associateBy { it.command.runId.value }
            assertEquals(setOf("active-run", "lite-run", "future-run"), recovered.keys)
            assertEquals("active-run", recorder.resume(WorkbenchId("active-run")).command.runId.value)

            val liteFailed = recorder.failUnrecoverable(
                WorkbenchId("lite-run"), "legacy_kotlin_checkpoint_unrecoverable",
            )
            assertEquals(WorkbenchRunStatus.FAILED, liteFailed.status)
            assertEquals("legacy_kotlin_checkpoint_unrecoverable", liteFailed.failureCode)

            val futureError = runCatching { checkpointStore.loadCheckpoint("future-run") }.exceptionOrNull()
            assertNotNull(futureError)
            val futureCode = PythonCheckpointMigrationPolicy.terminalFailureCode(futureError!!)
            assertEquals("python_checkpoint_incompatible", futureCode)
            val futureFailed = recorder.failUnrecoverable(WorkbenchId("future-run"), requireNotNull(futureCode))
            assertEquals(WorkbenchRunStatus.FAILED, futureFailed.status)
            assertEquals("future-run", futureFailed.command.runId.value)
            assertEquals(WorkbenchRunStatus.PAUSED, reopenedJournal.checkpoint(WorkbenchId("active-run"))?.status)
        } finally {
            database.close()
            context.deleteDatabase(name)
        }
    }

    private suspend fun createRunning(journal: RoomRunJournal, command: RunCommand) {
        val queued = journal.createIfAbsent(command)
        journal.append(
            WorkbenchEvent(WorkbenchId("${command.runId.value}:1"), command.runId, command.binding.runtimeId, 1,
                "2026-08-05T00:00:01Z", "run.started"),
            queued.copy(status = WorkbenchRunStatus.RUNNING, lastSequence = 1),
        )
    }

    private fun command(runId: String, idempotencyKey: String) = RunCommand(
        "alice", "ihep", RuntimeBinding.AndroidLocal,
        WorkbenchId("local"), WorkbenchId("session-1"), WorkbenchId(runId),
        "opendrsai", idempotencyKey, "resume me", mapOf("workspace.edit" to 1),
    )
}
