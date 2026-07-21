package ai.drsai.remote.runtime.coordinator

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.ProjectInstructionVersion
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.RuntimeLimits
import ai.drsai.remote.workbench.model.RuntimeRouteDecision
import ai.drsai.remote.workbench.model.RuntimeRoutePolicy
import ai.drsai.remote.workbench.model.TaskRequirements
import ai.drsai.remote.workbench.model.WorkbenchId
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

data class RuntimeDescriptor(
    val binding: RuntimeBinding,
    val displayName: String,
    val version: String,
    val online: Boolean,
    val capabilities: RuntimeCapabilitySet,
)

/** Forward-compatible codec: unknown optional capabilities and fields are ignored. */
object RuntimeCapabilityCodec {
    fun decode(json: String): RuntimeCapabilitySet {
        val root = JSONObject(json)
        val values = root.optJSONArray("capabilities") ?: JSONArray()
        val known = buildSet {
            repeat(values.length()) { index ->
                runCatching { RuntimeCapability.valueOf(values.getString(index).uppercase()) }.getOrNull()?.let(::add)
            }
        }
        val limits = root.optJSONObject("limits")
        return RuntimeCapabilitySet(
            schemaVersion = root.optInt("schema_version", 1).coerceAtLeast(1),
            values = known,
            limits = RuntimeLimits(
                maxContextTokens = limits?.positiveIntOrNull("max_context_tokens"),
                maxToolCalls = limits?.positiveIntOrNull("max_tool_calls"),
                maxAttachmentBytes = limits?.positiveLongOrNull("max_attachment_bytes"),
            ),
        )
    }

    fun encode(value: RuntimeCapabilitySet): String = JSONObject()
        .put("schema_version", value.schemaVersion)
        .put("capabilities", JSONArray(value.values.map { it.name.lowercase() }.sorted()))
        .put("limits", JSONObject().apply {
            value.limits.maxContextTokens?.let { put("max_context_tokens", it) }
            value.limits.maxToolCalls?.let { put("max_tool_calls", it) }
            value.limits.maxAttachmentBytes?.let { put("max_attachment_bytes", it) }
        }).toString()

    private fun JSONObject.positiveIntOrNull(name: String): Int? =
        optInt(name, 0).takeIf { it > 0 }

    private fun JSONObject.positiveLongOrNull(name: String): Long? =
        optLong(name, 0).takeIf { it > 0 }
}

object TaskRequirementInferer {
    private val toolCapabilities = mapOf(
        "workspace.list" to RuntimeCapability.SAF_READ,
        "workspace.read" to RuntimeCapability.SAF_READ,
        "workspace.search" to RuntimeCapability.SAF_READ,
        "workspace.write" to RuntimeCapability.SAF_WRITE,
        "shell.execute" to RuntimeCapability.SHELL,
        "git.status" to RuntimeCapability.GIT,
        "git.diff" to RuntimeCapability.GIT,
        "worktree.create" to RuntimeCapability.WORKTREE,
        "codex.run" to RuntimeCapability.CODEX,
        "mcp.call" to RuntimeCapability.MCP,
    )

    fun infer(toolIds: Collection<String>, background: Boolean = false): TaskRequirements = TaskRequirements(buildSet {
        add(RuntimeCapability.CHAT)
        toolIds.mapNotNull(toolCapabilities::get).forEach(::add)
        if (background) add(RuntimeCapability.BACKGROUND_RUNS)
    })
}

data class RuntimeRecommendation(
    val decision: RuntimeRouteDecision,
    val required: Set<RuntimeCapability>,
    val localMissing: Set<RuntimeCapability>,
    val remoteMissing: Set<RuntimeCapability>,
    val reason: String,
)

object HybridRuntimeCoordinator {
    fun recommend(
        requirements: TaskRequirements,
        local: RuntimeDescriptor?,
        remote: RuntimeDescriptor?,
        explicit: RuntimeAuthority? = null,
    ): RuntimeRecommendation {
        val localSet = local?.capabilities?.takeIf { local.online }
        val remoteSet = remote?.capabilities?.takeIf { remote.online }
        val decision = RuntimeRoutePolicy.decide(requirements, localSet, remoteSet, explicit)
        val localMissing = requirements.capabilities - localSet?.values.orEmpty()
        val remoteMissing = requirements.capabilities - remoteSet?.values.orEmpty()
        val reason = when (decision) {
            RuntimeRouteDecision.LOCAL -> "Android 本地能力满足任务要求"
            RuntimeRouteDecision.REMOTE -> "任务需要远程 Runtime 能力"
            RuntimeRouteDecision.USER_CHOICE_REQUIRED -> "本地与远程均可执行，请选择运行位置"
            RuntimeRouteDecision.UNSUPPORTED -> "没有在线 Runtime 满足所需能力"
        }
        return RuntimeRecommendation(decision, requirements.capabilities, localMissing, remoteMissing, reason)
    }
}

class CapabilityRequiredException(
    val required: Set<RuntimeCapability>,
    val connectRemoteAvailable: Boolean,
) : IllegalStateException("capability_required:${required.joinToString(",") { it.name.lowercase() }}")

