package ai.drsai.remote.runtime.oaep

import ai.drsai.remote.remote.generated.OaepDelta
import ai.drsai.remote.remote.generated.OaepEvent
import ai.drsai.remote.remote.generated.OaepEventData
import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepMessageContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.remote.generated.OaepReasoningContent
import ai.drsai.remote.remote.generated.OaepPlanContent
import ai.drsai.remote.remote.generated.OaepCommandExecutionContent
import ai.drsai.remote.remote.generated.OaepRun
import ai.drsai.remote.remote.generated.OaepSession
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.generated.OaepSource
import ai.drsai.remote.remote.generated.OaepSubtaskContent
import ai.drsai.remote.remote.data.OaepJsonCodec

data class AndroidOaepScope(
    val workspaceId: String,
    val sessionId: String,
    val runId: String,
    val backend: String,
    val runtimeId: String,
    val sessionTitle: String? = null,
    val runSequence: Long? = null,
    val sourceRuntimeId: String = runtimeId,
) {
    val androidRuntimeScopeId = AndroidRuntimeScopeId.of(runtimeId)
    val oaepSourceRuntimeId = OaepRuntimeId.of(sourceRuntimeId)

    init {
        require(workspaceId.isNotBlank()) { "oaep_workspace_id_required" }
        require(sessionId.isNotBlank()) { "oaep_session_id_required" }
        require(runId.isNotBlank()) { "oaep_run_id_required" }
        require(backend.isNotBlank()) { "oaep_backend_required" }
        require(runtimeId.isNotBlank()) { "oaep_runtime_id_required" }
        require(sourceRuntimeId.isNotBlank()) { "oaep_source_runtime_id_required" }
        require(runSequence == null || runSequence > 0) { "oaep_run_sequence_invalid" }
    }
}

data class AndroidOaepWriterState(
    val session: OaepSession,
    val run: OaepRun,
    val items: Map<String, OaepItem> = emptyMap(),
    val itemBindings: Map<BackendItemId, OaepItemId> = emptyMap(),
    val itemRevisions: Map<String, Long> = emptyMap(),
    val events: List<OaepEvent> = emptyList(),
    val acceptedDedupeKeys: Set<String> = emptySet(),
    val lastSequence: Long = 0,
) {
    init {
        require(lastSequence >= 0) { "oaep_writer_sequence_invalid" }
        require(events.zipWithNext().all { (left, right) -> left.sequence < right.sequence }) {
            "oaep_writer_event_order_invalid"
        }
        require(events.lastOrNull()?.sequence == lastSequence || events.isEmpty() && lastSequence == 0L) {
            "oaep_writer_watermark_invalid"
        }
        require(items.values.all { it.sessionId == session.id && it.runId == run.id }) {
            "oaep_writer_item_scope_invalid"
        }
    }

    fun snapshot() = OaepSnapshot("1.0", session, listOf(run), items.values
        .sortedWith(compareBy<OaepItem> { it.sequence }.thenBy { it.id }), lastSequence)
}

data class AndroidOaepWriteResult(
    val state: AndroidOaepWriterState,
    val appended: List<OaepEvent>,
    val duplicate: Boolean = false,
)

/**
 * Pure OAEP state transition engine. Production Room persistence wraps one
 * [apply] result in a single transaction: appended Event rows, Run/Item
 * projection, bindings, revisions and the Session watermark commit together.
 */
