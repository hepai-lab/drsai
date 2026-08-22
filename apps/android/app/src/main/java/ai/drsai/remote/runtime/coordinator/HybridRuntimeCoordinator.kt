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
        val trimmed = json.trim()
        val root = if (trimmed.startsWith("{")) JSONObject(trimmed) else null
        val values = root?.optJSONArray("capabilities") ?: JSONArray(trimmed)
        val known = buildSet {
            repeat(values.length()) { index ->
                val wire = values.getString(index).lowercase()
                runCatching { RuntimeCapability.valueOf(wire.uppercase().replace('.', '_')) }.getOrNull()?.let(::add)
                when (wire) {
                    "run.create" -> add(RuntimeCapability.CHAT)
                    "approval.list", "approval.decide" -> add(RuntimeCapability.APPROVALS)
                    "file.raw.read" -> add(RuntimeCapability.PROJECT_FILES)
                    "mcp.stdio" -> add(RuntimeCapability.MCP_STDIO)
                }
            }
        }
        val limits = root?.optJSONObject("limits")
        return RuntimeCapabilitySet(
            schemaVersion = root?.optInt("schema_version", 1)?.coerceAtLeast(1) ?: 1,
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
        "powershell.execute" to RuntimeCapability.SHELL,
        "shell.execute" to RuntimeCapability.SHELL,
        "terminal.pty" to RuntimeCapability.PTY,
        "git.status" to RuntimeCapability.GIT,
        "git.diff" to RuntimeCapability.GIT,
        "git.command" to RuntimeCapability.GIT,
        "worktree.create" to RuntimeCapability.WORKTREE,
        "codex.run" to RuntimeCapability.CODEX,
        "mcp.call" to RuntimeCapability.MCP,
        "mcp.stdio.call" to RuntimeCapability.MCP_STDIO,
    )

    fun infer(toolIds: Collection<String>, background: Boolean = false): TaskRequirements = TaskRequirements(buildSet {
        add(RuntimeCapability.CHAT)
        toolIds.mapNotNull(toolCapabilities::get).forEach(::add)
        if (background) add(RuntimeCapability.BACKGROUND_RUNS)
    })
}

enum class DesktopHandoffState { NOT_REQUIRED, OFFER, UNAVAILABLE }

enum class DesktopHandoffKind { DESKTOP_NATIVE, MCP_STDIO }

data class DesktopHandoffDecision(
    val state: DesktopHandoffState,
    val required: Set<RuntimeCapability> = emptySet(),
    val target: RuntimeDescriptor? = null,
    val message: String = "",
    val kind: DesktopHandoffKind = DesktopHandoffKind.DESKTOP_NATIVE,
    val resourceId: String? = null,
    val executionLocation: String = "Desktop Runtime",
)

/** Detects only explicit Desktop-exclusive requests; it never claims that Android executed them. */
object DesktopHandoffPlanner {
    private val shell = Regex("(?i)(powershell|pwsh|shell|terminal|cmd(?:\\.exe)?|命令行|终端|执行命令)")
    private val pty = Regex("(?i)(pty|交互式终端|interactive terminal)")
    private val git = Regex("(?i)(?:\\bgit\\b|提交代码|创建分支|切换分支|合并分支|查看 diff)")
    private val codex = Regex("(?i)(?:\\bcodex\\b|codex cli)")
    private val stdioMcp = Regex(
        "(?i)(?:stdio\\s*(?:/|-)?\\s*mcp|mcp\\s*(?:/|-)?\\s*stdio|桌面\\s*(?:stdio\\s*)?mcp|本地进程\\s*mcp)",
    )
    private val namedMcpServer = Regex("(?i)(?:server|服务器)\\s*[:=：]?\\s*([A-Za-z0-9_.-]{1,64})")
    private val taggedMcpServer = Regex("@([A-Za-z0-9_.-]{1,64})")

    fun requiredCapabilities(input: String): Set<RuntimeCapability> = buildSet {
        if (shell.containsMatchIn(input)) add(RuntimeCapability.SHELL)
        if (pty.containsMatchIn(input)) add(RuntimeCapability.PTY)
        if (git.containsMatchIn(input)) add(RuntimeCapability.GIT)
        if (codex.containsMatchIn(input)) add(RuntimeCapability.CODEX)
        if (stdioMcp.containsMatchIn(input)) add(RuntimeCapability.MCP_STDIO)
    }

