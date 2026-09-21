package ai.drsai.remote.remote.model

import ai.drsai.remote.R
import android.content.Context

enum class RemoteConversationText { COMPLETED, FAILED, CANCELLED, UNKNOWN_EVENT }
fun interface RemoteConversationStrings { fun text(key: RemoteConversationText, vararg arguments: Any): String }
class AndroidRemoteConversationStrings(private val context: Context) : RemoteConversationStrings {
    override fun text(key: RemoteConversationText, vararg arguments: Any): String = context.getString(when (key) {
        RemoteConversationText.COMPLETED -> R.string.remote_conversation_completed
        RemoteConversationText.FAILED -> R.string.remote_conversation_failed
        RemoteConversationText.CANCELLED -> R.string.remote_conversation_cancelled
        RemoteConversationText.UNKNOWN_EVENT -> R.string.remote_conversation_unknown_event
    }, *arguments)
}
object EnglishRemoteConversationStrings : RemoteConversationStrings {
    override fun text(key: RemoteConversationText, vararg arguments: Any): String = when (key) {
        RemoteConversationText.COMPLETED -> "Task completed"
        RemoteConversationText.FAILED -> "Task execution failed"
        RemoteConversationText.CANCELLED -> "Task cancelled"
        RemoteConversationText.UNKNOWN_EVENT -> "Unknown event: ${arguments.first()}"
    }
}
