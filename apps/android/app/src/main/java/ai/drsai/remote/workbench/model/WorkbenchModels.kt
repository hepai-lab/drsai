package ai.drsai.remote.workbench.model

private val WORKBENCH_ID_PATTERN = Regex("^[A-Za-z0-9_.:-]{1,200}$")

@JvmInline
value class WorkbenchId(val value: String) {
    init {
        require(WORKBENCH_ID_PATTERN.matches(value) && value != "." && value != "..") {
            "invalid_workbench_id"
        }
    }
}

enum class RuntimeAuthority { LOCAL_DEVICE, REMOTE_RUNTIME }
enum class WorkspaceKind { LOCAL, REMOTE }
enum class WorkbenchRunStatus {
    QUEUED,
    RUNNING,
    WAITING_APPROVAL,
    PAUSED,
    COMPLETED,
    FAILED,
    CANCELLED,
}

data class RuntimeBinding(
    val runtimeId: WorkbenchId,
    val authority: RuntimeAuthority,
) {
    companion object {
        val AndroidLocal = RuntimeBinding(WorkbenchId("android-local"), RuntimeAuthority.LOCAL_DEVICE)
    }
}

data class WorkbenchWorkspace(
    val accountSubject: String,
    val organization: String,
    val binding: RuntimeBinding,
    val workspaceId: WorkbenchId,
    val displayName: String,
    val kind: WorkspaceKind,
    val lastSyncedAt: Long,
) {
    init {
        require(accountSubject.isNotBlank()) { "account_subject_required" }
        require(displayName.isNotBlank()) { "workspace_name_required" }
        require((kind == WorkspaceKind.LOCAL) == (binding.authority == RuntimeAuthority.LOCAL_DEVICE)) {
            "workspace_authority_mismatch"
        }
    }
}

data class WorkbenchSession(
    val accountSubject: String,
    val organization: String,
    val binding: RuntimeBinding,
    val workspaceId: WorkbenchId,
    val sessionId: WorkbenchId,
    val title: String,
    val backendId: String,
    val updatedAt: Long,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val unread: Boolean = false,
) {
    init {
        require(accountSubject.isNotBlank()) { "account_subject_required" }
        require(title.isNotBlank()) { "session_title_required" }
        require(backendId.isNotBlank()) { "backend_id_required" }
    }
}

/**
 * Runtime binding is immutable for the lifetime of a Run. This is intentionally
 * not a data class: callers cannot use copy() to silently rebind authority.
 */
class WorkbenchRun(
    val accountSubject: String,
    val organization: String,
    val binding: RuntimeBinding,
    val workspaceId: WorkbenchId,
    val sessionId: WorkbenchId,
    val runId: WorkbenchId,
    val backendId: String,
    val status: WorkbenchRunStatus,
    val lastSequence: Long = 0,
    val failureCode: String? = null,
) {
    init {
        require(accountSubject.isNotBlank()) { "account_subject_required" }
        require(backendId.isNotBlank()) { "backend_id_required" }
        require(lastSequence >= 0) { "last_sequence_invalid" }
    }

    fun requireSameScope(other: WorkbenchRun) {
        require(accountSubject == other.accountSubject) { "account_scope_mismatch" }
        require(organization == other.organization) { "organization_scope_mismatch" }
        require(binding == other.binding) { "runtime_authority_mismatch" }
        require(workspaceId == other.workspaceId) { "workspace_scope_mismatch" }
        require(sessionId == other.sessionId) { "session_scope_mismatch" }
        require(runId == other.runId) { "run_scope_mismatch" }
    }

    fun advance(status: WorkbenchRunStatus, sequence: Long, failureCode: String? = null): WorkbenchRun {
        require(sequence > lastSequence) { "event_sequence_not_advanced" }
        return WorkbenchRun(
            accountSubject, organization, binding, workspaceId, sessionId, runId,
            backendId, status, sequence, failureCode,
        )
    }
}

