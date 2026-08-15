package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class LocalToolExecutionText { APPROVAL_REQUIRED, REJECTED, APPROVAL_STATE_INVALID, APPROVAL_DECLINED }
fun interface LocalToolExecutionStrings { fun text(key: LocalToolExecutionText, vararg arguments: Any): String }
class AndroidLocalToolExecutionStrings(private val context: Context) : LocalToolExecutionStrings {
    override fun text(key: LocalToolExecutionText, vararg arguments: Any): String = context.getString(when (key) {
        LocalToolExecutionText.APPROVAL_REQUIRED -> R.string.local_tool_approval_required
        LocalToolExecutionText.REJECTED -> R.string.local_tool_rejected
        LocalToolExecutionText.APPROVAL_STATE_INVALID -> R.string.local_tool_approval_state_invalid
        LocalToolExecutionText.APPROVAL_DECLINED -> R.string.local_tool_approval_declined
    }, *arguments)
}
object EnglishLocalToolExecutionStrings : LocalToolExecutionStrings {
    override fun text(key: LocalToolExecutionText, vararg arguments: Any): String = when (key) {
        LocalToolExecutionText.APPROVAL_REQUIRED -> "Tool ${arguments[0]} requires user approval"
        LocalToolExecutionText.REJECTED -> "Tool ${arguments[0]} was rejected: ${arguments[1]}"
        LocalToolExecutionText.APPROVAL_STATE_INVALID -> "Tool approval state is invalid"
        LocalToolExecutionText.APPROVAL_DECLINED -> "The user declined tool ${arguments[0]}"
    }
}
