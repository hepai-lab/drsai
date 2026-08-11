package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MessageAttachmentEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.LegacyOaepBackfill
import ai.drsai.remote.runtime.oaep.LegacyOaepShadowAuditor
import ai.drsai.remote.runtime.oaep.LocalOaepLegacyProjection
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import ai.drsai.remote.workbench.data.WorkbenchEventEntity
import ai.drsai.remote.workbench.data.WorkbenchRunEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LegacyOaepBackfillTest {
    private lateinit var database: ChatDatabase

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(), ChatDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() = database.close()

    @Test
    fun account_backfill_is_paged_lossless_idempotent_and_detects_source_drift() = runBlocking {
        val dao = database.dao()
        dao.saveConversation(ConversationEntity("session-a", "alice", "First", "agent", modelId = "m", createdAt = 1, updatedAt = 9))
        dao.saveConversation(ConversationEntity("session-b", "alice", "Second", "agent", modelId = "m", createdAt = 10, updatedAt = 19))
        dao.saveConversation(ConversationEntity("session-z", "bob", "Private", "agent", modelId = "m", createdAt = 20, updatedAt = 29))
        dao.saveMessages(listOf(
            MessageEntity("message-a1", "session-a", "user", "hello", createdAt = 2),
            MessageEntity("message-a2", "session-a", "assistant", "world", createdAt = 4),
            MessageEntity("message-b1", "session-b", "user", "second", createdAt = 11),
        ))
        dao.saveAttachments(listOf(MessageAttachmentEntity(
            "attachment-a", "message-a1", "session-a", null, "diagram.png", "image/png", 42,
            "image", "/legacy/private/path.png", null, "a".repeat(64), createdAt = 3,
        )))
        dao.saveToolArtifact(ToolArtifactEntity(
            "artifact-a", "alice", "old-run", "session-a", "old-tool", "clock", "tool receipt", 5,
        ))
        database.workbenchDao().insertEvent(WorkbenchEventEntity(
            "alice", "", "android-local", "local", "session-a", "old-run", "old-event", 1,
            "1970-01-01T00:00:00.006Z", "run.paused", 1, "{\"private\":\"legacy payload\"}",
        ))
        database.workbenchDao().saveRun(WorkbenchRunEntity(
            subject = "alice", organization = "", runtimeId = "android-local", workspaceId = "local",
            sessionId = "session-a", runId = "old-run", backendId = "android-agent",
            authority = "LOCAL_DEVICE", status = "RUNNING", lastSequence = 1,
            idempotencyKey = "old-idempotency", input = "private prompt", updatedAt = 7,
        ))
        listOf("COMPLETED", "FAILED", "CANCELLED").forEachIndexed { index, status ->
            database.workbenchDao().saveRun(WorkbenchRunEntity(
                subject = "alice", organization = "", runtimeId = "android-local", workspaceId = "local",
                sessionId = "session-a", runId = "old-${status.lowercase()}", backendId = "android-agent",
                authority = "LOCAL_DEVICE", status = status, lastSequence = 2,
                idempotencyKey = "old-${status.lowercase()}-key", input = "private", failureCode = "private failure",
                updatedAt = 8L + index,
            ))
        }

        var tick = 100L
        val backfill = LegacyOaepBackfill(database) { tick++ }
        val first = backfill.migrateAccount("alice", limit = 1)
        assertEquals(1, first.migrated)
        assertTrue(first.hasMore)
        assertEquals("session-a", first.nextSessionId)
        val second = backfill.migrateAccount("alice", afterSessionId = first.nextSessionId, limit = 1)
        assertEquals(1, second.migrated)
        assertTrue(!second.hasMore)

        val store = RoomAndroidOaepStore(database)
        val snapshot = store.snapshot(AndroidOaepOwner("alice", ""), "android-local", "local", "session-a")
            ?: error("migrated OAEP snapshot missing")
        assertEquals(setOf("completed", "waiting", "failed", "cancelled"), snapshot.runs.map { it.status }.toSet())
        assertEquals(listOf("hello", "world"), snapshot.items.filter { it.type == "message" }
            .map { (it.content as OaepMessageContent).text })
        val user = snapshot.items.single { it.source.backendItemId == "message-a1" }.content as OaepMessageContent
        assertEquals("attachment-a", user.resourceRefs.single().resourceId)
        assertEquals("image", user.parts.last()["type"])
        assertTrue(user.parts.toString().contains("/legacy/private/path.png").not())
        assertEquals("tool receipt", (snapshot.items.single { it.type == "artifact" }.content as OaepArtifactContent).summary)
        val migratedEvent = snapshot.items.single {
            it.type == "notice" && (it.content as ai.drsai.remote.remote.generated.OaepNoticeContent).code == "legacy_workbench_event"
        }
        assertEquals("1970-01-01T00:00:00.006Z", migratedEvent.createdAt)
        assertEquals("run.paused", (migratedEvent.content as ai.drsai.remote.remote.generated.OaepNoticeContent).message)
        assertTrue(migratedEvent.content.toString().contains("legacy payload").not())
        assertEquals("waiting", snapshot.items.single { it.type == "interaction" }.status)
        assertTrue(snapshot.runs.none { it.status == "running" })
        val legacyShapeFromOaep = LocalOaepLegacyProjection(database).messages("alice", "", "session-a")!!
        assertEquals(listOf("hello", "world"), legacyShapeFromOaep.map { it.text })
        assertEquals("attachment-a", legacyShapeFromOaep.first().attachments.single().id)
        assertEquals(null, legacyShapeFromOaep.first().attachments.single().localPath)
        val legacyConversationFromOaep = LocalOaepLegacyProjection(database).conversation(
            "alice", "", dao.conversationSnapshot("alice").single { it.id == "session-a" },
        )!!
        assertEquals("session-a", legacyConversationFromOaep.id)
        assertEquals("First", legacyConversationFromOaep.title)
        assertTrue(store.snapshot(AndroidOaepOwner("alice", ""), "android-local", "local", "session-z") == null)

        val firstRunId = snapshot.runs.map { it.id }
        val firstItemIds = snapshot.items.map { it.id }
        val firstSequence = snapshot.snapshotSequence
        val repeated = backfill.migrateAccount("alice", limit = 1)
        assertEquals(1, repeated.skipped)
        val unchanged = store.snapshot(AndroidOaepOwner("alice", ""), "android-local", "local", "session-a")!!
        assertEquals(firstRunId, unchanged.runs.map { it.id })
        assertEquals(firstItemIds, unchanged.items.map { it.id })
        assertEquals(firstSequence, unchanged.snapshotSequence)

        dao.saveMessage(MessageEntity("message-a2", "session-a", "assistant", "changed", createdAt = 4))
        val drift = backfill.migrateAccount("alice", limit = 1)
        assertEquals(1, drift.diverged)
        val protected = store.snapshot(AndroidOaepOwner("alice", ""), "android-local", "local", "session-a")!!
        assertEquals("world", (protected.items.single { it.source.backendItemId == "message-a2" }.content as OaepMessageContent).text)
        val migration = database.androidOaepDao().migration("alice", "", "android-local", "session-a", LegacyOaepBackfill.VERSION)!!
        assertEquals("DIVERGED", migration.status)
        assertNotEquals("", migration.sourceDigest)
        assertEquals("legacy_source_changed", migration.errorCode)
    }

    @Test
    fun shadow_audit_allows_exact_projection_and_blocks_tampered_cutover_without_merging_views() = runBlocking {
        database.dao().saveConversation(ConversationEntity(
            "shadow-session", "alice", "Shadow", "agent", modelId = "m", createdAt = 1, updatedAt = 3,
        ))
        database.dao().saveMessage(MessageEntity(
            "shadow-message", "shadow-session", "user", "hello shadow", status = "complete", createdAt = 2,
        ))
        assertEquals(1, LegacyOaepBackfill(database).migrateAccount("alice").migrated)

        val auditor = LegacyOaepShadowAuditor(database)
        val ready = auditor.auditSession("alice", "", "shadow-session")
        assertTrue(ready.readyForCutover)
        assertTrue(ready.mismatchCodes.isEmpty())
        assertEquals("COMPLETED", ready.migrationStatus)
        assertTrue(ready.legacySourceDigest?.length == 64)
        assertTrue(ready.oaepSnapshotDigest?.length == 64)
        auditor.requireCutoverReady("alice", "", "shadow-session")

        database.openHelper.writableDatabase.execSQL(
            "UPDATE android_oaep_items SET itemJson=replace(itemJson,'hello shadow','tampered') " +
                "WHERE subject='alice' AND backendItemId='shadow-message'",
        )
        val blocked = auditor.auditSession("alice", "", "shadow-session")
        assertTrue(!blocked.readyForCutover)
        assertTrue("message_text" in blocked.mismatchCodes)
        assertEquals("DIVERGED", blocked.migrationStatus)
        assertEquals(
            "shadow_audit_mismatch",
            database.androidOaepDao().migration("alice", "", "android-local", "shadow-session", 1)?.errorCode,
        )
        assertTrue(runCatching {
            auditor.requireCutoverReady("alice", "", "shadow-session")
        }.exceptionOrNull()?.message.orEmpty().startsWith("oaep_shadow_cutover_blocked:"))
        // The auditor exposes only verdicts/digests. Presentation still chooses exactly one authority.
        assertEquals(1, database.dao().runtimeMessageSnapshot("shadow-session").size)
        assertEquals(1, RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner("alice", ""), "android-local", "local", "shadow-session",
        )?.items?.size)
    }
}
