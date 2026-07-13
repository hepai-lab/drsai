package ai.drsai.remote

data class Session(val id: String, val name: String, val preview: String, val updatedAt: String, val count: Int)
data class Row(val primary: String, val secondary: String, val session: Session? = null)

sealed interface ScreenState {
    data class Disconnected(val reason: String = "未连接") : ScreenState
    data class Sessions(val items: List<Session>) : ScreenState
    data class Chat(val session: Session, val rows: List<Row>, val streaming: Boolean = false) : ScreenState
}
