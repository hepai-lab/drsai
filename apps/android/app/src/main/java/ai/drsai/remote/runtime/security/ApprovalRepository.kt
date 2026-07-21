package ai.drsai.remote.runtime.security

import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.workbench.data.WorkbenchApprovalEntity
import ai.drsai.remote.workbench.data.WorkbenchApprovalGrantEntity
import ai.drsai.remote.workbench.data.WorkbenchAuditEntity
import ai.drsai.remote.workbench.model.ApprovalStatus
import ai.drsai.remote.workbench.model.WorkbenchId
import java.time.Instant
import java.util.UUID
import org.json.JSONObject
import ai.drsai.remote.runtime.tools.ToolApprovalGateway
import ai.drsai.remote.runtime.tools.ToolDefinition
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

data class CreateApprovalCommand(
    val subject: String,
    val organization: String,
    val runtimeId: WorkbenchId,
    val sessionId: WorkbenchId,
    val approvalId: WorkbenchId,
    val binding: ApprovalBinding,
    val expiresAtMillis: Long,
) {
    init {
        require(subject.isNotBlank()) { "approval_subject_required" }
        require(expiresAtMillis > 0) { "approval_expiry_invalid" }
    }
}

sealed interface ApprovalDecisionResult {
    data class Applied(val status: ApprovalStatus, val sessionGrantCreated: Boolean) : ApprovalDecisionResult
    data class AlreadyDecided(val status: ApprovalStatus) : ApprovalDecisionResult
    data object Expired : ApprovalDecisionResult
}

