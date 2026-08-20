package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.ChatMessage
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.OaepDiagnosticEventUi
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepLegacyMessagePart
import ai.drsai.remote.remote.data.OaepJsonCodec
import ai.drsai.remote.remote.model.RemoteTranscriptMessage
import ai.drsai.remote.remote.model.projectOaepMessages
import ai.drsai.remote.remote.model.OaepTimelineEntry
import ai.drsai.remote.remote.model.projectOaepPresentation
import ai.drsai.remote.workbench.model.RuntimeAuthority
import java.time.Instant

/** OAEP-authoritative adapter for the old Android conversation/chat response shape. */
class LocalOaepLegacyProjection(
    private val database: ChatDatabase,
    private val auditor: LegacyOaepShadowAuditor = LegacyOaepShadowAuditor(database),
    private val presentationStrings: ai.drsai.remote.remote.model.OaepPresentationStrings =
        ai.drsai.remote.remote.model.EnglishOaepPresentationStrings,
    private val runtimeStatusStrings: LegacyRuntimeStatusStrings = EnglishLegacyRuntimeStatusStrings,
) {
    data class UiProjection(
        val entries: List<RemoteTranscriptMessage>,
        val timeline: List<OaepTimelineEntry>,
        val runStatus: String?,
        val activeRunId: String?,
        val snapshotSequence: Long,
        val diagnosticEvents: List<OaepDiagnosticEventUi>,
        val waitingReason: String?,
        val runtimeStatus: String?,
        val errorMessage: String?,
        val recovering: Boolean,
    )

    /**
     * Returns null until the shadow audit approves cutover. It never combines OAEP and Legacy rows.
     */
    suspend fun messages(subject: String, organization: String, sessionId: String): List<ChatMessage>? {
        val legacy = database.dao().conversationSnapshot(subject).singleOrNull { it.id == sessionId }
            ?: return null
        return messages(subject, organization, legacy)
    }

    suspend fun messages(
        subject: String,
        organization: String,
        legacy: ConversationEntity,
    ): List<ChatMessage>? {
        val migration = database.androidOaepDao().migration(
            subject, organization, LegacyOaepBackfill.RUNTIME_ID, legacy.id, LegacyOaepBackfill.VERSION,
        )
        if (migration != null && !auditor.auditSession(subject, organization, legacy.id).readyForCutover) return null
        val runtimeId = if (migration != null || legacy.agentSource != "platform") "android-local" else "hai-platform"
        val workspaceId = if (runtimeId == "android-local") "local" else "platform"
        val snapshot = RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner(subject, organization), runtimeId, workspaceId, legacy.id,
        ) ?: return null
        return messages(snapshot, legacy.id)
    }

    suspend fun conversation(
        subject: String,
        organization: String,
        legacy: ConversationEntity,
    ): Conversation? {
        val migration = database.androidOaepDao().migration(
            subject, organization, LegacyOaepBackfill.RUNTIME_ID, legacy.id, LegacyOaepBackfill.VERSION,
        )
        if (migration != null && !auditor.auditSession(subject, organization, legacy.id).readyForCutover) return null
        val runtimeId = if (migration != null || legacy.agentSource != "platform") "android-local" else "hai-platform"
        val workspaceId = if (runtimeId == "android-local") "local" else "platform"
        val snapshot = RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner(subject, organization), runtimeId, workspaceId, legacy.id,
        ) ?: return null
        return Conversation(
            id = snapshot.session.id,
            title = snapshot.session.title ?: legacy.title,
            updatedAt = instantMillis(snapshot.session.updatedAt),
            agentId = legacy.agentId,
            agentName = legacy.agentName,
            agentSource = legacy.agentSource,
            modelId = legacy.modelId,
        )
    }

    suspend fun uiProjection(
        subject: String,
        organization: String,
        legacy: ConversationEntity,
    ): UiProjection? {
        val authority = authoritativeSnapshot(subject, organization, legacy) ?: return null
        val snapshot = authority.snapshot
        val latest = snapshot.runs.sortedWith(
            compareBy<ai.drsai.remote.remote.generated.OaepRun> { it.sequence ?: Long.MAX_VALUE }
                .thenBy { it.createdAt }.thenBy { it.id },
        ).lastOrNull()
        val latestEvents = database.androidOaepDao().events(
            subject, organization, authority.runtimeId, legacy.id,
        ).asSequence()
            .filter { it.runId == latest?.id }
            .map { OaepJsonCodec.event(org.json.JSONObject(it.eventJson)) }
            .toList()
        val lastEvent = latestEvents.lastOrNull()
        val waitingReason = latestEvents.lastOrNull { it.type == "event.run.waiting" }
            ?.data?.extra?.get("reason") as? String
        val recovering = latest?.status == "running" && lastEvent?.type == "event.run.resumed" &&
            waitingReason !in setOf("approval", "side_effect_reconciliation", "legacy_migration_reconciliation")
        val errorMessage = latestEvents.lastOrNull { it.type == "event.run.failed" }?.data?.error?.message
        val runtimeStatus = when (latest?.status) {
            "queued" -> runtimeStatusStrings.text(LegacyRuntimeStatusText.QUEUED)
            "running" -> if (recovering) runtimeStatusStrings.text(LegacyRuntimeStatusText.RECOVERING) else null
            "waiting" -> when (waitingReason) {
                "approval" -> runtimeStatusStrings.text(LegacyRuntimeStatusText.WAITING_APPROVAL)
                "side_effect_reconciliation", "legacy_migration_reconciliation" -> runtimeStatusStrings.text(LegacyRuntimeStatusText.RECONCILING)
                else -> runtimeStatusStrings.text(LegacyRuntimeStatusText.PAUSED)
            }
            "failed" -> runtimeStatusStrings.text(LegacyRuntimeStatusText.FAILED)
            "cancelled" -> runtimeStatusStrings.text(LegacyRuntimeStatusText.CANCELLED)
            else -> null
        }
        return UiProjection(
            entries = projectOaepMessages(snapshot),
            timeline = projectOaepPresentation(snapshot, presentationStrings),
            runStatus = latest?.status,
            activeRunId = latest?.id,
            snapshotSequence = snapshot.snapshotSequence,
            diagnosticEvents = latestEvents.map { event ->
                OaepDiagnosticEventUi(
                    eventId = event.eventId,
                    sequence = event.sequence,
                    type = event.type,
                    timestamp = event.timestamp,
                    runId = event.runId,
                    itemId = event.itemId,
                    source = event.source.backend,
                    errorCode = event.data.error?.code,
                    errorMessage = event.data.error?.message,
                )
            },
            waitingReason = waitingReason,
            runtimeStatus = runtimeStatus,
            errorMessage = errorMessage,
            recovering = recovering,
        )
    }

    private data class AuthoritySnapshot(
        val runtimeId: String,
        val snapshot: ai.drsai.remote.remote.generated.OaepSnapshot,
    )

    private suspend fun authoritativeSnapshot(
        subject: String,
        organization: String,
        legacy: ConversationEntity,
    ): AuthoritySnapshot? {
        val migration = database.androidOaepDao().migration(
            subject, organization, LegacyOaepBackfill.RUNTIME_ID, legacy.id, LegacyOaepBackfill.VERSION,
        )
        if (migration != null && !auditor.auditSession(subject, organization, legacy.id).readyForCutover) return null
        val runtimeId = if (migration != null || legacy.agentSource != "platform") "android-local" else "hai-platform"
        val workspaceId = if (runtimeId == "android-local") "local" else "platform"
        val snapshot = RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner(subject, organization), runtimeId, workspaceId, legacy.id,
        ) ?: return null
        return AuthoritySnapshot(runtimeId, snapshot)
    }

    suspend fun assistantText(
        subject: String,
        organization: String,
        authority: RuntimeAuthority,
        sessionId: String,
        backendItemId: String,
    ): String? {
        val runtimeId = if (authority == RuntimeAuthority.LOCAL_DEVICE) "android-local" else "hai-platform"
        val workspaceId = if (authority == RuntimeAuthority.LOCAL_DEVICE) "local" else "platform"
        val snapshot = RoomAndroidOaepStore(database).snapshot(
            AndroidOaepOwner(subject, organization), runtimeId, workspaceId, sessionId,
        ) ?: return null
        return (snapshot.items.lastOrNull {
            it.type == "message" && it.source.backendItemId == backendItemId
        }?.content as? OaepMessageContent)?.text
    }

    private fun messages(
        snapshot: ai.drsai.remote.remote.generated.OaepSnapshot,
        sessionId: String,
    ): List<ChatMessage> {
        return snapshot.items.asSequence()
            .filter { it.type == "message" }
            .sortedWith(compareBy({ it.createdAt }, { it.sequence }, { it.id }))
            .map { item ->
                val content = item.content as OaepMessageContent
                val messageId = item.source.backendItemId ?: item.id
                val partsByResource = content.parts.mapNotNull { part ->
                    val legacy = part as? OaepLegacyMessagePart ?: return@mapNotNull null
                    legacy.resourceRef?.resourceId?.let { it to legacy }
                }.toMap()
                ChatMessage(
                    id = messageId,
                    conversationId = sessionId,
                    role = content.role,
                    text = content.text,
                    createdAt = instantMillis(item.createdAt),
                    status = content.phase ?: when (item.status) {
                        "completed" -> "complete"
                        else -> item.status
                    },
                    attachments = content.resourceRefs.map { ref ->
                        val part = partsByResource[ref.resourceId]
                        MessageAttachment(
                            id = ref.resourceId,
                            messageId = messageId,
                            conversationId = sessionId,
                            name = part?.name ?: ref.label ?: ref.resourceId,
                            mimeType = part?.mimeType ?: "application/octet-stream",
                            size = 0,
                            kind = part?.type ?: "file",
                            sha256 = ref.digest.orEmpty(),
                            status = "sent",
                            createdAt = instantMillis(item.createdAt),
                        )
                    },
                )
            }.toList()
    }

    private fun instantMillis(value: String): Long = runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(0)
}
