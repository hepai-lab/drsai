package ai.drsai.remote.runtime.tools

import ai.drsai.remote.R
import android.content.Context

data class ToolHumanTemplate(
    val action: String,
    val objectLabel: String,
    val runningTemplate: String,
    val successTemplate: String,
    val failureTemplate: String,
    val known: Boolean,
)

enum class ToolHumanKind { CURRENT_TIME, DEVICE_ENVIRONMENT, SAVE_MEMORY, SEARCH_MEMORY, WEB_SEARCH, WEB_FETCH, WORKSPACE_LIST, WORKSPACE_READ, WORKSPACE_SEARCH, WORKSPACE_WRITE, WORKSPACE_UNDO, BROWSER_NAVIGATE, BROWSER_READ, BROWSER_SUBMIT, BROWSER_DOWNLOAD, CORE, DELEGATE, MCP, UNKNOWN }

interface ToolHumanStrings { fun template(kind: ToolHumanKind, known: Boolean): ToolHumanTemplate }

object EnglishToolHumanStrings : ToolHumanStrings {
    override fun template(kind: ToolHumanKind, known: Boolean): ToolHumanTemplate {
        val (action, target) = when (kind) {
            ToolHumanKind.CURRENT_TIME -> "read" to "current time"
            ToolHumanKind.DEVICE_ENVIRONMENT -> "read" to "device environment"
            ToolHumanKind.SAVE_MEMORY -> "save" to "local memory"
            ToolHumanKind.SEARCH_MEMORY -> "search" to "local memory"
            ToolHumanKind.WEB_SEARCH -> "search" to "public web pages"
            ToolHumanKind.WEB_FETCH -> "read" to "web source"
            ToolHumanKind.WORKSPACE_LIST -> "view" to "workspace directory"
            ToolHumanKind.WORKSPACE_READ -> "read" to "workspace file"
            ToolHumanKind.WORKSPACE_SEARCH -> "search" to "workspace content"
            ToolHumanKind.WORKSPACE_WRITE -> "modify" to "workspace file"
            ToolHumanKind.WORKSPACE_UNDO -> "undo" to "file changes"
            ToolHumanKind.BROWSER_NAVIGATE -> "open" to "web page"
            ToolHumanKind.BROWSER_READ -> "read" to "current web page"
            ToolHumanKind.BROWSER_SUBMIT -> "submit" to "web form"
            ToolHumanKind.BROWSER_DOWNLOAD -> "download" to "web file"
            ToolHumanKind.CORE -> "process" to "task data"
            ToolHumanKind.DELEGATE -> "delegate" to "subtask"
            ToolHumanKind.MCP -> "call" to "connected service"
            ToolHumanKind.UNKNOWN -> "process" to "task step"
        }
        return ToolHumanTemplate(action, target, "Working: $action $target", "Completed: $action $target", "Could not $action $target", known)
    }
}

class AndroidToolHumanStrings(private val context: Context) : ToolHumanStrings {
    override fun template(kind: ToolHumanKind, known: Boolean): ToolHumanTemplate {
        val (actionId, objectId) = when (kind) {
            ToolHumanKind.CURRENT_TIME -> R.string.tool_action_read to R.string.tool_object_current_time
            ToolHumanKind.DEVICE_ENVIRONMENT -> R.string.tool_action_read to R.string.tool_object_device_environment
            ToolHumanKind.SAVE_MEMORY -> R.string.tool_action_save to R.string.tool_object_local_memory
            ToolHumanKind.SEARCH_MEMORY -> R.string.tool_action_search to R.string.tool_object_local_memory
            ToolHumanKind.WEB_SEARCH -> R.string.tool_action_search to R.string.tool_object_public_web
            ToolHumanKind.WEB_FETCH -> R.string.tool_action_read to R.string.tool_object_web_source
            ToolHumanKind.WORKSPACE_LIST -> R.string.tool_action_view to R.string.tool_object_workspace_directory
            ToolHumanKind.WORKSPACE_READ -> R.string.tool_action_read to R.string.tool_object_workspace_file
            ToolHumanKind.WORKSPACE_SEARCH -> R.string.tool_action_search to R.string.tool_object_workspace_content
            ToolHumanKind.WORKSPACE_WRITE -> R.string.tool_action_modify to R.string.tool_object_workspace_file
            ToolHumanKind.WORKSPACE_UNDO -> R.string.tool_action_undo to R.string.tool_object_file_changes
            ToolHumanKind.BROWSER_NAVIGATE -> R.string.tool_action_open to R.string.tool_object_web_page
            ToolHumanKind.BROWSER_READ -> R.string.tool_action_read to R.string.tool_object_current_web_page
            ToolHumanKind.BROWSER_SUBMIT -> R.string.tool_action_submit to R.string.tool_object_web_form
            ToolHumanKind.BROWSER_DOWNLOAD -> R.string.tool_action_download to R.string.tool_object_web_file
            ToolHumanKind.CORE -> R.string.tool_action_process to R.string.tool_object_task_data
            ToolHumanKind.DELEGATE -> R.string.tool_action_delegate to R.string.tool_object_subtask
            ToolHumanKind.MCP -> R.string.tool_action_call to R.string.tool_object_connected_service
            ToolHumanKind.UNKNOWN -> R.string.tool_action_process to R.string.tool_object_task_step
        }
        val action = context.getString(actionId)
        val target = context.getString(objectId)
        return ToolHumanTemplate(action, target, context.getString(R.string.tool_state_running, action, target), context.getString(R.string.tool_state_success, action, target), context.getString(R.string.tool_state_failure, action, target), known)
    }
}

object ToolHumanPresentationCatalog {
    fun resolve(toolId: String, strings: ToolHumanStrings = EnglishToolHumanStrings): ToolHumanTemplate {
        val kind = when {
            toolId == "get_current_time" -> ToolHumanKind.CURRENT_TIME
            toolId == "get_device_info" -> ToolHumanKind.DEVICE_ENVIRONMENT
            toolId == "save_memory" -> ToolHumanKind.SAVE_MEMORY
            toolId == "search_memory" -> ToolHumanKind.SEARCH_MEMORY
            toolId == "web.search" -> ToolHumanKind.WEB_SEARCH
            toolId == "web.fetch" -> ToolHumanKind.WEB_FETCH
            toolId == "workspace.list" -> ToolHumanKind.WORKSPACE_LIST
            toolId == "workspace.read" -> ToolHumanKind.WORKSPACE_READ
            toolId.startsWith("workspace.search") || toolId.startsWith("workspace.glob") || toolId.startsWith("workspace.grep") -> ToolHumanKind.WORKSPACE_SEARCH
            toolId.startsWith("workspace.write") || toolId.startsWith("workspace.edit") -> ToolHumanKind.WORKSPACE_WRITE
            toolId == "workspace.undo" -> ToolHumanKind.WORKSPACE_UNDO
            toolId == "browser.navigate" -> ToolHumanKind.BROWSER_NAVIGATE
            toolId == "browser.read" -> ToolHumanKind.BROWSER_READ
            toolId == "browser.submit" -> ToolHumanKind.BROWSER_SUBMIT
            toolId == "browser.download" -> ToolHumanKind.BROWSER_DOWNLOAD
            toolId.startsWith("core.") -> ToolHumanKind.CORE
            toolId == "delegate" -> ToolHumanKind.DELEGATE
            toolId.startsWith("mcp.") -> ToolHumanKind.MCP
            else -> ToolHumanKind.UNKNOWN
        }
        return strings.template(kind, kind != ToolHumanKind.UNKNOWN)
    }
}
