package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import java.security.MessageDigest
import java.time.Instant

data class LegacyOaepShadowAuditResult(
    val sessionId: String,
    val readyForCutover: Boolean,
    val migrationStatus: String?,
    val mismatchCodes: List<String>,
    val legacySourceDigest: String?,
    val oaepSnapshotDigest: String?,
)

/**
 * Read-only semantic comparison between the legacy store and the OAEP authority.
 * It returns diagnostics only: callers must render either Legacy or OAEP, never a merged list.
 * A mismatch marks the migration row DIVERGED so every cutover path fails closed.
 */
class LegacyOaepShadowAuditor(
    private val database: ChatDatabase,
    private val now: () -> Long = System::currentTimeMillis,
) {
    suspend fun auditSession(
        subject: String,
        organization: String,
        sessionId: String,
    ): LegacyOaepShadowAuditResult {
        require(subject.isNotBlank() && sessionId.isNotBlank()) { "oaep_shadow_scope_required" }
        val conversation = database.dao().conversationSnapshot(subject).singleOrNull { it.id == sessionId }
        val migrationDao = database.androidOaepDao()
        val migration = migrationDao.migration(
            subject, organization, LegacyOaepBackfill.RUNTIME_ID, sessionId, LegacyOaepBackfill.VERSION,
        )
        val snapshot = RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner(subject, organization), LegacyOaepBackfill.RUNTIME_ID,
            LegacyOaepBackfill.WORKSPACE_ID, sessionId,
        )
        val mismatches = sortedSetOf<String>()
        if (conversation == null) mismatches += "legacy_session_missing"
        if (migration?.status != "COMPLETED") mismatches += "migration_not_complete"
        if (snapshot == null) mismatches += "oaep_snapshot_missing"
        if (conversation != null && snapshot != null) {
            if (snapshot.session.workspaceId != LegacyOaepBackfill.WORKSPACE_ID) mismatches += "session_workspace"
            if (snapshot.session.title != conversation.title) mismatches += "session_title"
            val actualItems = snapshot.items.associateBy { it.source.backendItemId }
            val expectedItemIds = mutableSetOf<String>()
            val messages = database.dao().runtimeMessageSnapshot(sessionId)
            val attachments = database.dao().attachmentSnapshot(sessionId)
            messages.forEach { message ->
                val key = message.id
                expectedItemIds += key
                val item = actualItems[key]
                if (item == null) {
                    mismatches += "message_missing"
                } else if (message.role in setOf("user", "assistant", "system")) {
                    val content = item.content as? OaepMessageContent
                    if (item.type != "message" || content == null) mismatches += "message_type"
                    else {
                        if (content.role != message.role) mismatches += "message_role"
                        if (content.text != message.content) mismatches += "message_text"
                        if (content.phase != message.status) mismatches += "message_phase"
                        val expectedResources = attachments.filter { it.messageId == message.id }.map { it.id }.sorted()
                        if (content.resourceRefs.map { it.resourceId }.sorted() != expectedResources) mismatches += "message_resources"
                    }
                    if (item.status != "completed") mismatches += "message_status"
                    if (item.createdAt != iso(message.createdAt)) mismatches += "message_timestamp"
                } else {
                    val content = item.content as? OaepNoticeContent
                    if (item.type != "notice" || content?.code != "legacy_message_role_unknown") {
                        mismatches += "unknown_message_projection"
                    }
                }
            }
            database.dao().allToolArtifacts(subject).filter { it.sessionId == sessionId }.forEach { artifact ->
                expectedItemIds += artifact.id
                val item = actualItems[artifact.id]
                val content = item?.content as? OaepArtifactContent
                if (item?.type != "artifact" || content == null) mismatches += "artifact_missing"
                else {
                    if (content.artifactId != artifact.id || content.summary != artifact.content.take(MAX_SUMMARY)) {
                        mismatches += "artifact_content"
                    }
                    if (item.createdAt != iso(artifact.createdAt)) mismatches += "artifact_timestamp"
                }
            }
            val workbench = database.workbenchDao()
            workbench.sessionEvents(subject, organization, sessionId).forEach { event ->
                val key = "workbench-event:${event.runtimeId}:${event.eventId}"
                expectedItemIds += key
                val item = actualItems[key]
                val content = item?.content as? OaepNoticeContent
                if (item?.type != "notice" || content?.code != "legacy_workbench_event") mismatches += "workbench_event_missing"
                else {
                    if (content.message != event.kind || content.details["payload_digest"] != sha256(event.payloadJson)) {
                        mismatches += "workbench_event_content"
                    }
                    if (item.createdAt != event.timestamp) mismatches += "workbench_event_timestamp"
                }
            }
            val expectedRunIds = mutableSetOf(stableId("legacy-run", subject, sessionId))
            val actualRuns = snapshot.runs.associateBy { it.id }
            if (actualRuns[expectedRunIds.single()]?.status != "completed") mismatches += "history_run_status"
            workbench.sessionRuns(subject, organization, sessionId).forEach { run ->
                val runId = stableId("legacy-workbench-run", subject, run.runtimeId, run.runId)
                expectedRunIds += runId
                val expectedStatus = when (run.status) {
                    "COMPLETED" -> "completed"
                    "FAILED" -> "failed"
                    "CANCELLED" -> "cancelled"
                    else -> "waiting"
                }
                if (actualRuns[runId]?.status != expectedStatus) mismatches += "workbench_run_status"
                val checkpointKey = "workbench-run-checkpoint:${run.runtimeId}:${run.runId}"
                expectedItemIds += checkpointKey
                val checkpoint = actualItems[checkpointKey]?.content as? OaepNoticeContent
                if (checkpoint?.code != "legacy_workbench_run_checkpoint" ||
                    checkpoint.details["legacy_status"] != run.status ||
                    (checkpoint.details["legacy_sequence"] as? Number)?.toLong() != run.lastSequence
                ) mismatches += "workbench_checkpoint"
                if (expectedStatus == "waiting") {
                    val interactionKey = "workbench-run-reconciliation:${run.runtimeId}:${run.runId}"
                    expectedItemIds += interactionKey
                    val interactionItem = actualItems[interactionKey]
                    val interaction = interactionItem?.content as? OaepInteractionContent
                    if (interactionItem?.status != "waiting" || interaction?.interactionType != "reconciliation") {
                        mismatches += "workbench_reconciliation"
                    }
                }
            }
            if (actualItems.keys.filterNotNull().toSet() != expectedItemIds) mismatches += "unexpected_or_unbound_item"
            if (actualRuns.keys != expectedRunIds) mismatches += "unexpected_run"
        }
        if (mismatches.isNotEmpty() && migration?.status == "COMPLETED") {
            migrationDao.saveMigration(migration.copy(
                status = "DIVERGED", updatedAt = now(), errorCode = "shadow_audit_mismatch",
            ))
        }
        return LegacyOaepShadowAuditResult(
            sessionId = sessionId,
            readyForCutover = mismatches.isEmpty(),
            migrationStatus = if (mismatches.isNotEmpty() && migration?.status == "COMPLETED") "DIVERGED" else migration?.status,
            mismatchCodes = mismatches.toList(),
            legacySourceDigest = migration?.sourceDigest,
            oaepSnapshotDigest = snapshot?.let(::androidOaepSnapshotDigest),
        )
    }

    suspend fun requireCutoverReady(subject: String, organization: String, sessionId: String) {
        val result = auditSession(subject, organization, sessionId)
        check(result.readyForCutover) {
            "oaep_shadow_cutover_blocked:${result.mismatchCodes.joinToString(",")}".take(256)
        }
    }

    private fun stableId(prefix: String, vararg values: String) = "$prefix-${sha256(values.joinToString("\u0000")).take(32)}"
    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }
    private fun iso(value: Long) = Instant.ofEpochMilli(value.coerceAtLeast(0)).toString()

    companion object { private const val MAX_SUMMARY = 4_000 }
}
