package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.workbench.data.WorkbenchAuditEntity
import java.security.MessageDigest
import org.json.JSONObject

class RoomPythonSideEffectAudit(private val database: ChatDatabase) : PythonSideEffectAuditHostPort {
    override suspend fun append(record: HostSideEffectAudit) {
        require(record.phase in PHASES) { "side_effect_audit_phase_invalid" }
        require(record.kind in setOf("tool", "artifact", "approval")) { "side_effect_audit_kind_invalid" }
        val dao = database.workbenchDao()
        val run = dao.runById(record.runId) ?: error("side_effect_audit_run_missing")
        val binding = listOf(run.subject, run.organization, run.runtimeId, run.runId, record.operationId, record.phase)
            .joinToString("\u0000")
        val auditId = MessageDigest.getInstance("SHA-256").digest(binding.encodeToByteArray())
            .joinToString("") { "%02x".format(it) }
        dao.appendAuditIfAbsent(
            WorkbenchAuditEntity(
                subject = run.subject,
                organization = run.organization,
                auditId = auditId,
                runtimeId = run.runtimeId,
                runId = run.runId,
                action = "side_effect.${record.phase}",
                outcome = record.outcome,
                createdAt = System.currentTimeMillis(),
                detailsJson = JSONObject()
                    .put("operation_id_sha256", MessageDigest.getInstance("SHA-256")
                        .digest(record.operationId.encodeToByteArray()).joinToString("") { "%02x".format(it) })
                    .put("kind", record.kind)
                    .toString(),
            )
        )
    }

    companion object {
        val PHASES = setOf("intent", "approval", "execution", "receipt", "replay", "reconciliation", "terminal")
    }
}
