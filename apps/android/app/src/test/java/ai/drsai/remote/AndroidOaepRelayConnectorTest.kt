package ai.drsai.remote

import ai.drsai.remote.remote.generated.OaepEventPage
import ai.drsai.remote.remote.security.RelayAssociationDevice
import ai.drsai.remote.remote.security.RelayDeviceSigner
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayAuthority
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayConnector
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayCredential
import ai.drsai.remote.runtime.oaep.AndroidOaepRelayProtocol
import ai.drsai.remote.runtime.oaep.AndroidOaepRelaySession
import ai.drsai.remote.runtime.oaep.AndroidOaepReplayResult
import ai.drsai.remote.runtime.oaep.AndroidOaepScope
import ai.drsai.remote.runtime.oaep.AndroidOaepWriter
import ai.drsai.remote.runtime.oaep.InMemoryAndroidOaepRelayCursorStore
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class AndroidOaepRelayConnectorTest {
    @Test
    fun delayed_duplicate_ack_is_idempotent_and_never_regresses_cursor() {
        val cursor = InMemoryAndroidOaepRelayCursorStore()
        cursor.commit("session", 8)
        cursor.commit("session", 1)
        cursor.commit("session", 8)
        assertEquals(8L, cursor.afterSequence("session"))
    }

    @Test
    fun opens_runtime_wss_and_forwards_native_oaep_frames_after_generation_attach() {
        val server = MockWebServer()
        val received = LinkedBlockingQueue<JSONObject>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = JSONObject(text)
                received += message
                if (message.optString("type") == "runtime.hello") {
                    webSocket.send(JSONObject().put("type", "runtime.connected").toString())
                } else if (message.optString("type") == "event") {
                    webSocket.send(JSONObject()
                        .put("type", "oaep.event.ack").put("protocol", "oaep/1")
                        .put("runtime_id", message.getString("runtime_id"))
                        .put("session_id", message.getString("session_id"))
                        .put("sequence", message.getLong("sequence")).toString())
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }))
        server.start()
        val writer = AndroidOaepWriter(
            AndroidOaepScope("workspace-1", "session-1", "run-1", "opendrsai", "runtime-android"),
            "2026-08-04T00:00:00Z",
        )
        writer.apply("run-start", NormalizedAgentEvent.RunStarted, "2026-08-04T00:00:01Z")
        val authority = object : AndroidOaepRelayAuthority {
            override suspend fun snapshot(session: AndroidOaepRelaySession) = writer.state.snapshot()
            override suspend fun events(
                session: AndroidOaepRelaySession, afterSequence: Long, limit: Int,
            ): AndroidOaepReplayResult {
                val events = writer.state.events.filter { it.sequence > afterSequence }.take(limit)
                return AndroidOaepReplayResult.Page(OaepEventPage(
                    "1.0", "list", events, events.lastOrNull()?.sequence ?: afterSequence, false,
                ))
            }
        }
        val cursor = InMemoryAndroidOaepRelayCursorStore()
        val connector = AndroidOaepRelayConnector(
            AndroidOaepRelayCredential(
                server.url("/v1/runtime-connect").toString().replaceFirst("http://", "ws://"),
                "runtime-android", "secret-token", "android-instance", "1.5.6",
            ),
            object : RelayDeviceSigner {
                override val associationDevice = RelayAssociationDevice("device", "Android", "public")
                override fun sign(message: ByteArray) = ByteArray(64) { 7 }
            },
            AndroidOaepRelayProtocol("runtime-android", "subject-1", authority),
            sessions = { listOf(AndroidOaepRelaySession("workspace-1", "session-1")) },
            cursors = cursor,
            scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
            pollMillis = 50,
        )
        try {
            connector.start()
            val hello = received.poll(5, TimeUnit.SECONDS)
            assertNotNull(hello)
            assertEquals("runtime.hello", hello.getString("type"))
            assertEquals("owop/1", hello.getString("protocol_version"))
            assertTrue(hello.getJSONArray("capabilities").toList().contains("oaep.v1"))

            val workspaceFrame = received.poll(5, TimeUnit.SECONDS)
            assertNotNull(workspaceFrame)
            assertEquals("runtime.workspaces", workspaceFrame.getString("type"))
            assertEquals("workspace-1", workspaceFrame.getJSONArray("workspaces")
                .getJSONObject(0).getString("workspace_id"))

            val firstFrame = received.poll(5, TimeUnit.SECONDS)
            assertNotNull(firstFrame)
            assertEquals("event", firstFrame.getString("type"))
            assertEquals("oaep/1", firstFrame.getString("protocol"))
            assertEquals("runtime-android", firstFrame.getString("runtime_id"))
            assertEquals(1L, firstFrame.getLong("sequence"))

            val secondFrame = received.poll(5, TimeUnit.SECONDS)
            assertNotNull(secondFrame)
            assertEquals(2L, secondFrame.getLong("sequence"))
            val thirdFrame = received.poll(5, TimeUnit.SECONDS)
            assertNotNull(thirdFrame)
            assertEquals(3L, thirdFrame.getLong("sequence"))
            val cursorDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (cursor.afterSequence("session-1") < 3 && System.nanoTime() < cursorDeadline) {
                Thread.sleep(10)
            }
            assertEquals(3L, cursor.afterSequence("session-1"))
            assertEquals("Runtime secret-token", server.takeRequest().getHeader("Authorization"))
        } finally {
            connector.stop()
            server.shutdown()
        }
    }
}
