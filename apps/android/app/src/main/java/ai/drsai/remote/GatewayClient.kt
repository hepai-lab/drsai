package ai.drsai.remote

import kotlinx.coroutines.CompletableDeferred
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class GatewayClient(
    private val onEvent: (String, String?, JSONObject?) -> Unit,
    private val onState: (Boolean, String) -> Unit,
) {
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private val ids = AtomicLong()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private var socket: WebSocket? = null

    fun connect(url: String) {
        close()
        socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onState(true, "已连接")
            override fun onMessage(webSocket: WebSocket, text: String) { dispatch(text) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = onState(false, "连接已关闭")
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = onState(false, t.message ?: "连接失败")
        })
    }

    suspend fun request(method: String, params: JSONObject = JSONObject()): JSONObject {
        val id = "a${ids.incrementAndGet()}"
        val result = CompletableDeferred<JSONObject>()
        pending[id] = result
        val frame = JSONObject().put("jsonrpc", "2.0").put("id", id).put("method", method).put("params", params)
        if (socket?.send(frame.toString()) != true) {
            pending.remove(id)
            error("WebSocket 未连接")
        }
        return result.await()
    }

    private fun dispatch(raw: String) {
        runCatching {
            val json = JSONObject(raw)
            if (json.optString("method") == "event") {
                val p = json.optJSONObject("params") ?: return
                onEvent(p.optString("type"), p.optString("session_id").ifBlank { null }, p.optJSONObject("payload"))
            } else {
                val id = json.optString("id")
                val waiter = pending.remove(id) ?: return
                json.optJSONObject("error")?.let { waiter.completeExceptionally(IllegalStateException(it.optString("message"))); return }
                waiter.complete(json.optJSONObject("result") ?: JSONObject())
            }
        }.onFailure { onState(false, "协议错误: ${it.message}") }
    }

    fun close() {
        socket?.close(1000, "client closing")
        socket = null
        pending.values.forEach { it.cancel() }
        pending.clear()
    }
}
