package ai.drsai.remote

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.remote.data.RemoteRuntimeEntity
import ai.drsai.remote.remote.data.RemoteSessionEntity
import ai.drsai.remote.remote.data.RemoteWorkspaceEntity
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BaselineUpgradeSeedTest {
    @Test
    fun seedLegacyState() = runBlocking {
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
            db.dao().saveConversation(ConversationEntity(CONVERSATION, SUBJECT, "Upgrade session", "local:opendrsai", modelId = "hepai/deepseek-v4-pro", createdAt = 1, updatedAt = 2))
            db.dao().saveMessage(MessageEntity(MESSAGE, CONVERSATION, "user", "upgrade-history-marker"))
            db.remoteDao().saveRuntimes(listOf(RemoteRuntimeEntity(SUBJECT, ORG, RUNTIME, "Upgrade runtime", "instance", "1", "online", "{}", 1, true)))
            db.remoteDao().saveWorkspaces(listOf(RemoteWorkspaceEntity(SUBJECT, ORG, RUNTIME, WORKSPACE, "Upgrade workspace", 1, true)))
            db.remoteDao().saveSessions(listOf(RemoteSessionEntity(SUBJECT, ORG, RUNTIME, WORKSPACE, REMOTE_SESSION, "Remote upgrade session", "opendrsai", 1, true)))
        } finally {
            db.close()
        }
    }

    @Test
    fun verifyLegacyState() = runBlocking {
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

    private fun database(context: Context) = Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE)
        .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6, MIGRATION_6_7)
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
