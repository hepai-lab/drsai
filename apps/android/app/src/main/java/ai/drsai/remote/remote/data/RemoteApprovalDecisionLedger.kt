package ai.drsai.remote.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import org.json.JSONObject

data class PendingRemoteApprovalDecision(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val approvalId: String,
    val decision: String,
    val idempotencyKey: String,
    val updatedAt: Long,
)

/** Process-death-safe, content-free ledger for uncertain Approval decisions. */
class RemoteApprovalDecisionLedger(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "remote_approval_decision_ledger",
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun begin(value: PendingRemoteApprovalDecision): PendingRemoteApprovalDecision =
        synchronized(LEDGER_LOCK) {
            validate(value)
            val existing = pendingUnsafe(
                value.subject, value.organization, value.runtimeId,
                value.workspaceId, value.sessionId,
            )
            check(existing == null || existing.sameDecision(value)) {
                "remote_approval_decision_conflict"
            }
            val stored = existing?.copy(updatedAt = maxOf(existing.updatedAt, value.updatedAt)) ?: value
            check(preferences.edit().putString(key(stored), encode(stored)).commit()) {
                "remote_approval_decision_persist_failed"
            }
            stored
        }

    fun pending(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): PendingRemoteApprovalDecision? = synchronized(LEDGER_LOCK) {
        pendingUnsafe(subject, organization, runtimeId, workspaceId, sessionId)
    }

    fun clear(value: PendingRemoteApprovalDecision) = synchronized(LEDGER_LOCK) {
        val current = pendingUnsafe(
            value.subject, value.organization, value.runtimeId,
            value.workspaceId, value.sessionId,
        ) ?: return@synchronized
        if (!current.sameDecision(value)) return@synchronized
        check(preferences.edit().remove(key(value)).commit()) {
            "remote_approval_decision_clear_failed"
        }
    }

    fun clearSubject(subject: String) = clearMatching { it.subject == subject }

    fun clearRuntime(subject: String, runtimeId: String) = clearMatching {
        it.subject == subject && it.runtimeId == runtimeId
    }

    private fun pendingUnsafe(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): PendingRemoteApprovalDecision? {
        val raw = preferences.getString(
            key(subject, organization, runtimeId, workspaceId, sessionId), null,
        ) ?: return null
        val decoded = decode(raw)
        require(
            decoded.subject == subject && decoded.organization == organization &&
                decoded.runtimeId == runtimeId && decoded.workspaceId == workspaceId &&
                decoded.sessionId == sessionId
        ) { "remote_approval_decision_scope_mismatch" }
        return decoded
    }

    private fun clearMatching(predicate: (PendingRemoteApprovalDecision) -> Boolean) =
        synchronized(LEDGER_LOCK) {
            val keys = preferences.all.mapNotNull { (key, raw) ->
                val value = raw as? String ?: return@mapNotNull null
                runCatching { decode(value) }.getOrNull()?.takeIf(predicate)?.let { key }
            }
            if (keys.isEmpty()) return@synchronized
            val editor = preferences.edit()
            keys.forEach(editor::remove)
            check(editor.commit()) { "remote_approval_decision_clear_failed" }
        }

    private fun key(value: PendingRemoteApprovalDecision): String = key(
        value.subject, value.organization, value.runtimeId, value.workspaceId, value.sessionId,
    )

    private fun key(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): String = MessageDigest.getInstance("SHA-256")
        .digest(listOf(subject, organization, runtimeId, workspaceId, sessionId)
            .joinToString("\u0000").toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun encode(value: PendingRemoteApprovalDecision): String = JSONObject()
        .put("schema_version", 1)
        .put("subject", value.subject)
        .put("organization", value.organization)
        .put("runtime_id", value.runtimeId)
        .put("workspace_id", value.workspaceId)
        .put("session_id", value.sessionId)
        .put("run_id", value.runId)
        .put("approval_id", value.approvalId)
        .put("decision", value.decision)
        .put("idempotency_key", value.idempotencyKey)
        .put("updated_at", value.updatedAt)
        .toString()

    private fun decode(raw: String): PendingRemoteApprovalDecision {
        require(raw.length <= MAX_RECORD_BYTES) { "remote_approval_decision_record_too_large" }
        val value = JSONObject(raw)
        require(value.length() == 11 && value.getInt("schema_version") == 1) {
            "remote_approval_decision_record_invalid"
        }
        return PendingRemoteApprovalDecision(
            value.getString("subject"), value.getString("organization"),
            value.getString("runtime_id"), value.getString("workspace_id"),
            value.getString("session_id"), value.getString("run_id"),
            value.getString("approval_id"), value.getString("decision"),
            value.getString("idempotency_key"), value.getLong("updated_at"),
        ).also(::validate)
    }

    private fun validate(value: PendingRemoteApprovalDecision) {
        listOf(
            value.subject, value.runtimeId, value.workspaceId, value.sessionId,
            value.runId, value.approvalId, value.decision, value.idempotencyKey,
        ).forEach { item ->
            require(item.isNotBlank() && item.length <= 500 && item.none {
                it == '\u0000' || it == '\r' || it == '\n'
            }) { "remote_approval_decision_identifier_invalid" }
        }
        require(value.organization.length <= 500 && value.updatedAt >= 0) {
            "remote_approval_decision_record_invalid"
        }
        require(value.decision in setOf("approve", "deny", "cancel")) {
            "remote_approval_decision_invalid"
        }
        require(value.idempotencyKey == "approval:${value.approvalId}:${value.decision}") {
            "remote_approval_decision_idempotency_invalid"
        }
    }

    private fun PendingRemoteApprovalDecision.sameDecision(
        other: PendingRemoteApprovalDecision,
    ): Boolean = subject == other.subject && organization == other.organization &&
        runtimeId == other.runtimeId && workspaceId == other.workspaceId &&
        sessionId == other.sessionId && runId == other.runId &&
        approvalId == other.approvalId && decision == other.decision &&
        idempotencyKey == other.idempotencyKey

    private companion object {
        const val MAX_RECORD_BYTES = 4_096
        val LEDGER_LOCK = Any()
    }
}
