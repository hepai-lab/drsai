package ai.drsai.remote

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainViewModel : ViewModel() {
    private val _state = MutableStateFlow<ScreenState>(ScreenState.Disconnected())
    val state = _state.asStateFlow()
    private var current: Session? = null
    private var draft = ""
    val gateway = GatewayClient(::event) { connected, text ->
        if (!connected) _state.value = ScreenState.Disconnected(text) else loadSessions()
    }

    fun connect(url: String) = gateway.connect(url.trim())

    fun loadSessions() = viewModelScope.launch {
        runCatching {
            val result = gateway.request("session.list", JSONObject().put("limit", 100))
            val array = result.optJSONArray("sessions")
            List(array?.length() ?: 0) { i ->
                val s = array!!.getJSONObject(i)
                Session(s.optString("session_id"), s.optString("name", "未命名会话"), s.optString("preview"), s.optString("updated_at"), s.optInt("message_count"))
            }
        }.onSuccess { _state.value = ScreenState.Sessions(it) }
            .onFailure { _state.value = ScreenState.Disconnected(it.message ?: "加载失败") }
    }

    fun open(session: Session) = viewModelScope.launch {
        current = session
        runCatching { gateway.request("session.resume", JSONObject().put("session_id", session.id)) }
            .onSuccess { result ->
                val history = result.optJSONArray("history")
                val rows = mutableListOf<Row>()
                for (i in 0 until (history?.length() ?: 0)) {
                    val item = history!!.optJSONObject(i) ?: continue
                    val role = item.optString("role", item.optString("source", "消息"))
                    val text = item.optString("content", item.optString("text"))
                    if (text.isNotBlank()) rows += Row(if (role == "user") "你" else role, text)
                }
                _state.value = ScreenState.Chat(session, rows)
            }.onFailure { _state.value = ScreenState.Disconnected(it.message ?: "打开会话失败") }
    }

    fun send(text: String) {
        val chat = _state.value as? ScreenState.Chat ?: return
        if (text.isBlank() || chat.streaming) return
        draft = ""
        _state.value = chat.copy(rows = chat.rows + Row("你", text.trim()) + Row("Agent", ""), streaming = true)
        viewModelScope.launch {
            runCatching { gateway.request("prompt.submit", JSONObject().put("session_id", chat.session.id).put("text", text.trim())) }
                .onFailure { finish("错误：${it.message}") }
        }
    }

    private fun event(type: String, sessionId: String?, payload: JSONObject?) {
        val chat = _state.value as? ScreenState.Chat ?: return
        if (sessionId != null && sessionId != chat.session.id) return
        when (type) {
            "message.delta" -> { draft += payload?.optString("text").orEmpty(); updateLast("Agent", draft) }
            "thinking.delta", "reasoning.delta" -> updateLast("Agent · 思考中", payload?.optString("text").orEmpty(), append = true)
            "tool.start" -> updateLast("工具 · ${payload?.optString("name")}", payload?.optString("preview", "正在执行…").orEmpty())
            "tool.progress", "subagent.progress", "status.update" -> updateLast("进展", payload?.let { it.optString("text", it.optString("preview")) }.orEmpty())
            "subagent.start" -> updateLast("子 Agent · ${payload?.optString("source", "运行中")}", payload?.optString("goal").orEmpty())
            "message.complete" -> finish(payload?.optString("text").orEmpty().ifBlank { draft })
            "error" -> finish("错误：${payload?.optString("message")}")
        }
    }

    private fun updateLast(title: String, text: String, append: Boolean = false) {
        val chat = _state.value as? ScreenState.Chat ?: return
        val rows = chat.rows.toMutableList()
        if (rows.isEmpty()) rows += Row(title, text) else {
            val old = rows.last(); rows[rows.lastIndex] = Row(title, if (append) old.secondary + text else text)
        }
        _state.value = chat.copy(rows = rows)
    }

    private fun finish(text: String) {
        updateLast("Agent", text)
        val chat = _state.value as? ScreenState.Chat ?: return
        _state.value = chat.copy(streaming = false)
        draft = ""
    }

    fun cancel() = viewModelScope.launch { current?.let { gateway.request("prompt.cancel", JSONObject().put("session_id", it.id)) } }
    override fun onCleared() { gateway.close() }
}
