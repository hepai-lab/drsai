package ai.drsai.remote

import ai.drsai.remote.data.*
import ai.drsai.remote.remote.data.RemoteOaepItemEntity
import ai.drsai.remote.runtime.device.SafWorkspaceStore
import ai.drsai.remote.runtime.oaep.*
import ai.drsai.remote.runtime.setup.*
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P10UpgradeCompatibilityInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun v155Schema11SnapshotUpgradesWithoutDataLossOrDuplicateSetup(): Unit = runBlocking {
        verifyUpgrade(11, "v155")
    }

    @Test fun v156Schema13SnapshotUpgradesWithoutDataLossOrDuplicateSetup(): Unit = runBlocking {
        verifyUpgrade(13, "v156")
    }

    private suspend fun verifyUpgrade(sourceVersion: Int, suffix: String) {
        val databaseName = "p10-upgrade-$suffix.db"
        val subject = "upgrade-$suffix@example.invalid"
        val providerId = "provider-$suffix"
        context.deleteDatabase(databaseName)
        val credentials = ModelProviderStore(context)
        credentials.delete(providerId)
        credentials.save(
            ModelProviderConfig(providerId, "Upgrade Provider", "https://upgrade.invalid/v1", listOf("model-$suffix")),
            "temporary-upgrade-secret-$suffix",
        )
        val setupStore = SharedPreferencesSetupJourneyStore(context)
        setupStore.save(subject, SetupJourney(SetupStep.COMPLETE, SetupStatus.COMPLETE, 10, null))
        seedSafReference(subject)

        val current = Room.databaseBuilder(context, ChatDatabase::class.java, databaseName)
            .allowMainThreadQueries().build()
        current.dao().saveConversation(ConversationEntity(
            "session-$suffix", subject, "Legacy session", "agent", modelId = "model-$suffix", createdAt = 1, updatedAt = 2,
        ))
        current.dao().saveMessage(MessageEntity(
            "message-$suffix", "session-$suffix", "user", "preserved message", createdAt = 3,
        ))
        current.dao().saveMemory(MemoryEntity(userId = subject, content = "preserved memory", createdAt = 4))
        current.dao().saveToolArtifact(ToolArtifactEntity(
            "artifact-$suffix", subject, "run-$suffix", "session-$suffix", "call-$suffix", "tool",
            "preserved artifact", 5,
        ))
        current.remoteDao().saveOaepItems(listOf(RemoteOaepItemEntity(
            subject, "org", "desktop", "workspace", "remote-session-$suffix", "remote-run-$suffix",
            "remote-item-$suffix", "message", "completed", 1, 1, "desktop", null, null,
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "{\"text\":\"remote oaep\"}", false,
        )))
        if (sourceVersion >= 13) {
            val owner = AndroidOaepOwner(subject, "org")
            val scope = AndroidOaepScope(
                "local", "session-$suffix", "run-$suffix", "android-agent", "android-local", "Legacy",
            )
            RoomAndroidOaepStore(current).commit(
                owner, scope,
                AndroidOaepWriter(scope, "2026-01-01T00:00:00Z").apply(
                    "upgrade-input-$suffix", NormalizedAgentEvent.RunStarted, "2026-01-01T00:00:01Z",
                ),
            )
        }
        current.close()

        SQLiteDatabase.openDatabase(context.getDatabasePath(databaseName).path, null, SQLiteDatabase.OPEN_READWRITE).use { legacy ->
            if (sourceVersion < 12) {
                listOf("android_oaep_migrations", "android_oaep_events", "android_oaep_items", "android_oaep_runs", "android_oaep_sessions")
                    .forEach { legacy.execSQL("DROP TABLE IF EXISTS $it") }
            }
            legacy.execSQL("DROP TABLE IF EXISTS provider_models")
            legacy.execSQL("DROP TABLE IF EXISTS model_providers")
            dropColumnIfPresent(legacy, "remote_oaep_items", "sourceJson")
            dropColumnIfPresent(legacy, "workbench_approvals", "previewJson")
            legacy.version = sourceVersion
        }

        val migrated = Room.databaseBuilder(context, ChatDatabase::class.java, databaseName)
            .addMigrations(
                MIGRATION_11_12, MIGRATION_12_13, MIGRATION_13_14, MIGRATION_14_15, MIGRATION_15_16,
            ).allowMainThreadQueries().build()
        try {
            assertEquals("preserved message", migrated.dao().visibleMessageSnapshot("session-$suffix").single().content)
            assertEquals("preserved memory", migrated.dao().memorySnapshot(subject).single().content)
            assertEquals("preserved artifact", migrated.dao().toolArtifacts(subject, "run-$suffix").single().content)
            assertEquals(
                "remote-item-$suffix",
                migrated.remoteDao().oaepItems(subject, "org", "desktop", "remote-session-$suffix").single().itemId,
            )
            if (sourceVersion >= 13) {
                assertNotNull(migrated.androidOaepDao().session(subject, "org", "android-local", "session-$suffix"))
            }
            val repository = ModelProviderRepository(migrated.modelProviderDao(), credentials, credentials::providers)
            repository.ensureBuiltIns(BuildConfig.MODEL_BASE_URL)
            val (providers, models) = repository.snapshot()
            assertTrue(providers.any { it.id == providerId && it.hasApiKey })
            assertTrue(models.any { it.providerId == providerId && it.upstreamId == "model-$suffix" })
            assertEquals(Uri.parse("content://p10-upgrade/$suffix"), SafWorkspaceStore(context).uri(subject))
            assertEquals("Upgrade workspace $suffix", SafWorkspaceStore(context).displayName(subject))
            assertEquals(SetupStatus.COMPLETE, setupStore.load(subject)?.status)
        } finally {
            migrated.close()
            context.deleteDatabase(databaseName)
            credentials.delete(providerId)
            setupStore.clear(subject)
            clearSafReference(subject)
        }
    }

    private fun dropColumnIfPresent(database: SQLiteDatabase, table: String, column: String) {
        val present = database.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
            val index = cursor.getColumnIndex("name")
            var found = false
            while (cursor.moveToNext()) if (cursor.getString(index) == column) found = true
            found
        }
        if (present) database.execSQL("ALTER TABLE $table DROP COLUMN $column")
    }

    private fun seedSafReference(subject: String) {
        val key = subject.sha256()
        context.getSharedPreferences("opendrsai_saf_workspaces", Context.MODE_PRIVATE).edit()
            .putString(key, "content://p10-upgrade/${subject.substringAfter("upgrade-").substringBefore('@')}")
            .putString("$key:name", "Upgrade workspace ${subject.substringAfter("upgrade-").substringBefore('@')}")
            .commit()
    }

    private fun clearSafReference(subject: String) {
        val key = subject.sha256()
        context.getSharedPreferences("opendrsai_saf_workspaces", Context.MODE_PRIVATE).edit()
            .remove(key).remove("$key:name").commit()
    }

    private fun String.sha256(): String = MessageDigest.getInstance("SHA-256")
        .digest(toByteArray()).joinToString("") { "%02x".format(it) }
}