class ApprovalRepository(
    private val database: ChatDatabase,
    private val auditIdFactory: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun request(command: CreateApprovalCommand, nowMillis: Long): WorkbenchApprovalEntity =
        database.withTransaction {
            val dao = database.workbenchDao()
            val existing = dao.approval(
                command.subject, command.organization, command.runtimeId.value, command.approvalId.value,
            )
            val entity = command.toEntity(nowMillis)
            if (existing != null) {
                require(existing == entity.copy(updatedAt = existing.updatedAt)) { "approval_id_reused_with_different_binding" }
                return@withTransaction existing
            }
            dao.saveApproval(entity)
            dao.appendAudit(
                audit(
                    command, "approval.requested", "PENDING", nowMillis,
                    JSONObject().put("toolId", command.binding.toolId).put("scope", command.binding.scope).toString(),
                ),
            )
            entity
        }

    suspend fun decide(
        command: CreateApprovalCommand,
        decision: ApprovalDecision,
        nowMillis: Long,
    ): ApprovalDecisionResult = database.withTransaction {
        val dao = database.workbenchDao()
        val stored = dao.approval(
            command.subject, command.organization, command.runtimeId.value, command.approvalId.value,
        ) ?: error("approval_not_found")
        val storedStatus = ApprovalStatus.valueOf(stored.status)
        if (storedStatus != ApprovalStatus.PENDING) {
            return@withTransaction ApprovalDecisionResult.AlreadyDecided(storedStatus)
        }
        val expiresAt = stored.expiresAt.toExpiryMillis()
        if (nowMillis > expiresAt) {
            if (dao.decideApprovalIfPending(
                    command.subject, command.organization, command.runtimeId.value,
                    command.approvalId.value, ApprovalStatus.EXPIRED.name, nowMillis,
                ) == 1
            ) {
                dao.appendAudit(audit(command, "approval.expired", "EXPIRED", nowMillis, "{}"))
            }
            return@withTransaction ApprovalDecisionResult.Expired
        }
        val storedBinding = ApprovalBinding(
            WorkbenchId(stored.runId), stored.toolCallId, stored.operation,
            stored.argumentsDigest, stored.scope,
        )
        require(stored.sessionId == command.sessionId.value) { "approval_session_mismatch" }
        val request = ApprovalRequestState(
            command.approvalId, storedBinding, storedStatus, expiresAt,
        )
        val decided = request.decide(command.binding, decision, nowMillis)
        val updated = dao.decideApprovalIfPending(
            command.subject, command.organization, command.runtimeId.value,
            command.approvalId.value, decided.status.name, nowMillis,
        )
        if (updated != 1) {
            val winner = dao.approval(
                command.subject, command.organization, command.runtimeId.value, command.approvalId.value,
            ) ?: error("approval_not_found")
            return@withTransaction ApprovalDecisionResult.AlreadyDecided(ApprovalStatus.valueOf(winner.status))
        }
        val grant = decision == ApprovalDecision.ALLOW_SESSION
        if (grant) {
            dao.saveApprovalGrant(
                WorkbenchApprovalGrantEntity(
                    command.subject, command.organization, command.runtimeId.value,
                    command.sessionId.value, command.binding.toolId, nowMillis, null,
                ),
            )
        }
        dao.appendAudit(
            audit(
                command, "approval.decided", decided.status.name, nowMillis,
                JSONObject().put("decision", decision.name).put("toolId", command.binding.toolId).toString(),
            ),
        )
        ApprovalDecisionResult.Applied(decided.status, grant)
    }

    suspend fun isSessionGranted(
        subject: String,
        organization: String,
        runtimeId: WorkbenchId,
        sessionId: WorkbenchId,
        toolId: String,
        nowMillis: Long,
    ): Boolean = database.workbenchDao().hasApprovalGrant(
        subject, organization, runtimeId.value, sessionId.value, toolId, nowMillis,
    )

    suspend fun pending(subject: String, organization: String): List<WorkbenchApprovalEntity> =
        database.workbenchDao().pendingApprovals(subject, organization)

    suspend fun pending(subject: String): List<WorkbenchApprovalEntity> =
        database.workbenchDao().pendingApprovalsForSubject(subject)

    suspend fun audit(subject: String, organization: String): List<WorkbenchAuditEntity> =
        database.workbenchDao().audit(subject, organization)

    private fun CreateApprovalCommand.toEntity(nowMillis: Long) = WorkbenchApprovalEntity(
        subject = subject,
        organization = organization,
        runtimeId = runtimeId.value,
        sessionId = sessionId.value,
        runId = binding.runId.value,
        approvalId = approvalId.value,
        toolCallId = binding.toolCallId,
        operation = binding.toolId,
        argumentsDigest = binding.argumentsDigest,
        scope = binding.scope,
        status = ApprovalStatus.PENDING.name,
        expiresAt = expiresAtMillis.toString(),
        updatedAt = nowMillis,
    )

    private fun audit(
        command: CreateApprovalCommand,
        action: String,
        outcome: String,
        nowMillis: Long,
        details: String,
    ) = WorkbenchAuditEntity(
        subject = command.subject,
        organization = command.organization,
        auditId = auditIdFactory(),
        runtimeId = command.runtimeId.value,
        runId = command.binding.runId.value,
        action = action,
        outcome = outcome,
        createdAt = nowMillis,
        detailsJson = SensitiveDataRedactor.redact(details),
    )

    private fun String.toExpiryMillis(): Long = toLongOrNull()
        ?: runCatching { Instant.parse(this).toEpochMilli() }.getOrElse { error("approval_expiry_invalid") }
}

class RoomToolApprovalGateway(
    private val database: ChatDatabase,
    private val repository: ApprovalRepository,
    private val now: () -> Long = System::currentTimeMillis,
    private val approvalIdFactory: () -> WorkbenchId = { WorkbenchId(UUID.randomUUID().toString()) },
) : ToolApprovalGateway {
    override suspend fun awaitApproval(
        context: ToolExecutionContext,
        runId: String,
        sessionId: String,
        toolCallId: String,
        definition: ToolDefinition,
        arguments: String,
    ): Boolean {
        val runtimeId = WorkbenchId("android-local")
        val session = WorkbenchId(sessionId)
        if (repository.isSessionGranted(
                context.accountSubject, "", runtimeId, session, definition.id, now(),
            )
        ) return true
        val approvalId = approvalIdFactory()
        val binding = ApprovalBinding.create(
            WorkbenchId(runId), toolCallId, definition.id, arguments, "session",
        )
        val command = CreateApprovalCommand(
            context.accountSubject, "", runtimeId, session, approvalId, binding,
            expiresAtMillis = now() + 10 * 60 * 1_000,
        )
        repository.request(command, now())
        val decided = database.workbenchDao().approvalFlow(
            context.accountSubject, "", runtimeId.value, approvalId.value,
        ).filterNotNull().first { ApprovalStatus.valueOf(it.status) != ApprovalStatus.PENDING }
        return ApprovalStatus.valueOf(decided.status) == ApprovalStatus.APPROVED
    }
}
