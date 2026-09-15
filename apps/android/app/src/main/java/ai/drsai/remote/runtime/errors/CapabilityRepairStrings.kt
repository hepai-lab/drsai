package ai.drsai.remote.runtime.errors

import ai.drsai.remote.R
import android.content.Context

data class CapabilityRepairCopy(val title: String, val action: String)
fun interface CapabilityRepairStrings { fun copy(action: CapabilityRepairAction): CapabilityRepairCopy }
class AndroidCapabilityRepairStrings(private val context: Context) : CapabilityRepairStrings {
    override fun copy(action: CapabilityRepairAction): CapabilityRepairCopy = when (action) {
        CapabilityRepairAction.GRANT_WORKSPACE -> CapabilityRepairCopy(context.getString(R.string.repair_workspace_title), context.getString(R.string.repair_workspace_action))
        CapabilityRepairAction.OPEN_NETWORK_SETTINGS -> CapabilityRepairCopy(context.getString(R.string.repair_network_title), context.getString(R.string.repair_network_action))
        CapabilityRepairAction.CHOOSE_MODEL -> CapabilityRepairCopy(context.getString(R.string.repair_model_title), context.getString(R.string.repair_model_action))
        CapabilityRepairAction.CONNECT_DESKTOP -> CapabilityRepairCopy(context.getString(R.string.repair_desktop_title), context.getString(R.string.repair_desktop_action))
    }
}
object EnglishCapabilityRepairStrings : CapabilityRepairStrings {
    override fun copy(action: CapabilityRepairAction): CapabilityRepairCopy = when (action) {
        CapabilityRepairAction.GRANT_WORKSPACE -> CapabilityRepairCopy("Workspace authorization expired", "Choose workspace again")
        CapabilityRepairAction.OPEN_NETWORK_SETTINGS -> CapabilityRepairCopy("Network is unavailable", "Open network settings")
        CapabilityRepairAction.CHOOSE_MODEL -> CapabilityRepairCopy("Current model does not support Agent tools", "Choose a tool-capable model")
        CapabilityRepairAction.CONNECT_DESKTOP -> CapabilityRepairCopy("An available Desktop Runtime is required", "Connect Desktop")
    }
}
