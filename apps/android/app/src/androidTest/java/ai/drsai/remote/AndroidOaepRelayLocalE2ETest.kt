package ai.drsai.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import ai.drsai.remote.remote.generated.OaepToolCallContent
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RelaySseClient
import ai.drsai.remote.remote.security.KeystoreWrappedRelayDeviceSigner
import ai.drsai.remote.remote.model.oaepItemsDigest
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.ApprovalId
import ai.drsai.remote.remote.model.SessionId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.runtime.oaep.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class AndroidOaepRelayLocalE2ETest {
    @Test
    fun android_runtime_publishes_full_oaep_semantics_to_real_relay() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val relay = args.getString("relayBaseUrl").orEmpty().trimEnd('/')
        val registrationCode = args.getString("registrationCode").orEmpty()
        assumeTrue("local OAEP Relay E2E arguments required", relay.isNotBlank() && registrationCode.isNotBlank())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java)
            .allowMainThreadQueries().build()
        val signer = KeystoreWrappedRelayDeviceSigner(context)
        val enrollmentStore = RecordingEnrollmentStore()
        val enrollment = AndroidRuntimeEnrollmentClient(instanceId = { "android-oaep-e2e" }).enroll(
            relay, registrationCode, SUBJECT, "Android OAEP E2E", "1.5.6", signer, enrollmentStore,
        )
        val owner = AndroidOaepOwner(SUBJECT, "")
        val scope = AndroidOaepScope(
            WORKSPACE, SESSION, RUN, "android-agent", "android-local",
            sessionTitle = "Android OAEP E2E", runSequence = 1,
            sourceRuntimeId = enrollment.runtimeId,
        )
        val store = RoomAndroidOaepStore(database)
        val writer = AndroidOaepWriter(scope, Instant.now().toString())
        suspend fun commit(key: String, event: NormalizedAgentEvent) {
            store.commit(owner, scope, writer.apply(key, event, Instant.now().toString()))
        }
        commit("run-start", NormalizedAgentEvent.RunStarted)
        commit("message", NormalizedAgentEvent.ItemCompleted(
            "message", "message", OaepMessageContent("assistant", "android-final", "final"),
        ))
        commit("tool", NormalizedAgentEvent.ItemCompleted(
            "tool", "tool_call", OaepToolCallContent(
                "function", "workspace.search", "call-android", mapOf("query" to "OAEP"),
                mapOf("matches" to 1), durationMs = 12.0,
            ),
        ))
        commit("approval", NormalizedAgentEvent.ItemCompleted(
            "approval", "interaction", OaepInteractionContent(
                "approval", "Allow test operation?", emptyList(), approvalId = "approval-android",
                operation = "workspace.write", response = "approved",
            ),
        ))
        commit("artifact", NormalizedAgentEvent.ItemCompleted(
            "artifact", "artifact", OaepArtifactContent(
                "artifact-android", "file", "result.txt", "Android artifact",
                mimeType = "text/plain", size = 12, previewable = true, downloadable = true,
            ),
        ))
        commit("subtask", NormalizedAgentEvent.ItemCompleted(
            "subtask", "subtask", OaepSubtaskContent(
                "Research", "Completed on Android", "android-agent", result = mapOf("ok" to true),
            ),
        ))
        commit("run-complete", NormalizedAgentEvent.RunCompleted)
        val snapshot = store.snapshot(owner, "android-local", WORKSPACE, SESSION) ?: error("snapshot_missing")
        val authority = RoomAndroidOaepRelayAuthority(store, owner, "android-local")
        val connector = AndroidOaepRelayConnector(
            enrollment.connectorCredential(), signer,
            AndroidOaepRelayProtocol(enrollment.runtimeId, SUBJECT, authority),
            sessions = { listOf(AndroidOaepRelaySession(WORKSPACE, SESSION)) },
            cursors = InMemoryAndroidOaepRelayCursorStore(),
            scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
            pollMillis = 50,
        )
        val http = OkHttpClient()
        try {
            connector.start()
            val ready = JSONObject()
                .put("runtime_id", enrollment.runtimeId).put("workspace_id", WORKSPACE)
                .put("session_id", SESSION).put("snapshot_sequence", snapshot.snapshotSequence)
                .put("snapshot_digest", androidOaepSnapshotDigest(snapshot))
                .put("items_digest", oaepItemsDigest(snapshot.items))
                .put("device_ready_epoch_ms", System.currentTimeMillis())
            http.newCall(Request.Builder().url("$relay/e2e/android-ready")
                .post(ready.toString().toRequestBody("application/json".toMediaType())).build())
                .execute().use { check(it.isSuccessful) { "e2e_ready_failed:${it.code}" } }

            var desktopConfig: JSONObject? = null
            val configDeadline = System.currentTimeMillis() + 30_000
            while (desktopConfig == null && System.currentTimeMillis() < configDeadline) {
                delay(50)
                val candidate = http.newCall(Request.Builder().url("$relay/e2e/desktop-config").build())
                    .execute().use { response ->
                        check(response.isSuccessful) { "desktop_config_failed:${response.code}" }
                        JSONObject(response.body!!.string())
                    }
                if (candidate.optBoolean("ready")) desktopConfig = candidate
            }
            val config = checkNotNull(desktopConfig) { "desktop_config_timeout" }
            val desktopRuntimeId = RuntimeId(config.getString("runtime_id"))
            val desktopWorkspaceId = WorkspaceId(config.getString("workspace_id"))
            val desktopSessionId = SessionId(config.getString("session_id"))
            val bearer = config.getString("bearer")
            val expectedCount = config.getInt("event_count")
            val disconnectAfter = config.getInt("disconnect_after")
            val repository = RelayRemoteRepository(relay, { bearer }, http)
            val desktopSnapshot = repository.oaepSnapshot(
                desktopRuntimeId, desktopWorkspaceId, desktopSessionId,
            )
            val sse = RelaySseClient(relay, { bearer }, http)
            val firstConnection = sse.oaepSessionStream(
                desktopRuntimeId, desktopWorkspaceId, desktopSessionId, 0,
            ).take(disconnectAfter).toList()
            check(firstConnection.size == disconnectAfter)
            val reconnectCursor = firstConnection.last().sequence
            check(reconnectCursor == disconnectAfter.toLong())
            var reconnectPublished = false
            val secondConnection = sse.oaepSessionStream(
                desktopRuntimeId, desktopWorkspaceId, desktopSessionId, reconnectCursor,
                onConnected = {
                    val reconnect = JSONObject().put("after_sequence", reconnectCursor)
                    http.newCall(Request.Builder().url("$relay/e2e/android-reconnected")
                        .post(reconnect.toString().toRequestBody("application/json".toMediaType())).build())
                        .execute().use { response ->
                            check(response.isSuccessful) { "desktop_publish_failed:${response.code}" }
                            reconnectPublished = JSONObject(response.body!!.string()).getBoolean("ok")
                        }
                },
            ).take(expectedCount - disconnectAfter).toList()
            check(reconnectPublished) { "desktop_live_publish_not_triggered" }
            val received = firstConnection + secondConnection
            check(received.map { it.sequence } == (1L..expectedCount.toLong()).toList()) {
                "desktop_reconnect_sequence_mismatch"
            }
            val replayed = AndroidOaepProjector(desktopSnapshot.session).applyAll(received).snapshot()
            val replayDigest = oaepItemsDigest(replayed.items)
            check(replayed.snapshotSequence == desktopSnapshot.snapshotSequence)
            check(replayDigest == oaepItemsDigest(desktopSnapshot.items))
            check(replayDigest == config.getString("items_digest"))
            val proof = JSONObject()
                .put("runtime_id", desktopRuntimeId.value)
                .put("session_id", desktopSessionId.value)
                .put("event_count", received.size)
                .put("snapshot_sequence", replayed.snapshotSequence)
                .put("items_digest", replayDigest)
                .put("disconnect_after", disconnectAfter)
                .put("reconnect_cursor", reconnectCursor)
                .put("realtime_events", secondConnection.size)
            http.newCall(Request.Builder().url("$relay/e2e/android-consumer-proof")
                .post(proof.toString().toRequestBody("application/json".toMediaType())).build())
                .execute().use { check(it.isSuccessful) { "consumer_proof_failed:${it.code}" } }

            val approvalConfig = http.newCall(Request.Builder().url("$relay/e2e/approval-race-config").build())
                .execute().use { response ->
                    check(response.isSuccessful) { "approval_config_failed:${response.code}" }
                    JSONObject(response.body!!.string())
                }
            http.newCall(Request.Builder().url("$relay/e2e/android-approval-ready")
                .post("{}".toRequestBody("application/json".toMediaType())).build())
                .execute().use { check(it.isSuccessful) { "approval_ready_failed:${it.code}" } }
            val approvalStartDeadline = System.currentTimeMillis() + 15_000
            var approvalStarted = false
            while (!approvalStarted && System.currentTimeMillis() < approvalStartDeadline) {
                delay(10)
                approvalStarted = http.newCall(Request.Builder().url("$relay/e2e/approval-start").build())
                    .execute().use { response ->
                        response.isSuccessful && JSONObject(response.body!!.string()).getBoolean("start")
                    }
            }
            check(approvalStarted) { "approval_race_start_timeout" }
            val approvalRepository = RelayRemoteRepository(
                relay, { approvalConfig.getString("bearer") }, http,
            )
            val approvalStatus = approvalRepository.decide(
                RuntimeId(approvalConfig.getString("runtime_id")),
                ApprovalId(approvalConfig.getString("approval_id")),
                "approve",
            )
            val approvalResult = JSONObject()
                .put("approval_id", approvalConfig.getString("approval_id"))
                .put("status", approvalStatus)
            http.newCall(Request.Builder().url("$relay/e2e/android-approval-proof")
                .post(approvalResult.toString().toRequestBody("application/json".toMediaType())).build())
                .execute().use { check(it.isSuccessful) { "approval_proof_failed:${it.code}" } }
            val deadline = System.currentTimeMillis() + 30_000
            var released = false
            while (!released && System.currentTimeMillis() < deadline) {
                delay(100)
                released = http.newCall(Request.Builder()
                    .url("$relay/e2e/release?runtime_id=${enrollment.runtimeId}").build())
                    .execute().use { response -> response.isSuccessful && JSONObject(response.body!!.string()).getBoolean("release") }
            }
            assertTrue("host desktop verifier did not release Android E2E", released)
        } finally {
            connector.stop()
            database.close()
        }
    }

    private class RecordingEnrollmentStore : AndroidRuntimeEnrollmentStore {
        private var value: StoredAndroidRuntimeEnrollment? = null
        override fun load(ownerSubject: String) = value?.takeIf { it.ownerSubject == ownerSubject }
        override fun save(value: StoredAndroidRuntimeEnrollment) { this.value = value }
        override fun clear(ownerSubject: String) { value = null }
    }

    companion object {
        const val SUBJECT = "android-e2e-subject"
        const val WORKSPACE = "android-e2e-workspace"
        const val SESSION = "android-e2e-session"
        const val RUN = "android-e2e-run"
    }
}
