package ai.drsai.remote.runtime.security

data class ApprovalRiskSummary(
    val title: String,
    val reason: String,
    val objectLabel: String,
    val risk: String,
    val reversible: Boolean,
    val reversibleLabel: String,
)

/** Conservative, host-owned approval copy. Arguments and model prose never define the risk label. */
object ApprovalRiskSummaryPolicy {
    fun present(toolId: String, strings: ApprovalRiskStrings = EnglishApprovalRiskStrings): ApprovalRiskSummary {
        val human = strings.toolTemplate(toolId)
        val kind = when {
            toolId == "core.delegate" || toolId == "delegate" -> ApprovalRiskKind.DELEGATE
            toolId.startsWith("mcp.") -> ApprovalRiskKind.MCP
            toolId == "browser.submit" -> ApprovalRiskKind.SUBMIT
            toolId == "browser.download" -> ApprovalRiskKind.DOWNLOAD
            toolId in setOf("workspace.write", "workspace.edit") -> ApprovalRiskKind.WORKSPACE_WRITE
            toolId == "save_memory" -> ApprovalRiskKind.MEMORY_WRITE
            toolId.startsWith("workspace.") || toolId in setOf("get_current_time", "get_device_info", "search_memory", "web.search", "web.fetch", "browser.read", "browser.navigate") -> ApprovalRiskKind.READ_ONLY
            else -> ApprovalRiskKind.UNKNOWN
        }
        val copy = strings.copy(kind, human.action, human.objectLabel)
        val objectLabel = if (kind == ApprovalRiskKind.DELEGATE) "Desktop Agent" else human.objectLabel
        val reversible = kind in setOf(ApprovalRiskKind.DOWNLOAD, ApprovalRiskKind.WORKSPACE_WRITE, ApprovalRiskKind.MEMORY_WRITE, ApprovalRiskKind.READ_ONLY)
        return ApprovalRiskSummary(copy.title, copy.reason, objectLabel, copy.risk, reversible, copy.reversibleLabel)
    }
}
