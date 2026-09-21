package ai.drsai.remote.runtime.security

data class ToolOperationOutcome(
    val completed: String?,
    val notExecuted: String?,
    val remedyLabel: String? = null,
    val remedyPrompt: String? = null,
    val irreversibleNotice: String? = null,
    val partial: Boolean = completed != null && notExecuted != null,
)

object ToolOperationOutcomePolicy {
    fun present(toolId: String, status: String, result: Any?, strings: ToolOutcomeStrings = EnglishToolOutcomeStrings): ToolOperationOutcome {
        val values = result as? Map<*, *>
        val summary = safe(values?.get("summary") ?: values?.get("message") ?: (result as? String))
        val completed = safe(values?.get("completed"))
        val notExecuted = safe(values?.get("not_executed"))
        val token = values?.get("mutation_token")?.toString()?.takeIf(String::isNotBlank)
        val failed = status in setOf("failed", "cancelled")
        val effectiveCompleted = completed ?: if (!failed) summary?.ifBlank { null } ?: strings.text(ToolOutcomeText.COMPLETED) else null
        val effectiveNotExecuted = notExecuted ?: if (failed) strings.text(ToolOutcomeText.NOT_EXECUTED) else null
        val reversible = toolId in setOf("workspace.write", "workspace.edit") && token != null && effectiveCompleted != null
        val irreversible = toolId == "browser.submit" || toolId.startsWith("mcp.") || toolId in setOf("delegate", "core.delegate")
        return ToolOperationOutcome(
            completed = effectiveCompleted,
            notExecuted = effectiveNotExecuted,
            remedyLabel = if (reversible) strings.text(ToolOutcomeText.UNDO_LABEL) else null,
            remedyPrompt = if (reversible) strings.text(ToolOutcomeText.UNDO_PROMPT, token!!) else null,
            irreversibleNotice = if (irreversible && effectiveCompleted != null) strings.text(ToolOutcomeText.IRREVERSIBLE) else null,
        )
    }

    private fun safe(value: Any?): String? = value?.toString()?.takeIf(String::isNotBlank)
        ?.let(SensitiveDataRedactor::redact)?.take(800)
}
