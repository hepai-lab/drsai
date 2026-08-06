package ai.drsai.remote.runtime.oaep

import androidx.room.withTransaction
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MessageAttachmentEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.workbench.data.WorkbenchEventEntity
import ai.drsai.remote.workbench.data.WorkbenchRunEntity
import ai.drsai.remote.remote.generated.OaepArtifactContent
import ai.drsai.remote.remote.generated.OaepError
import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepResourceRef
import java.security.MessageDigest
import java.time.Instant

data class LegacyOaepBackfillPage(
    val migrated: Int,
    val skipped: Int,
    val diverged: Int,
    val failed: Int,
    val nextSessionId: String?,
    val hasMore: Boolean,
)

class LegacyOaepBackfill(
    private val database: ChatDatabase,
    private val now: () -> Long = System::currentTimeMillis,
) {
    suspend fun migrateAccount(
        subject: String,
        organization: String = "",
        afterSessionId: String? = null,
        limit: Int = 25,
    ): LegacyOaepBackfillPage {
        require(subject.isNotBlank()) { "oaep_migration_subject_required" }
        require(limit in 1..100) { "oaep_migration_page_limit_invalid" }
        val rows = database.dao().conversationMigrationPage(subject, afterSessionId, limit + 1)
        var migrated = 0
        var skipped = 0
        var diverged = 0
        var failed = 0
        rows.take(limit).forEach { conversation ->
            when (migrateSession(subject, organization, conversation)) {
                "COMPLETED" -> migrated += 1
                "SKIPPED" -> skipped += 1
                "DIVERGED" -> diverged += 1
                else -> failed += 1
            }
        }
        val selected = rows.take(limit)
        return LegacyOaepBackfillPage(
            migrated, skipped, diverged, failed, selected.lastOrNull()?.id, rows.size > limit,
        )
    }

    private suspend fun migrateSession(
        subject: String,
        organization: String,
        conversation: ConversationEntity,
    ): String {
        val dao = database.dao()
        val messages = dao.runtimeMessageSnapshot(conversation.id).sortedWith(compareBy<MessageEntity> { it.createdAt }.thenBy { it.id })
        val attachments = dao.attachmentSnapshot(conversation.id).sortedWith(compareBy<MessageAttachmentEntity> { it.createdAt }.thenBy { it.id })
        val artifacts = dao.allToolArtifacts(subject).filter { it.sessionId == conversation.id }
            .sortedWith(compareBy<ToolArtifactEntity> { it.createdAt }.thenBy { it.id })
        val workbenchEvents = database.workbenchDao().sessionEvents(subject, organization, conversation.id)
        val workbenchRuns = database.workbenchDao().sessionRuns(subject, organization, conversation.id)
        val digest = sourceDigest(conversation, messages, attachments, artifacts, workbenchEvents, workbenchRuns)
        val migrationDao = database.androidOaepDao()
        val existing = migrationDao.migration(subject, organization, RUNTIME_ID, conversation.id, VERSION)
        if (existing?.status == "COMPLETED") {
            if (existing.sourceDigest == digest) return "SKIPPED"
            migrationDao.saveMigration(existing.copy(status = "DIVERGED", updatedAt = now(), errorCode = "legacy_source_changed"))
            return "DIVERGED"
        }
        return try {
            database.withTransaction {
                migrationDao.saveMigration(AndroidOaepMigrationEntity(
                    subject, organization, RUNTIME_ID, WORKSPACE_ID, conversation.id, VERSION,
                    digest, "RUNNING", existing?.completedThrough, now(), null,
                ))
                val owner = AndroidOaepOwner(subject, organization)
                val runId = stableId("legacy-run", subject, conversation.id)
                val createdAt = iso(conversation.createdAt)
                val scope = AndroidOaepScope(
                    WORKSPACE_ID, conversation.id, runId, "android-agent", RUNTIME_ID,
                    conversation.title, runSequence = 1,
                )
                val store = RoomAndroidOaepStore(database)
                val restored = store.load(owner, scope, createdAt)
                val writer = AndroidOaepWriter(scope, restored?.session?.createdAt ?: createdAt, restored)
                messages.forEach { message ->
                    val related = attachments.filter { it.messageId == message.id }
                    val event = legacyMessage(message, related, scope)
                    store.commit(owner, scope, writer.apply("legacy:v$VERSION:message:${message.id}", event, iso(message.createdAt)))
                }
                artifacts.forEach { artifact ->
                    store.commit(owner, scope, writer.apply(
                        "legacy:v$VERSION:artifact:${artifact.id}",
                        NormalizedAgentEvent.ItemCompleted(
                            artifact.id, "artifact", OaepArtifactContent(
                                artifactId = artifact.id,
                                artifactType = "legacy_tool_artifact",
                                name = artifact.id,
                                summary = artifact.content.take(MAX_LEGACY_SUMMARY),
                            ),
                        ),
                        iso(artifact.createdAt),
                    ))
                }
                workbenchEvents.forEach { event ->
                    store.commit(owner, scope, writer.apply(
                        "legacy:v$VERSION:workbench:${event.runtimeId}:${event.eventId}",
                        NormalizedAgentEvent.ItemCompleted(
                            "workbench-event:${event.runtimeId}:${event.eventId}", "notice", OaepNoticeContent(
                                level = when {
                                    event.kind.endsWith("failed") || event.kind.endsWith("error") -> "error"
                                    event.kind.contains("paused") || event.kind.contains("cancelled") -> "warning"
                                    else -> "info"
                                },
                                code = "legacy_workbench_event",
                                message = event.kind,
                                details = mapOf(
                                    "legacy_runtime_id" to event.runtimeId,
                                    "legacy_run_id" to event.runId,
                                    "legacy_sequence" to event.sequence,
                                    "payload_version" to event.payloadVersion,
                                    "payload_digest" to sha256(event.payloadJson),
                                ),
                            ),
                        ),
                        event.timestamp,
                    ))
                }
                store.commit(owner, scope, writer.apply(
                    "legacy:v$VERSION:terminal", NormalizedAgentEvent.RunCompleted, iso(conversation.updatedAt),
                ))
                workbenchRuns.forEachIndexed { index, run ->
                    migrateWorkbenchRun(store, owner, conversation, run, index + 2)
                }
                val through = workbenchRuns.lastOrNull()?.runId ?: messages.lastOrNull()?.id ?: artifacts.lastOrNull()?.id
                migrationDao.saveMigration(AndroidOaepMigrationEntity(
                    subject, organization, RUNTIME_ID, WORKSPACE_ID, conversation.id, VERSION,
                    digest, "COMPLETED", through, now(), null,
                ))
            }
            "COMPLETED"
        } catch (error: Throwable) {
            migrationDao.saveMigration(AndroidOaepMigrationEntity(
                subject, organization, RUNTIME_ID, WORKSPACE_ID, conversation.id, VERSION,
                digest, "FAILED", existing?.completedThrough, now(),
                error.message.orEmpty().take(128).ifBlank { "oaep_backfill_failed" },
            ))
            "FAILED"
        }
    }

    private suspend fun migrateWorkbenchRun(
        store: RoomAndroidOaepStore,
        owner: AndroidOaepOwner,
        conversation: ConversationEntity,
        legacy: WorkbenchRunEntity,
        sequence: Int,
    ) {
        val runId = stableId("legacy-workbench-run", owner.subject, legacy.runtimeId, legacy.runId)
        val timestamp = iso(legacy.updatedAt)
        val scope = AndroidOaepScope(
            WORKSPACE_ID, conversation.id, runId, "android-agent", RUNTIME_ID,
            conversation.title, runSequence = sequence.toLong(),
        )
        val restored = store.load(owner, scope, timestamp)
        val writer = AndroidOaepWriter(scope, restored?.session?.createdAt ?: timestamp, restored)
        store.commit(owner, scope, writer.apply(
            "legacy:v$VERSION:workbench-run:${legacy.runtimeId}:${legacy.runId}:checkpoint",
            NormalizedAgentEvent.ItemCompleted(
                "workbench-run-checkpoint:${legacy.runtimeId}:${legacy.runId}", "notice", OaepNoticeContent(
                    level = if (legacy.status in setOf("FAILED", "CANCELLED")) "error" else "info",
                    code = "legacy_workbench_run_checkpoint",
                    message = "Legacy Workbench Run checkpoint",
                    details = mapOf(
                        "legacy_runtime_id" to legacy.runtimeId,
                        "legacy_run_id" to legacy.runId,
                        "legacy_status" to legacy.status,
                        "legacy_sequence" to legacy.lastSequence,
                    ),
                ),
            ),
            timestamp,
        ))
        val terminal = when (legacy.status) {
            "COMPLETED" -> NormalizedAgentEvent.RunCompleted
            "FAILED" -> NormalizedAgentEvent.RunFailed(OaepError(
                "legacy_run_failed", "Legacy Run was already failed", false,
                mapOf("failure_code_digest" to legacy.failureCode?.let(::sha256)?.take(16)),
            ))
            "CANCELLED" -> NormalizedAgentEvent.RunCancelled
            else -> null
        }
        if (terminal != null) {
            store.commit(owner, scope, writer.apply(
                "legacy:v$VERSION:workbench-run:${legacy.runtimeId}:${legacy.runId}:terminal", terminal, timestamp,
            ))
            return
        }
        store.commit(owner, scope, writer.applyAll(
            "legacy:v$VERSION:workbench-run:${legacy.runtimeId}:${legacy.runId}:reconciliation",
            listOf(
                NormalizedAgentEvent.RunStarted,
                NormalizedAgentEvent.ItemCreated(
                    "workbench-run-reconciliation:${legacy.runtimeId}:${legacy.runId}", "interaction",
                    OaepInteractionContent(
                        interactionType = "reconciliation",
                        prompt = "Confirm the outcome of the migrated Android Agent Run",
                        options = listOf(
                            mapOf("id" to "resume", "label" to "Resume safely"),
                            mapOf("id" to "fail", "label" to "Mark failed"),
                        ),
                        requestSummary = mapOf(
                            "legacy_status" to legacy.status,
                            "legacy_sequence" to legacy.lastSequence,
                        ),
                    ),
                    status = "waiting",
                ),
                NormalizedAgentEvent.RunWaiting("legacy_migration_reconciliation", null),
            ),
            timestamp,
        ))
    }

    private fun legacyMessage(
        message: MessageEntity,
        attachments: List<MessageAttachmentEntity>,
        scope: AndroidOaepScope,
    ): NormalizedAgentEvent {
        if (message.role !in setOf("user", "assistant", "system")) {
            return NormalizedAgentEvent.ItemCompleted(
                message.id, "notice", OaepNoticeContent(
                    "warning", "legacy_message_role_unknown", "Legacy record could not be represented as a Message",
                    details = mapOf("legacy_role_digest" to sha256(message.role).take(16)),
                ),
            )
        }
        val resources = attachments.map { attachment ->
            OaepResourceRef(
                workspaceId = scope.workspaceId,
                resourceType = "artifact",
                resourceId = attachment.id,
                label = attachment.name,
                digest = attachment.sha256.lowercase().takeIf { it.matches(SHA256) },
            )
        }
        val parts = listOfNotNull(message.content.takeIf(String::isNotEmpty)?.let { mapOf("type" to "text", "text" to it) }) +
            attachments.zip(resources).map { (attachment, resource) ->
                mapOf(
                    "type" to when {
                        attachment.kind == "image" || attachment.mimeType.startsWith("image/") -> "image"
                        attachment.kind == "audio" || attachment.mimeType.startsWith("audio/") -> "audio"
                        else -> "file"
                    },
                    "name" to attachment.name,
                    "mime_type" to attachment.mimeType,
                    "resource_ref" to mapOf(
                        "protocol" to resource.protocol,
                        "workspace_id" to resource.workspaceId,
                        "resource_type" to resource.resourceType,
                        "resource_id" to resource.resourceId,
                        "label" to resource.label,
                        "digest" to resource.digest,
                    ).filterValues { it != null },
                )
            }
        return NormalizedAgentEvent.ItemCompleted(
            message.id, "message", OaepMessageContent(
                message.role, message.content, message.status, parts = parts, resourceRefs = resources,
            ),
        )
    }

    private fun sourceDigest(
        conversation: ConversationEntity,
        messages: List<MessageEntity>,
        attachments: List<MessageAttachmentEntity>,
        artifacts: List<ToolArtifactEntity>,
        workbenchEvents: List<WorkbenchEventEntity>,
        workbenchRuns: List<WorkbenchRunEntity>,
    ): String = sha256(buildString {
        append(conversation.id).append('\u0000').append(conversation.title).append('\u0000')
        append(conversation.createdAt).append('\u0000').append(conversation.updatedAt).append('\n')
        messages.forEach { append(it.id).append('\u0000').append(it.role).append('\u0000').append(it.status)
            .append('\u0000').append(it.createdAt).append('\u0000').append(it.content).append('\n') }
        attachments.forEach { append(it.id).append('\u0000').append(it.messageId).append('\u0000').append(it.name)
            .append('\u0000').append(it.mimeType).append('\u0000').append(it.size).append('\u0000').append(it.sha256).append('\n') }
        artifacts.forEach { append(it.id).append('\u0000').append(it.runId).append('\u0000').append(it.toolCallId)
            .append('\u0000').append(it.content).append('\u0000').append(it.createdAt).append('\n') }
        workbenchEvents.forEach { append(it.runtimeId).append('\u0000').append(it.runId).append('\u0000').append(it.eventId)
            .append('\u0000').append(it.sequence).append('\u0000').append(it.timestamp).append('\u0000').append(it.kind)
            .append('\u0000').append(it.payloadVersion).append('\u0000').append(it.payloadJson).append('\n') }
        workbenchRuns.forEach { append(it.runtimeId).append('\u0000').append(it.runId).append('\u0000').append(it.status)
            .append('\u0000').append(it.lastSequence).append('\u0000').append(it.idempotencyKey).append('\u0000').append(it.input)
            .append('\u0000').append(it.skillVersionsJson).append('\u0000').append(it.completedSideEffectsJson)
            .append('\u0000').append(it.pythonStateJson).append('\u0000').append(it.failureCode).append('\u0000').append(it.updatedAt).append('\n') }
    })

    private fun stableId(prefix: String, vararg values: String) = "$prefix-${sha256(values.joinToString("\u0000")).take(32)}"
    private fun sha256(value: String) = MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray())
        .joinToString("") { "%02x".format(it) }
    private fun iso(value: Long) = Instant.ofEpochMilli(value.coerceAtLeast(0)).toString()

    companion object {
        const val VERSION = 1
        const val RUNTIME_ID = "android-local"
        const val WORKSPACE_ID = "local"
        private const val MAX_LEGACY_SUMMARY = 4_000
        private val SHA256 = Regex("^[a-f0-9]{64}$")
    }
}
