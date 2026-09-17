package ai.drsai.remote.remote.model

import ai.drsai.remote.R
import android.content.Context

enum class OaepPresentationText {
    PROGRESS_TITLE, LOCAL_DOCUMENT, REASONING_TITLE, REASONING_BODY, PLAN_TITLE,
    PLAN_PURPOSE, CURRENT_TASK, COMMAND_TITLE, FILE_TITLE, DELEGATING_TITLE,
    SUBTASK, PROCESSING, ACTION_REQUIRED, ARTIFACT, SEARCH_PURPOSE, FETCH_PURPOSE,
    DELEGATE_PURPOSE, WORKSPACE_PURPOSE, STEP_PURPOSE, INPUT_PROVIDED,
}

interface OaepPresentationStrings {
    fun text(key: OaepPresentationText, vararg arguments: Any): String
    fun toolTemplate(toolId: String): ai.drsai.remote.runtime.tools.ToolHumanTemplate
    fun toolOutcomeStrings(): ai.drsai.remote.runtime.security.ToolOutcomeStrings
}

class AndroidOaepPresentationStrings(private val context: Context) : OaepPresentationStrings {
    override fun toolOutcomeStrings() = ai.drsai.remote.runtime.security.AndroidToolOutcomeStrings(context)
    override fun text(key: OaepPresentationText, vararg arguments: Any): String =
        context.getString(resource(key), *arguments)

    override fun toolTemplate(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(
        toolId,
        ai.drsai.remote.runtime.tools.AndroidToolHumanStrings(context),
    )

    private fun resource(key: OaepPresentationText): Int = when (key) {
        OaepPresentationText.PROGRESS_TITLE -> R.string.oaep_progress_title
        OaepPresentationText.LOCAL_DOCUMENT -> R.string.source_local_document
        OaepPresentationText.REASONING_TITLE -> R.string.oaep_reasoning_title
        OaepPresentationText.REASONING_BODY -> R.string.oaep_reasoning_body
        OaepPresentationText.PLAN_TITLE -> R.string.oaep_plan_title
        OaepPresentationText.PLAN_PURPOSE -> R.string.oaep_plan_purpose
        OaepPresentationText.CURRENT_TASK -> R.string.oaep_current_task
        OaepPresentationText.COMMAND_TITLE -> R.string.oaep_command_title
        OaepPresentationText.FILE_TITLE -> R.string.oaep_file_title
        OaepPresentationText.DELEGATING_TITLE -> R.string.oaep_delegating_title
        OaepPresentationText.SUBTASK -> R.string.oaep_subtask
        OaepPresentationText.PROCESSING -> R.string.oaep_processing
        OaepPresentationText.ACTION_REQUIRED -> R.string.oaep_action_required
        OaepPresentationText.ARTIFACT -> R.string.source_artifact
        OaepPresentationText.SEARCH_PURPOSE -> R.string.oaep_search_purpose
        OaepPresentationText.FETCH_PURPOSE -> R.string.oaep_fetch_purpose
        OaepPresentationText.DELEGATE_PURPOSE -> R.string.oaep_delegate_purpose
        OaepPresentationText.WORKSPACE_PURPOSE -> R.string.oaep_workspace_purpose
        OaepPresentationText.STEP_PURPOSE -> R.string.oaep_step_purpose
        OaepPresentationText.INPUT_PROVIDED -> R.string.oaep_input_provided
    }
}

object EnglishOaepPresentationStrings : OaepPresentationStrings {
    override fun toolOutcomeStrings() = ai.drsai.remote.runtime.security.EnglishToolOutcomeStrings
    override fun toolTemplate(toolId: String) = ai.drsai.remote.runtime.tools.ToolHumanPresentationCatalog.resolve(toolId)
    override fun text(key: OaepPresentationText, vararg arguments: Any): String = when (key) {
        OaepPresentationText.PROGRESS_TITLE -> "Organizing task progress"
        OaepPresentationText.LOCAL_DOCUMENT -> "Local document"
        OaepPresentationText.REASONING_TITLE -> "Analyzing task"
        OaepPresentationText.REASONING_BODY -> "Analyzing task requirements"
        OaepPresentationText.PLAN_TITLE -> "Task plan"
        OaepPresentationText.PLAN_PURPOSE -> "Complete the goal step by step"
        OaepPresentationText.CURRENT_TASK -> "Complete the current task"
        OaepPresentationText.COMMAND_TITLE -> "Executing task step"
        OaepPresentationText.FILE_TITLE -> "Processing local files"
        OaepPresentationText.DELEGATING_TITLE -> "Delegating · ${arguments.firstOrNull()?.toString().orEmpty()}"
        OaepPresentationText.SUBTASK -> "Subtask"
        OaepPresentationText.PROCESSING -> "Processing"
        OaepPresentationText.ACTION_REQUIRED -> "Action required"
        OaepPresentationText.ARTIFACT -> "Artifact"
        OaepPresentationText.SEARCH_PURPOSE -> "Find public information relevant to the task"
        OaepPresentationText.FETCH_PURPOSE -> "Read and verify the selected source"
        OaepPresentationText.DELEGATE_PURPOSE -> "Handle an independent subtask in parallel"
        OaepPresentationText.WORKSPACE_PURPOSE -> "Process files in the authorized workspace"
        OaepPresentationText.STEP_PURPOSE -> "Complete the current task step"
        OaepPresentationText.INPUT_PROVIDED -> "Required input provided"
    }
}