class AndroidOaepWriter(
    private val scope: AndroidOaepScope,
    createdAt: String,
    initialState: AndroidOaepWriterState? = null,
) {
    private val source = OaepSource(
        backend = scope.backend,
        client = "android",
        runtimeId = scope.oaepSourceRuntimeId.value,
        adapter = "android-agent-runtime",
        adapterVersion = "1",
        mappingVersion = "oaep-1",
    )

    var state = initialState ?: AndroidOaepWriterState(
        session = OaepSession(
            scope.sessionId, scope.workspaceId, scope.sessionTitle, "active", scope.backend,
            createdAt, createdAt,
        ),
        run = OaepRun(
            scope.runId, scope.sessionId, null, scope.runSequence, source,
            "queued", createdAt, createdAt, null,
        ),
    )
        private set

    @Synchronized
    fun applyAll(
        dedupeKey: String,
        events: List<NormalizedAgentEvent>,
        timestamp: String,
    ): AndroidOaepWriteResult {
        require(events.isNotEmpty()) { "oaep_event_batch_empty" }
        val before = state
        val appended = mutableListOf<OaepEvent>()
        return try {
            events.forEachIndexed { index, event ->
                val result = apply("$dedupeKey:$index", event, timestamp)
                if (result.duplicate) {
                    require(index == 0) { "oaep_event_batch_partially_applied" }
                    state = before
                    return AndroidOaepWriteResult(before, emptyList(), duplicate = true)
                }
                appended += result.appended
            }
            AndroidOaepWriteResult(state, appended)
        } catch (error: Throwable) {
            state = before
            throw error
        }
    }

    @Synchronized
    fun apply(dedupeKey: String, event: NormalizedAgentEvent, timestamp: String): AndroidOaepWriteResult {
        require(dedupeKey.isNotBlank()) { "oaep_dedupe_key_required" }
        require(timestamp.isNotBlank()) { "oaep_timestamp_required" }
        if (dedupeKey in state.acceptedDedupeKeys) {
            return AndroidOaepWriteResult(state, emptyList(), duplicate = true)
        }
        if (event is NormalizedAgentEvent.ItemCompleted) {
            val current = state.itemBindings[BackendItemId.of(event.itemId)]?.value?.let(state.items::get)
            if (current?.type == "interaction" && current.status in setOf("completed", "failed", "cancelled")) {
                return AndroidOaepWriteResult(state, emptyList(), duplicate = true)
            }
        }
        if (event is NormalizedAgentEvent.RunStarted && state.run.status == "running") {
            return AndroidOaepWriteResult(state, emptyList(), duplicate = true)
        }
        require(state.run.status !in setOf("completed", "failed", "cancelled")) {
            "oaep_run_terminal"
        }

        val appended = mutableListOf<OaepEvent>()
        fun append(
            type: String,
            itemId: String? = null,
            data: OaepEventData = OaepEventData(),
            runScoped: Boolean = true,
        ) {
            val sequence = state.lastSequence + appended.size + 1
            appended += OaepEvent(
                version = "1.0",
                eventId = "${scope.runId}:event:$sequence",
                sessionId = scope.sessionId,
                runId = scope.runId.takeIf { runScoped },
                itemId = itemId,
                sequence = sequence,
                type = type,
                timestamp = timestamp,
                dedupeKey = if (appended.isEmpty()) dedupeKey else "$dedupeKey:${appended.size}",
                source = source,
                data = data,
            )
        }

        var nextRun = state.run
        var nextItems = state.items
        var nextBindings = state.itemBindings
        var nextRevisions = state.itemRevisions

        fun resolveItem(backendItemId: BackendItemId): Pair<OaepItemId, Long> {
            val existing = nextBindings[backendItemId]
            if (existing != null) return existing to nextItems.getValue(existing.value).sequence
            val itemSequence = (nextItems.values.maxOfOrNull(OaepItem::sequence) ?: 0L) + 1
            val itemId = OaepItemId.of("${scope.runId}:item:$itemSequence")
            nextBindings = nextBindings + (backendItemId to itemId)
            return itemId to itemSequence
        }

        fun itemSource(backendItemId: BackendItemId) = source.copy(backendItemId = backendItemId.value)

        fun upsert(
            backendItemId: String,
            itemType: String,
            status: String,
            content: ai.drsai.remote.remote.generated.OaepItemContent,
        ): OaepItem {
            val typedBackendItemId = BackendItemId.of(backendItemId)
            val (typedItemId, itemSequence) = resolveItem(typedBackendItemId)
            val itemId = typedItemId.value
            val current = nextItems[itemId]
            require(current == null || current.type == itemType) { "oaep_item_type_changed" }
            require(current?.status !in setOf("completed", "failed", "cancelled")) { "oaep_item_terminal" }
            val item = OaepItem(
                itemId, scope.sessionId, scope.runId, itemType, status, itemSequence,
                current?.createdAt ?: timestamp, timestamp, itemSource(typedBackendItemId), content,
            )
            nextItems = nextItems + (itemId to item)
            nextRevisions = nextRevisions + (itemId to ((nextRevisions[itemId] ?: 0) + 1))
            return item
        }

        if (state.events.none { it.type == "event.session.created" } &&
            appended.none { it.type == "event.session.created" }
        ) {
            append(
                "event.session.created",
                data = OaepEventData(extra = mapOf("session" to OaepJsonCodec.sessionJson(state.session))),
                runScoped = false,
            )
        }

        if (state.run.status == "queued" && state.events.none { it.type == "event.run.created" && it.runId == scope.runId } &&
            event !is NormalizedAgentEvent.RunStarted
        ) {
            append("event.run.created", data = OaepEventData(extra = mapOf(
                "run" to OaepJsonCodec.runJson(nextRun),
            )))
        }

        when (event) {
            NormalizedAgentEvent.RunStarted -> {
                if (state.events.none { it.type == "event.run.created" && it.runId == scope.runId } &&
                    appended.none { it.type == "event.run.created" && it.runId == scope.runId }
                ) {
                    append("event.run.created", data = OaepEventData(extra = mapOf(
                        "run" to OaepJsonCodec.runJson(nextRun),
                    )))
                }
                nextRun = nextRun.copy(status = "running", updatedAt = timestamp)
                append("event.run.started")
            }
            is NormalizedAgentEvent.RunWaiting -> {
                nextRun = nextRun.copy(status = "waiting", updatedAt = timestamp)
                append("event.run.waiting", data = OaepEventData(extra = mapOf(
                    "reason" to event.reason, "interaction_item_id" to event.interactionItemId,
                )))
            }
            NormalizedAgentEvent.RunResumed -> {
                require(nextRun.status == "waiting") { "oaep_run_not_waiting" }
                nextRun = nextRun.copy(status = "running", updatedAt = timestamp)
                append("event.run.resumed")
            }
            NormalizedAgentEvent.RunCompleted -> {
                nextItems.values.filter { it.status in setOf("pending", "running", "waiting") }.forEach { current ->
                    val completed = current.copy(status = "completed", updatedAt = timestamp)
                    nextItems = nextItems + (completed.id to completed)
                    nextRevisions = nextRevisions + (completed.id to ((nextRevisions[completed.id] ?: 0) + 1))
                    append("event.item.completed", completed.id, OaepEventData(item = completed))
                }
                nextRun = nextRun.copy(status = "completed", updatedAt = timestamp, completedAt = timestamp)
                append("event.run.completed")
            }
            is NormalizedAgentEvent.RunFailed -> {
                nextItems.values.filter { it.status in setOf("pending", "running", "waiting") }.forEach { current ->
                    val failed = current.copy(status = "failed", updatedAt = timestamp)
                    nextItems = nextItems + (failed.id to failed)
                    nextRevisions = nextRevisions + (failed.id to ((nextRevisions[failed.id] ?: 0) + 1))
                    append("event.item.failed", failed.id, OaepEventData(item = failed, error = event.error))
                }
                nextRun = nextRun.copy(status = "failed", updatedAt = timestamp, completedAt = timestamp)
                append("event.run.failed", data = OaepEventData(error = event.error))
            }
            NormalizedAgentEvent.RunCancelled -> {
                nextItems.values.filter { it.status in setOf("pending", "running", "waiting") }.forEach { current ->
                    val cancelled = current.copy(status = "cancelled", updatedAt = timestamp)
                    nextItems = nextItems + (cancelled.id to cancelled)
                    nextRevisions = nextRevisions + (cancelled.id to ((nextRevisions[cancelled.id] ?: 0) + 1))
                    append("event.item.cancelled", cancelled.id, OaepEventData(item = cancelled))
                }
                nextRun = nextRun.copy(status = "cancelled", updatedAt = timestamp, completedAt = timestamp)
                append("event.run.cancelled")
            }
            is NormalizedAgentEvent.ItemCreated -> {
                require(event.status in setOf("pending", "waiting")) { "oaep_item_created_status_invalid" }
                val item = upsert(event.itemId, event.itemType, event.status, event.content)
                append("event.item.created", item.id, OaepEventData(item = item))
            }
            is NormalizedAgentEvent.ItemStarted -> {
                val item = upsert(event.itemId, event.itemType, "running", event.content)
                append("event.item.started", item.id, OaepEventData(item = item))
            }
            is NormalizedAgentEvent.ItemDelta -> {
                var current = nextBindings[BackendItemId.of(event.itemId)]?.value?.let(nextItems::get)
                if (current == null) {
                    val inferredType = event.itemType ?: when (event.kind) {
                        "summary" -> "subtask"
                        "reasoning" -> "reasoning"
                        "plan" -> "plan"
                        "stdout", "stderr", "combined" -> "command_execution"
                        else -> "message"
                    }
                    val initialContent = when (inferredType) {
                        "subtask" -> OaepSubtaskContent("Subtask", "")
                        "reasoning" -> OaepReasoningContent(emptyList())
                        "plan" -> OaepPlanContent("", emptyList())
                        "command_execution" -> OaepCommandExecutionContent(emptyList(), "", ".", "")
                        else -> OaepMessageContent("assistant", "", "final")
                    }
                    current = upsert(
                        event.itemId,
                        inferredType,
                        "running",
                        initialContent,
                    )
                    append("event.item.started", current.id, OaepEventData(item = current))
                }
                val updatedContent = when (val content = current.content) {
                    is OaepMessageContent -> content.copy(text = content.text + event.text)
                    is OaepSubtaskContent -> content.copy(summary = content.summary + event.text)
                    is OaepReasoningContent -> content.copy(
                        segments = content.segments + mapOf(
                            "id" to "${current.id}:segment:${nextRevisions[current.id] ?: 0}",
                            "text" to event.text,
                        ),
                    )
                    is OaepPlanContent -> content.copy(text = content.text + event.text)
                    is OaepCommandExecutionContent -> content.copy(
                        output = content.output + event.text,
                        stdoutTail = if (event.kind == "stdout") content.stdoutTail.orEmpty() + event.text else content.stdoutTail,
                        stderrTail = if (event.kind == "stderr") content.stderrTail.orEmpty() + event.text else content.stderrTail,
                    )
                    else -> content
                }
                val updated = current.copy(updatedAt = timestamp, content = updatedContent)
                nextItems = nextItems + (updated.id to updated)
                nextRevisions = nextRevisions + (updated.id to ((nextRevisions[updated.id] ?: 0) + 1))
                append(
                    "event.item.delta", updated.id,
                    OaepEventData(delta = OaepDelta(event.kind, text = event.text)),
                )
            }
            is NormalizedAgentEvent.ItemUpdated -> {
                val item = upsert(event.itemId, event.itemType, event.status, event.content)
                append("event.item.updated", item.id, OaepEventData(item = item))
            }
            is NormalizedAgentEvent.ItemCompleted -> {
                val item = upsert(event.itemId, event.itemType, "completed", event.content)
                append("event.item.completed", item.id, OaepEventData(item = item))
            }
            is NormalizedAgentEvent.ItemFailed -> {
                val item = upsert(event.itemId, event.itemType, "failed", event.content)
                append("event.item.failed", item.id, OaepEventData(item = item, error = event.error))
            }
            is NormalizedAgentEvent.ItemCancelled -> {
                val item = upsert(event.itemId, event.itemType, "cancelled", event.content)
                append("event.item.cancelled", item.id, OaepEventData(item = item))
            }
        }

        val nextEvents = state.events + appended
        state = state.copy(
            session = state.session.copy(updatedAt = timestamp),
            run = nextRun,
            items = nextItems,
            itemBindings = nextBindings,
            itemRevisions = nextRevisions,
            events = nextEvents,
            acceptedDedupeKeys = state.acceptedDedupeKeys + dedupeKey,
            lastSequence = nextEvents.lastOrNull()?.sequence ?: state.lastSequence,
        )
        return AndroidOaepWriteResult(state, appended)
    }
}
