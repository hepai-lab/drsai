package ai.drsai.remote.remote.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import org.json.JSONObject

enum class RemoteRunControlOperation { CANCEL, RETRY }

data class PendingRemoteRunControl(
    val subject: String,
    val organization: String,
    val runtimeId: String,
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val operation: RemoteRunControlOperation,
    val idempotencyKey: String,
    val updatedAt: Long,
)

/**
 * Process-death-safe ledger for Run controls whose HTTP result is uncertain.
 *
 * Values contain identifiers only: never the user message, tool arguments,
 * approval reason, token, or response body. Both keys and values are encrypted
 * at rest. A Session owns at most one pending control operation.
 */
class RemoteRunControlLedger(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context.applicationContext,
        "remote_run_control_ledger",
        MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /**
     * Atomically acquires this Session's control slot or resumes the exact
     * same idempotent operation. A different pending operation must never
     * overwrite an outcome that still needs reconciliation after process
     * death.
     */
    fun begin(value: PendingRemoteRunControl): PendingRemoteRunControl = synchronized(LEDGER_LOCK) {
        validate(value)
        val existing = pendingUnsafe(
            value.subject, value.organization, value.runtimeId, value.workspaceId, value.sessionId,
        )
        check(existing == null || existing.sameOperation(value)) {
            "remote_run_control_conflict"
        }
        val stored = existing?.copy(updatedAt = maxOf(existing.updatedAt, value.updatedAt)) ?: value
        check(preferences.edit().putString(key(stored), encode(stored)).commit()) {
            "remote_run_control_persist_failed"
        }
        stored
    }

    fun pending(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): PendingRemoteRunControl? = synchronized(LEDGER_LOCK) {
        pendingUnsafe(subject, organization, runtimeId, workspaceId, sessionId)
    }

    private fun pendingUnsafe(
        subject: String,
        organization: String,
        runtimeId: String,
        workspaceId: String,
        sessionId: String,
    ): PendingRemoteRunControl? {
        val probe = PendingRemoteRunControl(
            subject, organization, runtimeId, workspaceId, sessionId,
            "probe", RemoteRunControlOperation.CANCEL, "probe", 0,
        )
        val raw = preferences.getString(key(probe), null) ?: return null
        val decoded = decode(raw)
        require(
            decoded.subject == subject && decoded.organization == organization &&
                decoded.runtimeId == runtimeId && decoded.workspaceId == workspaceId &&
                decoded.sessionId == sessionId
        ) { "remote_run_control_scope_mismatch" }
        return decoded
    }

    fun clear(value: PendingRemoteRunControl) = synchronized(LEDGER_LOCK) {
        val current = pendingUnsafe(
            value.subject, value.organization, value.runtimeId, value.workspaceId, value.sessionId,
        ) ?: return@synchronized
        // A delayed response from an earlier control must not erase a newer
        // operation that has already acquired this Session's slot.
        if (!current.sameOperation(value)) return@synchronized
        check(preferences.edit().remove(key(value)).commit()) {
            "remote_run_control_clear_failed"
        }
    }

    fun clearSubject(subject: String) = clearMatching { it.subject == subject }

    fun clearRuntime(subject: String, runtimeId: String) = clearMatching {
        it.subject == subject && it.runtimeId == runtimeId
    }

    private fun clearMatching(predicate: (PendingRemoteRunControl) -> Boolean) = synchronized(LEDGER_LOCK) {
        val keys = preferences.all.mapNotNull { (key, raw) ->
            val value = raw as? String ?: return@mapNotNull null
            runCatching { decode(value) }.getOrNull()?.takeIf(predicate)?.let { key }
        }
        if (keys.isEmpty()) return
        val editor = preferences.edit()
        keys.forEach(editor::remove)
        check(editor.commit()) { "remote_run_control_clear_failed" }
    }

    private fun PendingRemoteRunControl.sameOperation(other: PendingRemoteRunControl): Boolean =
        subject == other.subject && organization == other.organization &&
            runtimeId == other.runtimeId && workspaceId == other.workspaceId &&
            sessionId == other.sessionId && runId == other.runId &&
            operation == other.operation && idempotencyKey == other.idempotencyKey

    private fun key(value: PendingRemoteRunControl): String = MessageDigest.getInstance("SHA-256")
        .digest(listOf(
            value.subject, value.organization, value.runtimeId, value.workspaceId, value.sessionId,
        ).joinToString("\u0000").toByteArray())
        .joinToString("") { "%02x".format(it) }

    private fun encode(value: PendingRemoteRunControl): String = JSONObject()
        .put("schema_version", 1)
        .put("subject", value.subject)
        .put("organization", value.organization)
        .put("runtime_id", value.runtimeId)
        .put("workspace_id", value.workspaceId)
        .put("session_id", value.sessionId)
        .put("run_id", value.runId)
        .put("operation", value.operation.name.lowercase())
        .put("idempotency_key", value.idempotencyKey)
        .put("updated_at", value.updatedAt)
        .toString()

    private fun decode(raw: String): PendingRemoteRunControl {
        require(raw.length <= MAX_RECORD_BYTES) { "remote_run_control_record_too_large" }
        val value = JSONObject(raw)
        require(value.length() == 10 && value.getInt("schema_version") == 1) {
            "remote_run_control_record_invalid"
        }
        val result = PendingRemoteRunControl(
            value.getString("subject"), value.getString("organization"),
            value.getString("runtime_id"), value.getString("workspace_id"),
            value.getString("session_id"), value.getString("run_id"),
            RemoteRunControlOperation.valueOf(value.getString("operation").uppercase()),
            value.getString("idempotency_key"), value.getLong("updated_at"),
        )
        validate(result)
        return result
    }

    private fun validate(value: PendingRemoteRunControl) {
        listOf(
            value.subject, value.runtimeId, value.workspaceId, value.sessionId,
            value.runId, value.idempotencyKey,
        ).forEach { item ->
            require(item.isNotBlank() && item.length <= 500 && item.none {
                it == '\u0000' || it == '\r' || it == '\n'
            }) { "remote_run_control_identifier_invalid" }
        }
        require(value.organization.length <= 500 && value.updatedAt >= 0) {
            "remote_run_control_record_invalid"
        }
        val expected = when (value.operation) {
            RemoteRunControlOperation.CANCEL -> "cancel:${value.runId}"
            RemoteRunControlOperation.RETRY -> "retry:${value.runId}"
        }
        require(value.idempotencyKey == expected) { "remote_run_control_idempotency_invalid" }
    }

    private companion object {
        const val MAX_RECORD_BYTES = 4_096
        val LEDGER_LOCK = Any()
    }
}
