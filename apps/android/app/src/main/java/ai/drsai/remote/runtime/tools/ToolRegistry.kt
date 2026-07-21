package ai.drsai.remote.runtime.tools

import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.data.WorkbenchAuditEntity
import ai.drsai.remote.workbench.data.WorkbenchDao
import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

enum class ToolRisk { READ_ONLY, LOCAL_WRITE, EXTERNAL_WRITE, SENSITIVE, FORBIDDEN }
enum class ToolPolicyDecision { ALLOW, REQUIRE_APPROVAL, DENY }

data class ToolDefinition(
    val id: String,
    val version: Int,
    val description: String,
    val risk: ToolRisk,
    val requiredArguments: Set<String> = emptySet(),
    val requiredCapabilities: Set<RuntimeCapability> = emptySet(),
    val maxArgumentsChars: Int = 8_192,
) {
    init {
        require(id.matches(Regex("^[a-z][a-z0-9_.-]{1,100}$"))) { "tool_id_invalid" }
        require(version > 0) { "tool_version_invalid" }
        require(description.isNotBlank()) { "tool_description_required" }
        require(maxArgumentsChars > 0) { "tool_arguments_limit_invalid" }
    }
}

data class ToolExecutionContext(
    val accountSubject: String,
    val runtimeCapabilities: Set<RuntimeCapability>,
    val approved: Boolean = false,
    val runId: String? = null,
    val sessionId: String? = null,
    val toolCallId: String? = null,
)

sealed interface ToolExecutionOutcome {
    data class Success(val output: String, val artifactId: String? = null, val truncated: Boolean = false) : ToolExecutionOutcome
    data class ApprovalRequired(val definition: ToolDefinition, val arguments: String) : ToolExecutionOutcome
    data class Rejected(val code: String) : ToolExecutionOutcome
}

fun interface ToolHandler {
    suspend fun execute(context: ToolExecutionContext, arguments: JSONObject): String
}

fun interface ToolApprovalGateway {
    suspend fun awaitApproval(
        context: ToolExecutionContext,
        runId: String,
        sessionId: String,
        toolCallId: String,
        definition: ToolDefinition,
        arguments: String,
    ): Boolean
}

fun interface ToolOutputArtifactSink {
    suspend fun persist(context: ToolExecutionContext, definition: ToolDefinition, fullOutput: String): String
}

fun interface ToolAuditSink {
    suspend fun append(
        context: ToolExecutionContext,
        toolId: String,
        action: String,
        outcome: String,
        details: String,
    )
}

class RoomToolAuditSink(
    private val dao: WorkbenchDao,
    private val idFactory: () -> String = { UUID.randomUUID().toString() },
    private val clock: () -> Long = System::currentTimeMillis,
) : ToolAuditSink {
    override suspend fun append(
        context: ToolExecutionContext,
        toolId: String,
        action: String,
        outcome: String,
        details: String,
    ) {
        dao.appendAudit(
            WorkbenchAuditEntity(
                subject = context.accountSubject,
                organization = "",
                auditId = idFactory(),
                runtimeId = "android-local",
                runId = context.runId,
                action = "tool.$action",
                outcome = outcome,
                createdAt = clock(),
                detailsJson = SensitiveDataRedactor.redact(
                    JSONObject().put("toolId", toolId).put("details", details.take(2_000)).toString(),
                ),
            ),
        )
    }
}

class RoomToolOutputArtifactSink(private val dao: ChatDao) : ToolOutputArtifactSink {
    override suspend fun persist(context: ToolExecutionContext, definition: ToolDefinition, fullOutput: String): String {
        val runId = requireNotNull(context.runId) { "tool_artifact_run_required" }
        val sessionId = requireNotNull(context.sessionId) { "tool_artifact_session_required" }
        val toolCallId = requireNotNull(context.toolCallId) { "tool_artifact_call_required" }
        val id = UUID.randomUUID().toString()
        dao.saveToolArtifact(ToolArtifactEntity(
            id, context.accountSubject, runId, sessionId, toolCallId, definition.id, fullOutput, System.currentTimeMillis(),
        ))
        return id
    }
}

object ToolPermissionPolicy {
    fun decide(definition: ToolDefinition, context: ToolExecutionContext): ToolPolicyDecision = when {
        definition.risk == ToolRisk.FORBIDDEN -> ToolPolicyDecision.DENY
        !context.runtimeCapabilities.containsAll(definition.requiredCapabilities) -> ToolPolicyDecision.DENY
        definition.risk in setOf(ToolRisk.EXTERNAL_WRITE, ToolRisk.SENSITIVE) && !context.approved ->
            ToolPolicyDecision.REQUIRE_APPROVAL
        else -> ToolPolicyDecision.ALLOW
    }
}