    fun plan(input: String, remotes: List<RuntimeDescriptor>): DesktopHandoffDecision {
        val required = requiredCapabilities(input)
        if (required.isEmpty()) return DesktopHandoffDecision(DesktopHandoffState.NOT_REQUIRED)
        val target = remotes.asSequence()
            .filter { it.online && it.binding.authority == RuntimeAuthority.REMOTE_RUNTIME }
            .filter { it.capabilities.values.containsAll(required + RuntimeCapability.CHAT) }
            .sortedWith(compareBy<RuntimeDescriptor> { it.displayName }.thenBy { it.binding.runtimeId.value })
            .firstOrNull()
        val isStdioMcp = RuntimeCapability.MCP_STDIO in required
        val kind = if (isStdioMcp) DesktopHandoffKind.MCP_STDIO else DesktopHandoffKind.DESKTOP_NATIVE
        val resource = if (isStdioMcp) requestedMcpServer(input) else null
        return if (target == null) DesktopHandoffDecision(
            DesktopHandoffState.UNAVAILABLE, required,
            message = if (isStdioMcp) {
                "Android 不支持本地 stdio MCP；当前没有声明 MCP_STDIO 的在线 Desktop Runtime。" +
                    "即使存在同名 HTTP MCP，也不会冒充 stdio 执行；尚未调用任何工具。"
            } else {
                "此请求需要 Desktop Runtime 的 ${labels(required)} 能力；当前没有满足条件的在线 Runtime，尚未执行任何命令。"
            },
            kind = kind, resourceId = resource,
        ) else DesktopHandoffDecision(
            DesktopHandoffState.OFFER, required, target,
            if (isStdioMcp) {
                "Android 不执行本地 stdio。确认后将把 ${resource?.let { "MCP server $it" } ?: "stdio MCP"} " +
                    "交给 ${target.displayName}；执行位置为 Desktop Runtime，远端调用仍需审批。"
            } else {
                "此请求需要交给 ${target.displayName} 执行 ${labels(required)}。确认后将打开远程 Runtime；Android 尚未执行任何命令。"
            },
            kind = kind, resourceId = resource,
        )
    }

    fun requestedMcpServer(input: String): String? =
        namedMcpServer.find(input)?.groupValues?.get(1)
            ?: taggedMcpServer.find(input)?.groupValues?.get(1)

    private fun labels(values: Set<RuntimeCapability>) = values.map { it.name }.sorted().joinToString(" / ")
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
    val kind: DesktopHandoffKind = DesktopHandoffKind.DESKTOP_NATIVE,
    val executionLocation: String = "Desktop Runtime",
    val transport: String? = null,
    val resourceId: String? = null,
    val remoteToolApprovalRequired: Boolean = true,
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
        kind: DesktopHandoffKind = DesktopHandoffKind.DESKTOP_NATIVE,
        resourceId: String? = null,
    ): HandoffPackage {
        require(confirmed) { "handoff_confirmation_required" }
        require(prompt.isNotBlank()) { "handoff_prompt_required" }
        val safePrompt = SensitiveDataRedactor.redact(prompt)
        val safeInstructions = instructions.map(SensitiveDataRedactor::redact)
        require(instructionVersions.all { (source, version) -> source.isNotBlank() && version.isNotBlank() }) {
            "handoff_instruction_version_invalid"
        }
        require(resourceId == null || resourceId.matches(Regex("^[A-Za-z0-9_.-]{1,64}$"))) {
            "handoff_resource_id_invalid"
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
            .put("kind", kind.name.lowercase())
            .put("execution_location", "desktop")
            .putOpt("transport", if (kind == DesktopHandoffKind.MCP_STDIO) "stdio" else null)
            .putOpt("resource_id", resourceId)
            .put("remote_tool_approval_required", true)
            .put("attachments", JSONArray(attachments.sortedBy { it.attachmentId }.map {
                JSONObject().put("id", it.attachmentId).put("sha256", it.sha256.lowercase())
                    .put("mime_type", it.mimeType).put("size", it.size)
            })).toString()
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return HandoffPackage(
            1, sourceRunId, targetRuntimeId, safePrompt, safeInstructions, attachments, digest,
            instructionVersions.toSortedMap(),
            kind = kind,
            transport = if (kind == DesktopHandoffKind.MCP_STDIO) "stdio" else null,
            resourceId = resourceId,
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
    val handoffs: Map<String, String> = emptyMap(),
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
            "handoff.requested" -> current.copy(
                handoffs = current.handoffs + (event.subjectId.orEmpty() to event.content.orEmpty()), seenEventIds = seen,
            )
            "run.completed", "run.failed", "run.cancelled" -> current.copy(terminal = event.kind, seenEventIds = seen)
            else -> current.copy(seenEventIds = seen)
        }
    }
}
