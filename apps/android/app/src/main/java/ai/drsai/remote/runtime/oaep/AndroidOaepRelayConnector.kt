package ai.drsai.remote.runtime.oaep

import android.content.Context
import ai.drsai.remote.remote.security.RelayDeviceSigner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.ConcurrentHashMap
import java.security.MessageDigest

data class AndroidOaepRelayCredential(
    val wssUrl: String,
    val runtimeId: String,
    val registrationToken: String,
    val instanceId: String,
    val version: String,
) {
    init {
        require(wssUrl.startsWith("wss://") || wssUrl.startsWith("ws://")) { "relay_url_invalid" }
        require(runtimeId.isNotBlank() && registrationToken.isNotBlank()) { "relay_credential_invalid" }
        require(instanceId.isNotBlank()) { "relay_instance_id_required" }
        require(Regex("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$").matches(version)) {
            "runtime_version_invalid"
        }
    }
}

interface AndroidOaepRelayCursorStore {
    fun afterSequence(sessionId: String): Long
    fun commit(sessionId: String, sequence: Long)
}

class InMemoryAndroidOaepRelayCursorStore : AndroidOaepRelayCursorStore {
    private val values = mutableMapOf<String, Long>()
    override fun afterSequence(sessionId: String): Long = synchronized(values) { values[sessionId] ?: 0L }
    override fun commit(sessionId: String, sequence: Long) = synchronized(values) {
        val current = values[sessionId] ?: 0L
        if (sequence > current) values[sessionId] = sequence
    }
}

class SharedPreferencesAndroidOaepRelayCursorStore(
    context: Context,
    ownerSubject: String,
    runtimeId: String,
) : AndroidOaepRelayCursorStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        "android_agent_runtime_oaep_cursors_v1", Context.MODE_PRIVATE,
    )
    private val prefix = digest("$ownerSubject\u0000$runtimeId")

    init {
        require(ownerSubject.isNotBlank() && runtimeId.isNotBlank()) { "oaep_relay_cursor_scope_invalid" }
    }

    override fun afterSequence(sessionId: String): Long = synchronized(preferences) {
        preferences.getLong(key(sessionId), 0L)
    }

    override fun commit(sessionId: String, sequence: Long) = synchronized(preferences) {
        val key = key(sessionId)
        val current = preferences.getLong(key, 0L)
        if (sequence <= current) return@synchronized
        check(preferences.edit().putLong(key, sequence).commit()) { "oaep_relay_cursor_store_failed" }
    }

    private fun key(sessionId: String): String {
        require(sessionId.isNotBlank()) { "oaep_relay_session_required" }
        return "$prefix.${digest(sessionId)}"
    }

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

/** Android Runtime-initiated WSS connection. It never opens a listening socket. */
class AndroidOaepRelayConnector(
    private val credential: AndroidOaepRelayCredential,
    private val signer: RelayDeviceSigner,
    private val protocol: AndroidOaepRelayProtocol,
    private val sessions: suspend () -> List<AndroidOaepRelaySession>,
    private val cursors: AndroidOaepRelayCursorStore,
    private val scope: CoroutineScope,
    private val http: OkHttpClient = OkHttpClient(),
    private val pollMillis: Long = 1_000,
    private val reconnectMillis: Long = 1_000,
) {
    private var socket: WebSocket? = null
    private var publisher: Job? = null
    private val connected = AtomicBoolean(false)
    private val stopped = AtomicBoolean(true)
    private val sentThrough = ConcurrentHashMap<String, Long>()

    fun start(): WebSocket {
        check(socket == null) { "oaep_relay_connector_already_started" }
        stopped.set(false)
        val request = Request.Builder().url(credential.wssUrl)
            .header("Authorization", "Runtime ${credential.registrationToken}")
            .build()
        return http.newWebSocket(request, Listener()).also { socket = it }
    }

    fun stop() {
        stopped.set(true)
        connected.set(false)
        publisher?.cancel()
        publisher = null
        socket?.close(1000, "android_runtime_stopped")
        socket = null
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            val nonce = UUID.randomUUID().toString()
            val proof = "${credential.runtimeId}\n${credential.instanceId}\n$nonce".toByteArray()
            val signature = Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign(proof))
            check(webSocket.send(JSONObject()
                .put("type", "runtime.hello")
                .put("runtime_id", credential.runtimeId)
                .put("instance_id", credential.instanceId)
                .put("version", credential.version)
                .put("protocol_version", "owop/1")
                .put("capabilities", JSONArray(CAPABILITIES.sorted()))
                .put("backend_health", JSONObject().put("android-agent", "healthy"))
                .put("nonce", nonce)
                .put("signature", signature)
                .toString())) { "oaep_relay_hello_send_failed" }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val message = runCatching { JSONObject(text) }.getOrNull() ?: return
            when (message.optString("type")) {
                "runtime.connected" -> beginPublishing(webSocket)
                "oaep.event.ack" -> acceptAck(message)
                "runtime.request" -> scope.launch {
                    webSocket.send(protocol.handleRuntimeRequest(message).toString())
                }
                "ping" -> webSocket.send(JSONObject().put("type", "pong")
                    .putOpt("request_id", message.optString("request_id").takeIf(String::isNotBlank))
                    .toString())
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = disconnected(webSocket)
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = disconnected(webSocket)
    }

    private fun beginPublishing(webSocket: WebSocket) {
        if (!connected.compareAndSet(false, true)) return
        sentThrough.clear()
        publisher = scope.launch {
            val initialSessions = sessions()
            val workspaces = initialSessions.distinctBy { it.workspaceId }.map { session ->
                JSONObject().put("runtime_id", credential.runtimeId)
                    .put("workspace_id", session.workspaceId)
                    .put("display_name", "Android Agent Runtime")
            }
            check(webSocket.send(JSONObject().put("type", "runtime.workspaces")
                .put("workspaces", JSONArray(workspaces)).toString())) {
                "oaep_relay_workspace_publish_failed"
            }
            while (isActive && connected.get()) {
                sessions().distinctBy { it.sessionId }.forEach { session ->
                    val after = maxOf(
                        cursors.afterSequence(session.sessionId),
                        sentThrough[session.sessionId] ?: 0L,
                    )
                    val frames = protocol.frames(session, after)
                    frames.forEach { frame ->
                        check(webSocket.send(frame.toString())) { "oaep_relay_event_send_failed" }
                        sentThrough[session.sessionId] = frame.getLong("sequence")
                    }
                }
                delay(pollMillis.coerceAtLeast(50))
            }
        }
    }

    private fun disconnected(webSocket: WebSocket) {
        connected.set(false)
        publisher?.cancel()
        publisher = null
        sentThrough.clear()
        if (socket === webSocket) socket = null
        if (!stopped.get()) scope.launch {
            delay(reconnectMillis.coerceAtLeast(100))
            if (!stopped.get() && socket == null) runCatching { start() }
        }
    }

    private fun acceptAck(message: JSONObject) {
        require(message.getString("protocol") == "oaep/1") { "oaep_relay_ack_protocol_invalid" }
        require(message.getString("runtime_id") == credential.runtimeId) { "oaep_relay_ack_runtime_mismatch" }
        val sessionId = message.getString("session_id").also { require(it.isNotBlank()) }
        val sequence = message.getLong("sequence").also { require(it > 0) }
        cursors.commit(sessionId, sequence)
    }

    companion object {
        val CAPABILITIES = setOf(
            "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
            "oaep.session.events.stream", "event.cursor_expired",
        )
    }
}
