package ai.drsai.remote.runtime.coordinator

import ai.drsai.remote.R
import android.content.Context

enum class HybridRuntimeText { STDIO_UNAVAILABLE, DESKTOP_UNAVAILABLE, STDIO_OFFER, DESKTOP_OFFER, LOCAL_REASON, REMOTE_REASON, CHOICE_REASON, UNSUPPORTED_REASON }
interface HybridRuntimeStrings { fun text(key: HybridRuntimeText, vararg arguments: Any): String }
class AndroidHybridRuntimeStrings(private val context: Context) : HybridRuntimeStrings {
    override fun text(key: HybridRuntimeText, vararg arguments: Any): String = context.getString(when (key) {
        HybridRuntimeText.STDIO_UNAVAILABLE -> R.string.handoff_stdio_unavailable
        HybridRuntimeText.DESKTOP_UNAVAILABLE -> R.string.handoff_desktop_unavailable
        HybridRuntimeText.STDIO_OFFER -> R.string.handoff_stdio_offer
        HybridRuntimeText.DESKTOP_OFFER -> R.string.handoff_desktop_offer
        HybridRuntimeText.LOCAL_REASON -> R.string.runtime_reason_local
        HybridRuntimeText.REMOTE_REASON -> R.string.runtime_reason_remote
        HybridRuntimeText.CHOICE_REASON -> R.string.runtime_reason_choice
        HybridRuntimeText.UNSUPPORTED_REASON -> R.string.runtime_reason_unsupported
    }, *arguments)
}
object EnglishHybridRuntimeStrings : HybridRuntimeStrings {
    override fun text(key: HybridRuntimeText, vararg arguments: Any): String = when (key) {
        HybridRuntimeText.STDIO_UNAVAILABLE -> "Android cannot run local stdio MCP, and no online Desktop Runtime declares MCP_STDIO. An HTTP MCP with the same name will not impersonate stdio; no tool was called."
        HybridRuntimeText.DESKTOP_UNAVAILABLE -> "This request requires Desktop Runtime capabilities: ${arguments.firstOrNull()}. No eligible Runtime is online, and no command was executed."
        HybridRuntimeText.STDIO_OFFER -> "Android does not run local stdio. After confirmation, ${arguments.getOrNull(0)} will be sent to ${arguments.getOrNull(1)} on Desktop Runtime; remote calls still require approval."
        HybridRuntimeText.DESKTOP_OFFER -> "This request needs ${arguments.getOrNull(0)} to execute ${arguments.getOrNull(1)}. After confirmation, the remote Runtime will open; Android has not executed a command."
        HybridRuntimeText.LOCAL_REASON -> "Android local capabilities satisfy the task"
        HybridRuntimeText.REMOTE_REASON -> "The task requires remote Runtime capabilities"
        HybridRuntimeText.CHOICE_REASON -> "Both local and remote can execute the task; choose a location"
        HybridRuntimeText.UNSUPPORTED_REASON -> "No online Runtime satisfies the required capabilities"
    }
}
