package ai.drsai.remote.runtime.security

import ai.drsai.remote.R
import android.content.Context

enum class ApprovalPreviewText { TASK_TARGET, APPROVED_OPERATION, WORKSPACE_FILE, CREATE_FILE, UNDO_CHANGE, UPDATE_FILE, CONNECTED_SERVICE, SERVICE_OPERATION, MCP_CALL, NONE, FILE, FILE_COUNT, MODIFY_FILES, FIELD_LIST }
interface ApprovalPreviewStrings {
    fun text(key: ApprovalPreviewText, vararg arguments: Any): String
    fun toolObject(toolId: String): String
}
class AndroidApprovalPreviewStrings(private val context: Context) : ApprovalPreviewStrings {
    override fun text(key: ApprovalPreviewText, vararg arguments: Any): String = context.getString(when (key) {
        ApprovalPreviewText.TASK_TARGET -> R.string.approval_preview_task_target
        ApprovalPreviewText.APPROVED_OPERATION -> R.string.approval_preview_approved_operation
        ApprovalPreviewText.WORKSPACE_FILE -> R.string.approval_preview_workspace_file
        ApprovalPreviewText.CREATE_FILE -> R.string.approval_preview_create_file
        ApprovalPreviewText.UNDO_CHANGE -> R.string.approval_preview_undo_change
        ApprovalPreviewText.UPDATE_FILE -> R.string.approval_preview_update_file
        ApprovalPreviewText.CONNECTED_SERVICE -> R.string.tool_object_connected_service
        ApprovalPreviewText.SERVICE_OPERATION -> R.string.approval_preview_service_operation
        ApprovalPreviewText.MCP_CALL -> R.string.approval_preview_mcp_call
        ApprovalPreviewText.NONE -> R.string.approval_preview_none
        ApprovalPreviewText.FILE -> R.string.approval_preview_file
        ApprovalPreviewText.FILE_COUNT -> R.string.approval_preview_file_count
        ApprovalPreviewText.MODIFY_FILES -> R.string.approval_preview_modify_files
        ApprovalPreviewText.FIELD_LIST -> R.string.approval_preview_field_list
    }, *arguments)
    override fun toolObject(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(
        toolId, ai.drsai.remote.runtime.tools.AndroidToolHumanStrings(context),
    ).objectLabel
}
object EnglishApprovalPreviewStrings : ApprovalPreviewStrings {
    override fun text(key: ApprovalPreviewText, vararg arguments: Any): String = when (key) {
        ApprovalPreviewText.TASK_TARGET -> "Task target"
        ApprovalPreviewText.APPROVED_OPERATION -> "Will execute the approved operation"
        ApprovalPreviewText.WORKSPACE_FILE -> "Workspace file"
        ApprovalPreviewText.CREATE_FILE -> "Create file\n${arguments.firstOrNull()?.toString().orEmpty()}"
        ApprovalPreviewText.UNDO_CHANGE -> "Undo previous change\n${arguments.firstOrNull()?.toString().orEmpty()}"
        ApprovalPreviewText.UPDATE_FILE -> "Update file\n${arguments.firstOrNull()?.toString().orEmpty()}"
        ApprovalPreviewText.CONNECTED_SERVICE -> "Connected service"
        ApprovalPreviewText.SERVICE_OPERATION -> "Service operation"
        ApprovalPreviewText.MCP_CALL -> "Call ${arguments.getOrNull(0)}; argument fields: ${arguments.getOrNull(1)}"
        ApprovalPreviewText.NONE -> "none"
        ApprovalPreviewText.FILE -> "File ${arguments.firstOrNull()}"
        ApprovalPreviewText.FILE_COUNT -> "${arguments.firstOrNull()} files"
        ApprovalPreviewText.MODIFY_FILES -> "Will modify: ${arguments.firstOrNull()}"
        ApprovalPreviewText.FIELD_LIST -> "Fields involved: ${arguments.firstOrNull()}"
    }
    override fun toolObject(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(toolId).objectLabel
}
