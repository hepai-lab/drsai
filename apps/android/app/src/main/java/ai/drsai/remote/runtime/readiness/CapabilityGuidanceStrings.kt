package ai.drsai.remote.runtime.readiness

import ai.drsai.remote.R
import android.content.Context

enum class CapabilityGuidanceText { SHELL, APPS, GIT, CONNECT_DESKTOP, CHANGE_MODEL, LOCAL_AVAILABLE, AUTHORIZE_WORKSPACE, WORKSPACE, WEB, CORE, DELEGATE, DEVICE, MEMORY, LOCAL_TOOL }
interface CapabilityGuidanceStrings { fun text(key: CapabilityGuidanceText, vararg arguments: Any): String }
class AndroidCapabilityGuidanceStrings(private val context: Context) : CapabilityGuidanceStrings {
    override fun text(key: CapabilityGuidanceText, vararg arguments: Any): String = context.getString(when (key) {
        CapabilityGuidanceText.SHELL -> R.string.capability_shell
        CapabilityGuidanceText.APPS -> R.string.capability_desktop_apps
        CapabilityGuidanceText.GIT -> R.string.capability_git
        CapabilityGuidanceText.CONNECT_DESKTOP -> R.string.capability_connect_desktop
        CapabilityGuidanceText.CHANGE_MODEL -> R.string.capability_change_model
        CapabilityGuidanceText.LOCAL_AVAILABLE -> R.string.capability_guidance_local_available
        CapabilityGuidanceText.AUTHORIZE_WORKSPACE -> R.string.capability_authorize_workspace
        CapabilityGuidanceText.WORKSPACE -> R.string.capability_workspace
        CapabilityGuidanceText.WEB -> R.string.capability_web
        CapabilityGuidanceText.CORE -> R.string.capability_core
        CapabilityGuidanceText.DELEGATE -> R.string.capability_delegate
        CapabilityGuidanceText.DEVICE -> R.string.capability_device
        CapabilityGuidanceText.MEMORY -> R.string.capability_memory
        CapabilityGuidanceText.LOCAL_TOOL -> R.string.capability_local_tool
    }, *arguments)
}
object EnglishCapabilityGuidanceStrings : CapabilityGuidanceStrings {
    override fun text(key: CapabilityGuidanceText, vararg arguments: Any): String = when (key) {
        CapabilityGuidanceText.SHELL -> "Command line and processes"
        CapabilityGuidanceText.APPS -> "Desktop app control"
        CapabilityGuidanceText.GIT -> "Git and worktrees"
        CapabilityGuidanceText.CONNECT_DESKTOP -> "Connect Desktop Runtime to use"
        CapabilityGuidanceText.CHANGE_MODEL -> "Choose a model that supports tool calling"
        CapabilityGuidanceText.LOCAL_AVAILABLE -> "Available directly on this device"
        CapabilityGuidanceText.AUTHORIZE_WORKSPACE -> "Authorize a local workspace to use"
        CapabilityGuidanceText.WORKSPACE -> "Local files: ${arguments.firstOrNull()}"
        CapabilityGuidanceText.WEB -> "Web search"
        CapabilityGuidanceText.CORE -> "Agent core capability"
        CapabilityGuidanceText.DELEGATE -> "Task delegation"
        CapabilityGuidanceText.DEVICE -> "Device information"
        CapabilityGuidanceText.MEMORY -> "Local memory"
        CapabilityGuidanceText.LOCAL_TOOL -> "Local tool"
    }
}