class ToolRegistry(
    private val maxOutputChars: Int = 4_096,
    private val artifactSink: ToolOutputArtifactSink? = null,
    private val auditSink: ToolAuditSink? = null,
) {
    private data class Registration(val definition: ToolDefinition, val handler: ToolHandler)
    private val registrations = linkedMapOf<String, Registration>()

    init { require(maxOutputChars > 0) { "tool_output_limit_invalid" } }

    fun register(definition: ToolDefinition, handler: ToolHandler) {
        require(definition.id !in registrations) { "tool_already_registered:${definition.id}" }
        registrations[definition.id] = Registration(definition, handler)
    }

    fun definitions(context: ToolExecutionContext): List<ToolDefinition> = registrations.values
        .map(Registration::definition)
        .filter { ToolPermissionPolicy.decide(it, context) != ToolPolicyDecision.DENY }

    suspend fun execute(context: ToolExecutionContext, toolId: String, rawArguments: String): ToolExecutionOutcome {
        val registration = registrations[toolId] ?: return rejected(context, toolId, "tool_not_registered")
        val definition = registration.definition
        if (rawArguments.length > definition.maxArgumentsChars) {
            return rejected(context, toolId, "tool_arguments_too_large")
        }
        val arguments = runCatching { JSONObject(rawArguments.ifBlank { "{}" }) }
            .getOrElse { return rejected(context, toolId, "tool_arguments_invalid_json") }
        if (definition.requiredArguments.any { !arguments.has(it) || arguments.isNull(it) }) {
            return rejected(context, toolId, "tool_arguments_missing")
        }
        return when (ToolPermissionPolicy.decide(definition, context)) {
            ToolPolicyDecision.DENY -> rejected(context, toolId, "tool_not_permitted")
            ToolPolicyDecision.REQUIRE_APPROVAL -> {
                auditSink?.append(context, toolId, "approval_required", "PENDING", "scope=once_or_session")
                ToolExecutionOutcome.ApprovalRequired(definition, arguments.toString())
            }
            ToolPolicyDecision.ALLOW -> try {
                auditSink?.append(context, toolId, "started", "RUNNING", "call=${context.toolCallId.orEmpty()}")
                val fullOutput = registration.handler.execute(context, arguments)
                val outcome = if (fullOutput.length <= maxOutputChars) ToolExecutionOutcome.Success(fullOutput)
                else {
                    val artifactId = artifactSink?.persist(context, definition, fullOutput)
                    val summary = JSONObject()
                        .put("truncated", true)
                        .put("preview", fullOutput.take((maxOutputChars - 256).coerceAtLeast(32)))
                        .put("artifact_id", artifactId)
                        .toString()
                    ToolExecutionOutcome.Success(summary, artifactId, truncated = true)
                }
                auditSink?.append(context, toolId, "completed", "SUCCEEDED", "artifact=${outcome.artifactId.orEmpty()}")
                outcome
            } catch (error: Throwable) {
                val code = error.message ?: "tool_execution_failed"
                auditSink?.append(context, toolId, "failed", "FAILED", code)
                ToolExecutionOutcome.Rejected(code)
            }
        }
    }

    private suspend fun rejected(context: ToolExecutionContext, toolId: String, code: String): ToolExecutionOutcome.Rejected {
        auditSink?.append(context, toolId, "rejected", "REJECTED", code)
        return ToolExecutionOutcome.Rejected(code)
    }
}

fun defaultLocalToolRegistry(
    dao: ChatDao,
    artifactSink: ToolOutputArtifactSink? = null,
    auditSink: ToolAuditSink? = null,
): ToolRegistry = ToolRegistry(artifactSink = artifactSink, auditSink = auditSink).apply {
    register(
        ToolDefinition("get_current_time", 1, "Get current time and timezone", ToolRisk.READ_ONLY),
    ) { _, _ ->
        JSONObject().put("time", ZonedDateTime.now().format(DateTimeFormatter.ISO_ZONED_DATE_TIME)).toString()
    }
    register(
        ToolDefinition("save_memory", 1, "Save an app-private user memory", ToolRisk.LOCAL_WRITE, setOf("content")),
    ) { context, arguments ->
        val content = arguments.optString("content").trim()
        require(content.length in 1..500) { "content_length_invalid" }
        val id = dao.saveMemory(MemoryEntity(userId = context.accountSubject, content = content))
        JSONObject().put("saved", true).put("id", id).toString()
    }
    register(
        ToolDefinition("search_memory", 1, "Search app-private user memories", ToolRisk.READ_ONLY, setOf("query")),
    ) { context, arguments ->
        val query = arguments.optString("query").trim()
        require(query.length in 1..100) { "query_length_invalid" }
        val limit = arguments.optInt("limit", 5).coerceIn(1, 10)
        val items = dao.searchMemories(context.accountSubject, query, limit)
        JSONObject().put(
            "items",
            JSONArray(items.map { JSONObject().put("id", it.id).put("content", it.content) }),
        ).toString()
    }
}
