package ai.drsai.remote.runtime.security

import ai.drsai.remote.R
import android.content.Context

enum class ApprovalRiskKind { DELEGATE, MCP, SUBMIT, DOWNLOAD, WORKSPACE_WRITE, MEMORY_WRITE, READ_ONLY, UNKNOWN }
data class ApprovalRiskCopy(val title: String, val reason: String, val risk: String, val reversibleLabel: String)
interface ApprovalRiskStrings {
    fun copy(kind: ApprovalRiskKind, action: String, objectLabel: String): ApprovalRiskCopy
    fun toolTemplate(toolId: String): ai.drsai.remote.runtime.tools.ToolHumanTemplate
}
class AndroidApprovalRiskStrings(private val context: Context) : ApprovalRiskStrings {
    override fun copy(kind: ApprovalRiskKind, action: String, objectLabel: String): ApprovalRiskCopy {
        val ids = when (kind) {
            ApprovalRiskKind.DELEGATE -> listOf(R.string.risk_delegate_title, R.string.risk_delegate_reason, R.string.risk_delegate_impact, R.string.risk_not_reversible)
            ApprovalRiskKind.MCP -> listOf(R.string.risk_mcp_title, R.string.risk_mcp_reason, R.string.risk_mcp_impact, R.string.risk_not_reversible)
            ApprovalRiskKind.SUBMIT -> listOf(R.string.risk_submit_title, R.string.risk_submit_reason, R.string.risk_submit_impact, R.string.risk_not_reversible)
            ApprovalRiskKind.DOWNLOAD -> listOf(R.string.risk_download_title, R.string.risk_download_reason, R.string.risk_download_impact, R.string.risk_reversible)
            ApprovalRiskKind.WORKSPACE_WRITE -> listOf(R.string.risk_workspace_title, R.string.risk_workspace_reason, R.string.risk_workspace_impact, R.string.risk_reversible)
            ApprovalRiskKind.MEMORY_WRITE -> listOf(R.string.risk_memory_title, R.string.risk_memory_reason, R.string.risk_memory_impact, R.string.risk_reversible)
            ApprovalRiskKind.READ_ONLY -> listOf(R.string.risk_read_title, R.string.risk_read_reason, R.string.risk_read_impact, R.string.risk_read_only)
            ApprovalRiskKind.UNKNOWN -> listOf(R.string.risk_unknown_title, R.string.risk_unknown_reason, R.string.risk_unknown_impact, R.string.risk_not_reversible)
        }
        return ApprovalRiskCopy(
            context.getString(ids[0], action, objectLabel), context.getString(ids[1]),
            context.getString(ids[2]), context.getString(ids[3]),
        )
    }
    override fun toolTemplate(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(
        toolId, ai.drsai.remote.runtime.tools.AndroidToolHumanStrings(context),
    )
}
object EnglishApprovalRiskStrings : ApprovalRiskStrings {
    override fun copy(kind: ApprovalRiskKind, action: String, objectLabel: String): ApprovalRiskCopy = when (kind) {
        ApprovalRiskKind.DELEGATE -> ApprovalRiskCopy("Delegate subtask", "The context needed by this task will be shared with another executor.", "Task context will be sent to a connected executor.", "Usually not reversible")
        ApprovalRiskKind.MCP -> ApprovalRiskCopy("Use connected service", "A connected service needs to act on your behalf.", "It may read or modify data in an external service.", "Usually not reversible")
        ApprovalRiskKind.SUBMIT -> ApprovalRiskCopy("Submit web form", "Confirmed data will be sent to the current web page.", "Submitting may cause an external effect.", "Usually not reversible")
        ApprovalRiskKind.DOWNLOAD -> ApprovalRiskCopy("Download web file", "Web content will be saved on this device.", "A new local file will be created.", "Reversible")
        ApprovalRiskKind.WORKSPACE_WRITE -> ApprovalRiskCopy("Modify workspace file", "A local file used by the task needs to be updated.", "Local workspace content will change.", "Reversible")
        ApprovalRiskKind.MEMORY_WRITE -> ApprovalRiskCopy("Save local memory", "Content will be saved for later tasks.", "Local memory will be added or updated.", "Reversible")
        ApprovalRiskKind.READ_ONLY -> ApprovalRiskCopy("$action$objectLabel", "Information needed by the current task must be read.", "Read-only; data will not be modified.", "No undo needed (read-only)")
        ApprovalRiskKind.UNKNOWN -> ApprovalRiskCopy("Execute protected operation", "Android Runtime has not identified the impact scope of this operation.", "An unknown operation may cause external effects.", "Usually not reversible")
    }
    override fun toolTemplate(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(toolId)
}