data class HandoffAttachment(val attachmentId: String, val sha256: String, val mimeType: String, val size: Long)

data class HandoffPackage(
    val schemaVersion: Int,
    val sourceRunId: WorkbenchId,
    val targetRuntimeId: WorkbenchId,
    val prompt: String,
    val instructions: List<String>,
    val attachments: List<HandoffAttachment>,
    val digest: String,
    val instructionVersions: Map<String, String> = emptyMap(),
)

object HandoffPackageFactory {
    fun create(
        sourceRunId: WorkbenchId,
        targetRuntimeId: WorkbenchId,
        prompt: String,
        instructions: List<String>,
        attachments: List<HandoffAttachment>,
        confirmed: Boolean,
        instructionVersions: Map<String, String> = emptyMap(),
    ): HandoffPackage {
        require(confirmed) { "handoff_confirmation_required" }
        require(prompt.isNotBlank()) { "handoff_prompt_required" }
        val safePrompt = SensitiveDataRedactor.redact(prompt)
        val safeInstructions = instructions.map(SensitiveDataRedactor::redact)
        require(instructionVersions.all { (source, version) -> source.isNotBlank() && version.isNotBlank() }) {
            "handoff_instruction_version_invalid"
        }
        attachments.forEach {
            require(it.attachmentId.isNotBlank() && it.sha256.matches(Regex("^[a-fA-F0-9]{64}$"))) {
                "handoff_attachment_invalid"
            }
            require(it.size >= 0) { "handoff_attachment_size_invalid" }
        }
        val canonical = JSONObject()
            .put("schema_version", 1)
            .put("source_run_id", sourceRunId.value)
            .put("target_runtime_id", targetRuntimeId.value)
            .put("prompt", safePrompt)
            .put("instructions", JSONArray(safeInstructions))
            .put("instruction_versions", JSONObject(instructionVersions.toSortedMap()))
            .put("attachments", JSONArray(attachments.sortedBy { it.attachmentId }.map {
                JSONObject().put("id", it.attachmentId).put("sha256", it.sha256.lowercase())
                    .put("mime_type", it.mimeType).put("size", it.size)
            })).toString()
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return HandoffPackage(
            1, sourceRunId, targetRuntimeId, safePrompt, safeInstructions, attachments, digest,
            instructionVersions.toSortedMap(),
        )
    }

    fun createFromSnapshots(
        sourceRunId: WorkbenchId,
        targetRuntimeId: WorkbenchId,
        prompt: String,
        instructions: List<PromptFragment>,
        attachments: List<HandoffAttachment>,
        confirmed: Boolean,
    ): HandoffPackage = create(
        sourceRunId, targetRuntimeId, prompt, instructions.map(PromptFragment::content), attachments, confirmed,
        ProjectInstructionVersion.versions(instructions),
    )
}

enum class UnifiedToolState { STARTED, RUNNING, SUCCEEDED, FAILED }

data class UnifiedRunProjection(
    val text: String = "",
    val tools: Map<String, UnifiedToolState> = emptyMap(),
    val pendingApprovals: Set<String> = emptySet(),
    val artifacts: Set<String> = emptySet(),
    val terminal: String? = null,
    val seenEventIds: Set<String> = emptySet(),
)

data class UnifiedRuntimeEvent(
    val eventId: String,
    val kind: String,
    val subjectId: String? = null,
    val content: String? = null,
)

/** The UI consumes this projection for both local and Relay-originated events. */
object UnifiedEventReducer {
    fun reduce(current: UnifiedRunProjection, event: UnifiedRuntimeEvent): UnifiedRunProjection {
        if (event.eventId in current.seenEventIds) return current
        val seen = current.seenEventIds + event.eventId
        return when (event.kind) {
            "message.delta" -> current.copy(text = current.text + event.content.orEmpty(), seenEventIds = seen)
            "tool.started" -> current.copy(tools = current.tools + (event.subjectId.orEmpty() to UnifiedToolState.STARTED), seenEventIds = seen)
            "tool.progress" -> current.copy(tools = current.tools + (event.subjectId.orEmpty() to UnifiedToolState.RUNNING), seenEventIds = seen)
            "tool.result" -> current.copy(tools = current.tools + (event.subjectId.orEmpty() to UnifiedToolState.SUCCEEDED), seenEventIds = seen)
            "tool.error" -> current.copy(tools = current.tools + (event.subjectId.orEmpty() to UnifiedToolState.FAILED), seenEventIds = seen)
            "approval.requested" -> current.copy(pendingApprovals = current.pendingApprovals + event.subjectId.orEmpty(), seenEventIds = seen)
            "approval.decided" -> current.copy(pendingApprovals = current.pendingApprovals - event.subjectId.orEmpty(), seenEventIds = seen)
            "artifact.created" -> current.copy(artifacts = current.artifacts + event.subjectId.orEmpty(), seenEventIds = seen)
            "run.completed", "run.failed", "run.cancelled" -> current.copy(terminal = event.kind, seenEventIds = seen)
            else -> current.copy(seenEventIds = seen)
        }
    }
}