data class WorkbenchEvent(
    val eventId: WorkbenchId,
    val runId: WorkbenchId,
    val runtimeId: WorkbenchId,
    val sequence: Long,
    val timestamp: String,
    val kind: String,
    val payloadVersion: Int = 1,
    val payloadJson: String = "{}",
) {
    init {
        require(sequence > 0) { "event_sequence_invalid" }
        require(timestamp.isNotBlank()) { "event_timestamp_required" }
        require(kind.isNotBlank()) { "event_kind_required" }
        require(payloadVersion > 0) { "event_payload_version_invalid" }
    }
}

enum class ApprovalStatus { PENDING, APPROVED, DECLINED, EXPIRED, CANCELLED }

data class WorkbenchApproval(
    val approvalId: WorkbenchId,
    val runId: WorkbenchId,
    val runtimeId: WorkbenchId,
    val toolCallId: String,
    val operation: String,
    val argumentsDigest: String,
    val scope: String,
    val status: ApprovalStatus,
    val expiresAt: String,
) {
    init {
        require(toolCallId.isNotBlank()) { "tool_call_id_required" }
        require(operation.isNotBlank()) { "approval_operation_required" }
        require(argumentsDigest.isNotBlank()) { "approval_arguments_digest_required" }
        require(scope.isNotBlank()) { "approval_scope_required" }
        require(expiresAt.isNotBlank()) { "approval_expiry_required" }
    }
}

data class AuditEntry(
    val auditId: WorkbenchId,
    val accountSubject: String,
    val runtimeId: WorkbenchId,
    val runId: WorkbenchId?,
    val action: String,
    val outcome: String,
    val createdAt: Long,
    val detailsJson: String = "{}",
) {
    init {
        require(accountSubject.isNotBlank()) { "account_subject_required" }
        require(action.isNotBlank()) { "audit_action_required" }
        require(outcome.isNotBlank()) { "audit_outcome_required" }
    }
}

enum class RuntimeCapability {
    CHAT,
    STREAMING,
    LOCAL_MEMORY,
    ATTACHMENT_INPUT,
    SAFE_DEVICE_INFO,
    SAF_READ,
    SAF_WRITE,
    APPROVALS,
    ARTIFACTS,
    PROJECT_FILES,
    SHELL,
    GIT,
    WORKTREE,
    CODEX,
    MCP,
    BACKGROUND_RUNS,
}

data class RuntimeLimits(
    val maxContextTokens: Int? = null,
    val maxToolCalls: Int? = null,
    val maxAttachmentBytes: Long? = null,
) {
    init {
        require(maxContextTokens == null || maxContextTokens > 0) { "max_context_tokens_invalid" }
        require(maxToolCalls == null || maxToolCalls > 0) { "max_tool_calls_invalid" }
        require(maxAttachmentBytes == null || maxAttachmentBytes > 0) { "max_attachment_bytes_invalid" }
    }
}

data class RuntimeCapabilitySet(
    val schemaVersion: Int = 1,
    val values: Set<RuntimeCapability>,
    val limits: RuntimeLimits = RuntimeLimits(),
) {
    init { require(schemaVersion > 0) { "capability_schema_version_invalid" } }

    fun satisfies(required: Set<RuntimeCapability>): Boolean = values.containsAll(required)
}

data class TaskRequirements(val capabilities: Set<RuntimeCapability>)

enum class RuntimeRouteDecision { LOCAL, REMOTE, USER_CHOICE_REQUIRED, UNSUPPORTED }

object RuntimeRoutePolicy {
    fun decide(
        requirements: TaskRequirements,
        local: RuntimeCapabilitySet?,
        remote: RuntimeCapabilitySet?,
        explicitBinding: RuntimeAuthority? = null,
    ): RuntimeRouteDecision {
        val localFits = local?.satisfies(requirements.capabilities) == true
        val remoteFits = remote?.satisfies(requirements.capabilities) == true
        return when (explicitBinding) {
            RuntimeAuthority.LOCAL_DEVICE -> if (localFits) RuntimeRouteDecision.LOCAL else RuntimeRouteDecision.UNSUPPORTED
            RuntimeAuthority.REMOTE_RUNTIME -> if (remoteFits) RuntimeRouteDecision.REMOTE else RuntimeRouteDecision.UNSUPPORTED
            null -> when {
                localFits && remoteFits -> RuntimeRouteDecision.USER_CHOICE_REQUIRED
                localFits -> RuntimeRouteDecision.LOCAL
                remoteFits -> RuntimeRouteDecision.REMOTE
                else -> RuntimeRouteDecision.UNSUPPORTED
            }
        }
    }
}

