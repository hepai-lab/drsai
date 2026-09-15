package ai.drsai.remote.runtime.security

import ai.drsai.remote.R
import android.content.Context

enum class ToolOutcomeText { COMPLETED, NOT_EXECUTED, UNDO_LABEL, UNDO_PROMPT, IRREVERSIBLE }
fun interface ToolOutcomeStrings { fun text(key: ToolOutcomeText, vararg arguments: Any): String }
class AndroidToolOutcomeStrings(private val context: Context) : ToolOutcomeStrings {
    override fun text(key: ToolOutcomeText, vararg arguments: Any): String = context.getString(when (key) {
        ToolOutcomeText.COMPLETED -> R.string.tool_outcome_completed
        ToolOutcomeText.NOT_EXECUTED -> R.string.tool_outcome_not_executed
        ToolOutcomeText.UNDO_LABEL -> R.string.tool_outcome_undo_label
        ToolOutcomeText.UNDO_PROMPT -> R.string.tool_outcome_undo_prompt
        ToolOutcomeText.IRREVERSIBLE -> R.string.tool_outcome_irreversible
    }, *arguments)
}
object EnglishToolOutcomeStrings : ToolOutcomeStrings {
    override fun text(key: ToolOutcomeText, vararg arguments: Any): String = when (key) {
        ToolOutcomeText.COMPLETED -> "Operation completed"
        ToolOutcomeText.NOT_EXECUTED -> "Operation did not complete; no new external result is confirmed"
        ToolOutcomeText.UNDO_LABEL -> "Undo this change"
        ToolOutcomeText.UNDO_PROMPT -> "Undo the previous workspace change using mutation_token=${arguments.first()}"
        ToolOutcomeText.IRREVERSIBLE -> "This external operation is usually irreversible. To remediate it, perform a new reverse operation."
    }
}
