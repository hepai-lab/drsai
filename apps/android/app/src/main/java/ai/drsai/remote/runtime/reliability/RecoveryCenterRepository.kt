package ai.drsai.remote.runtime.reliability

import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.workbench.data.WorkbenchAuditEntity
import java.util.UUID

data class RecoveryRunItem(
    val runId: String,
    val sessionId: String,
    val status: String,
    val title: String,
    val failureCode: String?,
    val updatedAt: Long,
    val canContinue: Boolean,
    val canCancel: Boolean,
    val canArchive: Boolean = true,
)

class RecoveryCenterRepository(
    private val database: ChatDatabase,
    private val auditId: () -> String = { UUID.randomUUID().toString() },
    private val staleAfterMillis: Long = 15 * 60 * 1_000,
    private val expiresAfterMillis: Long = 30L * 24 * 60 * 60 * 1_000,
    private val strings: RecoveryCenterStrings = EnglishRecoveryCenterStrings,
) {
    suspend fun candidates(subject: String, now: Long): List<RecoveryRunItem> = database.withTransaction {
        val dao = database.workbenchDao()
        val expiresAfter = now - expiresAfterMillis
        dao.pauseStaleRuns(subject, now - staleAfterMillis, expiresAfter, now)
        dao.recoveryCenterRuns(subject, expiresAfter).map { row ->
            val status = row.status
            RecoveryRunItem(
                row.runId, row.sessionId, status,
                when (status) {
                    "FAILED" -> strings.text(RecoveryCenterText.FAILED)
                    "WAITING_APPROVAL" -> strings.text(RecoveryCenterText.WAITING_APPROVAL)
                    "PAUSED" -> strings.text(if (row.failureCode == "stale_running_recovered") RecoveryCenterText.INTERRUPTED else RecoveryCenterText.PAUSED)
                    else -> strings.text(RecoveryCenterText.RECOVERABLE)
                },
                row.failureCode, row.updatedAt,
                canContinue = status in setOf("PAUSED", "QUEUED"),
                canCancel = status != "FAILED",
            )
        }
    }

    suspend fun archive(subject: String, runId: String, now: Long): Boolean = database.withTransaction {
        val run = database.workbenchDao().runBySubjectAndId(subject, runId) ?: return@withTransaction false
        database.workbenchDao().appendAuditIfAbsent(WorkbenchAuditEntity(
            subject, run.organization, auditId(), run.runtimeId, run.runId,
            "run.archived", "ARCHIVED", now, "{}",
        )) == 1L
    }
}
