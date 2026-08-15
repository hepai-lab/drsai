package ai.drsai.remote.runtime.errors

enum class CapabilityRepairAction { GRANT_WORKSPACE, OPEN_NETWORK_SETTINGS, CHOOSE_MODEL, CONNECT_DESKTOP }

data class CapabilityRepair(
    val title: String,
    val actionLabel: String,
    val action: CapabilityRepairAction,
    val stableReason: String,
    val preserveOriginalRun: Boolean = true,
    val blockRetryUntilRepaired: Boolean = true,
)

object CapabilityRepairPolicy {
    fun from(code: String?, status: Int? = null, strings: CapabilityRepairStrings = EnglishCapabilityRepairStrings): CapabilityRepair? {
        val value = code.orEmpty().lowercase()
        return when {
            value.contains("saf_") || value.contains("workspace_permission") -> repair(CapabilityRepairAction.GRANT_WORKSPACE, "saf_permission_required", strings)
            status == 0 || value.contains("network") || value.contains("dns") || value.contains("offline") && !value.contains("desktop") -> repair(CapabilityRepairAction.OPEN_NETWORK_SETTINGS, "network_unavailable", strings)
            value.contains("model_tools_unsupported") || value.contains("model_capability") -> repair(CapabilityRepairAction.CHOOSE_MODEL, "model_tools_unsupported", strings)
            value.contains("desktop_offline") || value.contains("desktop_required") -> repair(CapabilityRepairAction.CONNECT_DESKTOP, "desktop_unavailable", strings)
            else -> null
        }
    }

    private fun repair(action: CapabilityRepairAction, reason: String, strings: CapabilityRepairStrings): CapabilityRepair =
        strings.copy(action).let { CapabilityRepair(it.title, it.action, action, reason) }
}
