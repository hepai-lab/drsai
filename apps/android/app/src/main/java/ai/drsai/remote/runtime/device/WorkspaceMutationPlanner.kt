package ai.drsai.remote.runtime.device

import java.security.MessageDigest
import org.json.JSONObject

data class WorkspaceMutationPlan(
    val operation: String,
    val path: String,
    val before: String?,
    val after: String?,
    val beforeSha256: String,
    val afterSha256: String,
    val diff: String,
    val token: String,
) {
    fun previewJson(): String = JSONObject()
        .put("operation", operation).put("path", path)
        .put("before_sha256", beforeSha256).put("after_sha256", afterSha256)
        .put("diff", diff).put("mutation_token", token).toString()
}

data class WorkspaceMutationCommit(val plan: WorkspaceMutationPlan, val replayed: Boolean)

/** In-process journal binding a prepared diff to one account and one OAEP tool-call id. */
class WorkspaceMutationJournal {
    private val pending = linkedMapOf<String, WorkspaceMutationPlan>()
    private val receipts = linkedMapOf<String, WorkspaceMutationPlan>()

    @Synchronized
    fun prepare(subject: String, callId: String, plan: WorkspaceMutationPlan): WorkspaceMutationPlan {
        val key = key(subject, callId)
        val existing = pending[key]
        require(existing == null || existing.token == plan.token) { "workspace_mutation_call_rebound" }
        if (existing == null) pending[key] = plan
        return pending.getValue(key)
    }

    @Synchronized
    fun planUndo(
        subject: String, callId: String, mutationToken: String, current: (String) -> String?,
    ): WorkspaceMutationPlan {
        val prefix = "$subject\u0000"
        val original = receipts.entries.firstOrNull { (key, value) -> key.startsWith(prefix) && value.token == mutationToken }?.value
            ?: error("workspace_mutation_receipt_not_found")
        val beforeUndo = current(original.path)
        require(WorkspaceMutationPlanner.digest(beforeUndo) == original.afterSha256) { "workspace_mutation_conflict" }
        return prepare(subject, callId, WorkspaceMutationPlanner.plan("undo", original.path, beforeUndo, original.before))
    }

    @Synchronized
    fun commit(
        subject: String, callId: String, current: (String) -> String?, apply: (WorkspaceMutationPlan) -> Unit,
    ): WorkspaceMutationCommit {
        val key = key(subject, callId)
        receipts[key]?.let { return WorkspaceMutationCommit(it, replayed = true) }
        val plan = pending[key] ?: error("workspace_mutation_preview_required")
        WorkspaceMutationPlanner.verifyCurrent(plan, current(plan.path))
        apply(plan)
        receipts[key] = plan
        pending.remove(key)
        return WorkspaceMutationCommit(plan, replayed = false)
    }

    private fun key(subject: String, callId: String): String {
        require(subject.isNotBlank()) { "workspace_mutation_subject_required" }
        require(callId.isNotBlank()) { "workspace_mutation_call_id_required" }
        return "$subject\u0000$callId"
    }
}

object WorkspaceMutationPlanner {
    const val MISSING = "missing"

    fun plan(operation: String, path: String, before: String?, after: String?): WorkspaceMutationPlan {
        require(operation in setOf("write", "edit", "undo")) { "workspace_mutation_operation_invalid" }
        require(SafWorkspaceGateway.safeParts(path).isNotEmpty()) { "workspace_mutation_path_invalid" }
        require(before != after) { "workspace_mutation_no_change" }
        val beforeSha = digest(before)
        val afterSha = digest(after)
        val diff = unifiedDiff(path, before, after)
        val token = sha256("p9-workspace-mutation-v1\u0000$operation\u0000$path\u0000$beforeSha\u0000$afterSha\u0000$diff")
        return WorkspaceMutationPlan(operation, path, before, after, beforeSha, afterSha, diff, token)
    }

    fun verifyCurrent(plan: WorkspaceMutationPlan, current: String?) {
        require(digest(current) == plan.beforeSha256) { "workspace_mutation_conflict" }
    }

    fun digest(content: String?): String = content?.let(::sha256) ?: MISSING

    private fun unifiedDiff(path: String, before: String?, after: String?): String {
        val oldLines = before?.lines().orEmpty()
        val newLines = after?.lines().orEmpty()
        val prefix = "--- a/$path\n+++ b/$path\n"
        val body = buildString {
            oldLines.take(200).forEach { append('-').append(it.take(500)).append('\n') }
            newLines.take(200).forEach { append('+').append(it.take(500)).append('\n') }
        }
        return (prefix + body).take(16_000)
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
