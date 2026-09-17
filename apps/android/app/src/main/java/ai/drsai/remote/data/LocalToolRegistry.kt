package ai.drsai.remote.data

import ai.drsai.remote.runtime.tools.ToolApprovalGateway
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.ToolRegistry
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.workbench.model.RuntimeCapability
import org.json.JSONObject

private const val MAX_TOOL_OUTPUT_CHARS = 4_096

/** Android host adapter used by the Full Runtime. This is not an Agent loop. */
class LocalToolRegistry(
    private val dao: ChatDao,
    private val registry: ToolRegistry = defaultLocalToolRegistry(dao),
    private val capabilities: (String) -> Set<RuntimeCapability> = {
        DEFAULT_AGENT.capabilities.mapNotNull { value ->
            runCatching { RuntimeCapability.valueOf(value.uppercase().replace('-', '_')) }.getOrNull()
        }.toSet()
    },
    private val approvals: ToolApprovalGateway? = null,
    private val strings: LocalToolExecutionStrings = EnglishLocalToolExecutionStrings,
) {
    data class Result(val output: String, val succeeded: Boolean, val code: String? = null)

    suspend fun execute(
        userId: String,
        call: CompletedToolCall,
        runId: String? = null,
        sessionId: String? = null,
    ): String = executeDetailed(userId, call, runId, sessionId).output

    suspend fun executeDetailed(
        userId: String,
        call: CompletedToolCall,
        runId: String? = null,
        sessionId: String? = null,
        approved: Boolean = false,
    ): Result {
        val context = ToolExecutionContext(
            userId, capabilities(userId), approved = approved,
            runId = runId, sessionId = sessionId, toolCallId = call.id,
        )
        return when (val outcome = registry.execute(context, call.name, call.arguments)) {
            is ToolExecutionOutcome.Success -> Result(outcome.output, true)
            is ToolExecutionOutcome.ApprovalRequired -> {
                val gateway = approvals
                if (gateway == null || runId == null || sessionId == null) {
                    rejected("approval_required", strings.text(LocalToolExecutionText.APPROVAL_REQUIRED, call.name))
                } else if (gateway.awaitApproval(
                        context, runId, sessionId, call.id, outcome.definition, outcome.arguments,
                    )
                ) {
                    when (val result = registry.execute(context.copy(approved = true), call.name, call.arguments)) {
                        is ToolExecutionOutcome.Success -> Result(result.output, true)
                        is ToolExecutionOutcome.Rejected -> rejected(result.code, strings.text(LocalToolExecutionText.REJECTED, call.name, result.code))
                        is ToolExecutionOutcome.ApprovalRequired -> rejected("approval_state_invalid", strings.text(LocalToolExecutionText.APPROVAL_STATE_INVALID))
                    }
                } else rejected("approval_declined", strings.text(LocalToolExecutionText.APPROVAL_DECLINED, call.name))
            }
            is ToolExecutionOutcome.Rejected -> rejected(outcome.code, strings.text(LocalToolExecutionText.REJECTED, call.name, outcome.code))
        }.let { it.copy(output = it.output.take(MAX_TOOL_OUTPUT_CHARS)) }
    }

    fun definitions(userId: String) = registry.definitions(ToolExecutionContext(userId, capabilities(userId)))

    fun risk(userId: String, toolId: String): String? = definitions(userId)
        .firstOrNull { it.id == toolId }?.risk?.name?.lowercase()

    fun modelSchemas(userId: String) = registry.toModelSchemas(ToolExecutionContext(userId, capabilities(userId)))

    suspend fun awaitApproval(
        userId: String,
        call: CompletedToolCall,
        runId: String,
        sessionId: String,
    ): Boolean {
        val gateway = approvals ?: return false
        val definition = registry.definition(call.name) ?: return false
        val context = ToolExecutionContext(
            userId, capabilities(userId), runId = runId, sessionId = sessionId, toolCallId = call.id,
        )
        val prepared = registry.prepareApproval(context, call.name, call.arguments) ?: return false
        return gateway.awaitApproval(context, runId, sessionId, call.id, definition, prepared.arguments)
    }

    private fun rejected(code: String, message: String) = Result(
        JSONObject().put("error", message).put("code", code).toString(), false, code,
    )
}
