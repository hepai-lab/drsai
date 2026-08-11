package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import ai.drsai.remote.runtime.oaep.androidOaepSnapshotDigest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOaepStage8RollbackTest {
    @Test fun seed_v155_oaep_state() = runBlocking {
        requirePhase("seed-v155")
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.deleteDatabase(DATABASE)
        val database = database(context)
        try {
            val store = RoomAndroidOaepStore(database)
            val writer = AndroidOaepWriter(SCOPE, CREATED_AT)
            store.commit(OWNER, SCOPE, writer.apply("rollback:start", NormalizedAgentEvent.RunStarted, timestamp(1)))
            store.commit(OWNER, SCOPE, writer.apply(
                "rollback:item",
                NormalizedAgentEvent.ItemCompleted(
                    "rollback-message", "message",
                    OaepMessageContent("assistant", PAYLOAD, "final"),
                ),
                timestamp(2),
            ))
            store.commit(OWNER, SCOPE, writer.apply("rollback:complete", NormalizedAgentEvent.RunCompleted, timestamp(3)))
            persistDigest(context, store)
        } finally {
            database.close()
        }
    }

    @Test fun verify_v156_upgrade_preserves_oaep_and_kill_switch_is_safe() = runBlocking {
        requirePhase("verify-v156")
        val context = ApplicationProvider.getApplicationContext<Context>()
        verifyState(context)
        context.getSharedPreferences("python_runtime_rollout", Context.MODE_PRIVATE).edit()
            .putBoolean("policy_verified", false)
            .putBoolean("emergency_disabled", true)
            .commit()
        verifyState(context)
    }

    @Test fun verify_v155_rollback_preserves_oaep_state() = runBlocking {
        requirePhase("verify-v155-rollback")
        verifyState(ApplicationProvider.getApplicationContext())
    }

    private fun requirePhase(expected: String) {
        // This class validates state across three separate APK installations. Running its
        // methods unordered in the generic connected suite would not test that transition.
        assumeTrue(
            "stage8 rollback phase $expected is only run by the dedicated acceptance drill",
            InstrumentationRegistry.getArguments().getString("rollbackPhase") == expected,
        )
    }

    private suspend fun verifyState(context: Context) {
        val database = database(context)
        try {
            val store = RoomAndroidOaepStore(database)
            val snapshot = store.snapshot(OWNER, SCOPE.runtimeId, SCOPE.workspaceId, SCOPE.sessionId)
            assertNotNull(snapshot)
            snapshot!!
            assertEquals("completed", snapshot.runs.single().status)
            assertEquals(PAYLOAD, (snapshot.items.single().content as OaepMessageContent).text)
            assertEquals(
                context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("digest", null),
                androidOaepSnapshotDigest(snapshot),
            )
        } finally {
            database.close()
        }
    }

    private suspend fun persistDigest(context: Context, store: RoomAndroidOaepStore) {
        val snapshot = store.snapshot(OWNER, SCOPE.runtimeId, SCOPE.workspaceId, SCOPE.sessionId)
            ?: error("rollback_snapshot_missing")
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .putString("digest", androidOaepSnapshotDigest(snapshot)).commit()
    }

    private fun database(context: Context) = Room.databaseBuilder(context, ChatDatabase::class.java, DATABASE)
        .allowMainThreadQueries().build()

    private fun timestamp(second: Int) = "2026-08-04T00:00:0${second}Z"

    companion object {
        private const val DATABASE = "stage8-rollback.db"
        private const val PREFERENCES = "stage8_rollback_evidence"
        private const val CREATED_AT = "2026-08-04T00:00:00Z"
        private const val PAYLOAD = "stage8-oaep-rollback-preserved"
        private val OWNER = AndroidOaepOwner("stage8-rollback", "ihep")
        private val SCOPE = AndroidOaepScope(
            "stage8-workspace", "stage8-session", "stage8-run", "stage8-rollback",
            "android-local", "Stage 8 rollback", 1,
        )
    }
}
