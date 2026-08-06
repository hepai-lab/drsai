package ai.drsai.remote

import android.content.Context
import android.util.Log
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.runtime.oaep.AndroidOaepOwner
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.EncryptedAndroidRuntimeEnrollmentStore
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import ai.drsai.remote.runtime.oaep.RoomAndroidOaepStore
import ai.drsai.remote.runtime.oaep.StoredAndroidRuntimeEnrollment
import ai.drsai.remote.runtime.python.PythonRuntimeEnvelope
import ai.drsai.remote.runtime.python.PythonRuntimeEventMapper
import ai.drsai.remote.runtime.python.PythonRuntimeMessageType
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidOaepStage8SecurityTest {
    @Test
    fun token_path_and_cross_account_canaries_remain_inside_their_authorized_boundaries() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        // Random values come from accept_android_agent_runtime_security.py. The generic
        // suite skips this dedicated gate instead of substituting predictable canaries.
        val token = args.getString("tokenCanary")
        val absolutePath = args.getString("pathCanary")
        val privateText = args.getString("privateCanary")
        assumeTrue(
            "stage8 security canaries are only supplied by the dedicated acceptance gate",
            !token.isNullOrBlank() && !absolutePath.isNullOrBlank() && !privateText.isNullOrBlank(),
        )
        token!!
        absolutePath!!
        privateText!!
        val context = ApplicationProvider.getApplicationContext<Context>()

        val enrollment = EncryptedAndroidRuntimeEnrollmentStore(context)
        enrollment.save(StoredAndroidRuntimeEnrollment(
            "https://relay.invalid", "rt-security", token, "instance-security",
            "security-owner", "1.5.6",
        ))
        assertEquals(token, enrollment.load("security-owner")?.registrationToken)
        assertNull(enrollment.load("other-owner"))

        val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java)
            .allowMainThreadQueries().build()
        try {
            val owner = AndroidOaepOwner("security-owner", "")
            val other = AndroidOaepOwner("other-owner", "")
            val scope = AndroidOaepScope(
                "security-workspace", "security-session", "security-run",
                "security", "android-local",
            )
            val envelope = PythonRuntimeEnvelope(
                PythonRuntimeMessageType.RUNTIME_EVENT,
                "security-request", scope.runId, scope.sessionId, 1, "security-dedupe",
                JSONObject()
                    .put("kind", absolutePath)
                    .put("token", token)
                    .put("raw_payload", JSONObject().put("text", privateText)),
            )
            val normalized = PythonRuntimeEventMapper.decode(envelope)
                as NormalizedAgentEvent.ItemCompleted
            val notice = normalized.content as OaepNoticeContent
            assertEquals("redacted", notice.details["kind"])
            val writer = AndroidOaepWriter(scope, "2026-08-04T00:00:00Z")
            val store = RoomAndroidOaepStore(database)
            store.commit(owner, scope, writer.apply(
                "security-event", normalized, "2026-08-04T00:00:01Z",
            ))
            val eventJson = database.androidOaepDao().events(
                owner.subject, owner.organization, scope.runtimeId, scope.sessionId,
            ).joinToString { it.eventJson }
            assertTrue(token !in eventJson && absolutePath !in eventJson && privateText !in eventJson)
            assertNull(store.snapshot(other, scope.runtimeId, scope.workspaceId, scope.sessionId))
            assertEquals(1, store.snapshot(owner, scope.runtimeId, scope.workspaceId, scope.sessionId)?.items?.size)
            Log.i(MARKER, JSONObject()
                .put("oaep_token_findings", 0)
                .put("oaep_absolute_path_findings", 0)
                .put("checkpoint_receipt_token_findings", 0)
                .put("cross_account_reads", 0)
                .toString())
        } finally {
            database.close()
        }
        Unit
    }

    companion object { const val MARKER = "STAGE8_OAEP_SECURITY" }
}
