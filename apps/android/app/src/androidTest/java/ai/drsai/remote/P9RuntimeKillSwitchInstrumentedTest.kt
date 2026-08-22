package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import ai.drsai.remote.runtime.oaep.androidOaepSnapshotDigest
import ai.drsai.remote.runtime.python.PythonRuntimePreferenceStore
import ai.drsai.remote.runtime.python.RuntimeRolloutPolicyDocument
import ai.drsai.remote.runtime.python.VerifiedRuntimePolicy
import ai.drsai.remote.runtime.security.AndroidRuntimeKillSwitch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P9RuntimeKillSwitchInstrumentedTest {
    @Test fun applyingAllOperationalSwitchesDoesNotMutateOaepState() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java)
            .allowMainThreadQueries().build()
        val owner = AndroidOaepOwner("kill-switch-owner", "")
        val scope = AndroidOaepScope("local", "kill-switch-session", "kill-switch-run", "android-agent", "android-local", runSequence = 1)
        try {
            val store = RoomAndroidOaepStore(database)
            val writer = AndroidOaepWriter(scope, "2026-08-05T00:00:00Z")
            store.commit(owner, scope, writer.apply("start", NormalizedAgentEvent.RunStarted, "2026-08-05T00:00:01Z"))
            store.commit(owner, scope, writer.apply(
                "message", NormalizedAgentEvent.ItemCompleted(
                    "message-1", "message", OaepMessageContent("assistant", "durable", "final"),
                ), "2026-08-05T00:00:02Z",
            ))
            val before = androidOaepSnapshotDigest(requireNotNull(store.snapshot(owner, "android-local", "local", "kill-switch-session")))
            val preferences = PythonRuntimePreferenceStore(context, true)
            preferences.installVerifiedPolicy(VerifiedRuntimePolicy(
                RuntimeRolloutPolicyDocument(
                    "kill-switch-test", 1, Long.MAX_VALUE, true, false, 100, 1, Int.MAX_VALUE,
                    setOf("debug"), 26, 36, setOf("arm64-v8a", "x86_64"), 1, "test",
                    AndroidRuntimeKillSwitch.entries.toSet(),
                ), "0".repeat(64),
            ))
            assertEquals(AndroidRuntimeKillSwitch.entries.toSet(), preferences.killSwitchSnapshot().disabled)
            val after = androidOaepSnapshotDigest(requireNotNull(store.snapshot(owner, "android-local", "local", "kill-switch-session")))
            assertEquals(before, after)
            preferences.clearPolicy()
        } finally {
            database.close()
        }
    }
}