/**
 * Operations that can be initiated from an Android Workspace surface.
 *
 * Android intentionally has no local shell, git-write, worktree or arbitrary-path
 * implementation. Keeping those actions in this common policy prevents a future UI
 * from accidentally treating a visible remote action as permission to execute it on
 * the device.
 */
enum class WorkspaceAction {
    VIEW_DETAILS,
    CREATE_SESSION,
    READ_PROJECT_FILE,
    WRITE_PROJECT_FILE,
    RUN_SHELL_COMMAND,
    READ_GIT_STATE,
    MUTATE_GIT_STATE,
    CREATE_WORKTREE,
}

enum class WorkspaceActionDecision {
    ALLOW,
    REQUIRE_REMOTE_APPROVAL,
    DISABLED_OFFLINE,
    DISABLED_MISSING_CAPABILITY,
    DISABLED_ON_DEVICE,
}

data class WorkspaceActionContext(
    val authority: RuntimeAuthority,
    val capabilities: RuntimeCapabilitySet,
    val online: Boolean,
)

object WorkspaceActionPolicy {
    private val requirements = mapOf(
        WorkspaceAction.CREATE_SESSION to RuntimeCapability.CHAT,
        WorkspaceAction.READ_PROJECT_FILE to RuntimeCapability.PROJECT_FILES,
        WorkspaceAction.WRITE_PROJECT_FILE to RuntimeCapability.PROJECT_FILES,
        WorkspaceAction.RUN_SHELL_COMMAND to RuntimeCapability.SHELL,
        WorkspaceAction.READ_GIT_STATE to RuntimeCapability.GIT,
        WorkspaceAction.MUTATE_GIT_STATE to RuntimeCapability.GIT,
        WorkspaceAction.CREATE_WORKTREE to RuntimeCapability.WORKTREE,
    )
    private val dangerous = setOf(
        WorkspaceAction.WRITE_PROJECT_FILE,
        WorkspaceAction.RUN_SHELL_COMMAND,
        WorkspaceAction.MUTATE_GIT_STATE,
        WorkspaceAction.CREATE_WORKTREE,
    )

    fun decide(action: WorkspaceAction, context: WorkspaceActionContext): WorkspaceActionDecision {
        if (action == WorkspaceAction.VIEW_DETAILS) return WorkspaceActionDecision.ALLOW
        if (!context.online && context.authority == RuntimeAuthority.REMOTE_RUNTIME) {
            return WorkspaceActionDecision.DISABLED_OFFLINE
        }
        val required = requirements.getValue(action)
        val localRequired = when (action) {
            WorkspaceAction.READ_PROJECT_FILE -> RuntimeCapability.SAF_READ
            WorkspaceAction.WRITE_PROJECT_FILE -> RuntimeCapability.SAF_WRITE
            else -> required
        }
        val effectiveRequired = if (context.authority == RuntimeAuthority.LOCAL_DEVICE) localRequired else required
        if (effectiveRequired !in context.capabilities.values) {
            return WorkspaceActionDecision.DISABLED_MISSING_CAPABILITY
        }
        if (context.authority == RuntimeAuthority.LOCAL_DEVICE && action in dangerous) {
            return WorkspaceActionDecision.DISABLED_ON_DEVICE
        }
        if (action in dangerous) {
            if (RuntimeCapability.APPROVALS !in context.capabilities.values) {
                return WorkspaceActionDecision.DISABLED_MISSING_CAPABILITY
            }
            return WorkspaceActionDecision.REQUIRE_REMOTE_APPROVAL
        }
        return WorkspaceActionDecision.ALLOW
    }
}
