package ai.drsai.remote

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.MIGRATION_8_9
import ai.drsai.remote.data.MIGRATION_9_10
import ai.drsai.remote.data.MIGRATION_10_11
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.runtime.python.HostCheckpoint
import ai.drsai.remote.runtime.python.RoomPythonCheckpointStore
import ai.drsai.remote.runtime.v2.RunCommand
import ai.drsai.remote.workbench.data.RoomRunJournal
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.remote.data.RemoteRuntimeEntity
import ai.drsai.remote.remote.data.RemoteSessionEntity
import ai.drsai.remote.remote.data.RemoteWorkspaceEntity
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeUpgradeStateTest {
    @Test
    fun seedUpgradeState() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("upgradePhase") == "seed")
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            context.deleteDatabase(DATABASE)
            SecureTokenStore(context).apply {
                clear()
                accessToken = "acceptance-access-token"
                refreshToken = "acceptance-refresh-token"
                userId = SUBJECT
                userName = "Upgrade User"
                selectedModelId = "hepai/deepseek-v4-pro"
            }
            val db = database(context)
            try {
                db.dao().saveConversation(
                    ConversationEntity(CONVERSATION, SUBJECT, "Upgrade session", "local:opendrsai", modelId = "hepai/deepseek-v4-pro", createdAt = 1, updatedAt = 2)
                )
                db.dao().saveMessage(MessageEntity(MESSAGE, CONVERSATION, "user", "upgrade-history-marker"))
                db.remoteDao().saveRuntimes(
                    listOf(RemoteRuntimeEntity(SUBJECT, ORG, RUNTIME, "Upgrade runtime", "instance", "1", "online", "{}", 1, true))
                )
                db.remoteDao().saveWorkspaces(
                    listOf(RemoteWorkspaceEntity(SUBJECT, ORG, RUNTIME, WORKSPACE, "Upgrade workspace", 1, true))
                )
                db.remoteDao().saveSessions(
                    listOf(RemoteSessionEntity(SUBJECT, ORG, RUNTIME, WORKSPACE, REMOTE_SESSION, "Remote upgrade session", "opendrsai", 1, true))
                )
                val command = RunCommand(
                    SUBJECT, ORG, RuntimeBinding.AndroidLocal, WorkbenchId("local"),
                    WorkbenchId(CONVERSATION), WorkbenchId("upgrade-python-run"), "opendrsai",
                    "upgrade-python-idempotency", "resume after upgrade",
                )
                RoomRunJournal(db).createIfAbsent(command)
                RoomPythonCheckpointStore(db).saveCheckpoint(
                    HostCheckpoint("upgrade-python-run", 7, JSONObject().put("phase", "paused").put("marker", "checkpoint-preserved"))
                )
            } finally {
                db.close()
            }
        }
    }

    @Test
    fun verifyUpgradeState() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("upgradePhase") == "verify")
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val tokens = SecureTokenStore(context)
            assertEquals(SUBJECT, tokens.userId)
            assertEquals("acceptance-access-token", tokens.accessToken)
            assertEquals("acceptance-refresh-token", tokens.refreshToken)
            assertEquals("hepai/deepseek-v4-pro", tokens.selectedModelId)
            val db = database(context)
            try {
                assertNotNull(db.dao().conversationSnapshot(SUBJECT).singleOrNull { it.id == CONVERSATION })
                assertEquals("upgrade-history-marker", db.dao().visibleMessageSnapshot(CONVERSATION).single().content)
                assertNotNull(db.remoteDao().runtimes(SUBJECT, ORG).singleOrNull { it.runtimeId == RUNTIME })
                assertNotNull(db.remoteDao().workspaces(SUBJECT, ORG, RUNTIME).singleOrNull { it.workspaceId == WORKSPACE })
                assertNotNull(db.remoteDao().sessions(SUBJECT, ORG, RUNTIME, WORKSPACE).singleOrNull { it.sessionId == REMOTE_SESSION })
                val checkpoint = requireNotNull(RoomPythonCheckpointStore(db).loadCheckpoint("upgrade-python-run"))
                assertEquals(7, checkpoint.sequence)
                assertEquals("checkpoint-preserved", checkpoint.state.getString("marker"))
            } finally {
                db.close()
            }
        }
    }

    @Test
    fun verifyLegacyUpgradeState() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("upgradePhase") == "verify_legacy")
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            val tokens = SecureTokenStore(context)
            assertEquals(SUBJECT, tokens.userId)
            assertEquals("acceptance-access-token", tokens.accessToken)
            assertEquals("acceptance-refresh-token", tokens.refreshToken)
            assertEquals("hepai/deepseek-v4-pro", tokens.selectedModelId)
            val db = database(context)
            try {
                assertNotNull(db.dao().conversationSnapshot(SUBJECT).singleOrNull { it.id == CONVERSATION })
                assertEquals("upgrade-history-marker", db.dao().visibleMessageSnapshot(CONVERSATION).single().content)
                assertNotNull(db.remoteDao().runtimes(SUBJECT, ORG).singleOrNull { it.runtimeId == RUNTIME })
                assertNotNull(db.remoteDao().workspaces(SUBJECT, ORG, RUNTIME).singleOrNull { it.workspaceId == WORKSPACE })
                assertNotNull(db.remoteDao().sessions(SUBJECT, ORG, RUNTIME, WORKSPACE).singleOrNull { it.sessionId == REMOTE_SESSION })
            } finally {
                db.close()
            }
        }
    }

    private fun database(context: Context) = Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE)
        .addMigrations(
            MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6,
            MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9, MIGRATION_9_10, MIGRATION_10_11,
        )
        .build()

    companion object {
        const val DATABASE = "opendrsai.db"
        const val SUBJECT = "upgrade-subject"
        const val ORG = "upgrade-org"
        const val RUNTIME = "upgrade-runtime"
        const val WORKSPACE = "upgrade-workspace"
        const val REMOTE_SESSION = "upgrade-remote-session"
        const val CONVERSATION = "upgrade-conversation"
        const val MESSAGE = "upgrade-message"
    }
}
