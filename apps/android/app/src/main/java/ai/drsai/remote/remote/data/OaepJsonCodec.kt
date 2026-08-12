package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.*
import org.json.JSONArray
import org.json.JSONObject

/** Strict OAEP envelope decoder. Legacy Session Event shapes fail closed. */
object OaepJsonCodec {
    fun sessionJson(value: OaepSession): JSONObject = JSONObject()
        .put("id", value.id).put("workspace_id", value.workspaceId)
        .putOpt("title", value.title).put("status", value.status)
        .putOpt("backend", value.backend).put("created_at", value.createdAt)
        .put("updated_at", value.updatedAt)

    fun snapshotJson(value: OaepSnapshot): JSONObject = JSONObject()
        .put("version", value.version)
        .put("session", sessionJson(value.session))
        .put("runs", JSONArray(value.runs.map(::runJson)))
        .put("items", JSONArray(value.items.map(::itemJson)))
        .put("snapshot_sequence", value.snapshotSequence)

    fun eventPageJson(value: OaepEventPage): JSONObject = JSONObject()
        .put("version", value.version)
        .put("object", value.objectType)
        .put("data", JSONArray(value.data.map(::eventJson)))
        .put("next_sequence", value.nextSequence)
        .put("has_more", value.hasMore)

    fun runJson(value: OaepRun): JSONObject = JSONObject()
        .put("id", value.id).put("session_id", value.sessionId)
        .putOpt("parent_run_id", value.parentRunId).putOpt("sequence", value.sequence)
        .putOpt("source", value.source?.let(::sourceJson))
        .put("status", value.status).put("created_at", value.createdAt)
        .put("updated_at", value.updatedAt).putOpt("completed_at", value.completedAt)

    fun itemJson(value: OaepItem): JSONObject = JSONObject()
        .put("id", value.id).put("session_id", value.sessionId).put("run_id", value.runId)
        .put("type", value.type).put("status", value.status).put("sequence", value.sequence)
        .put("created_at", value.createdAt).put("updated_at", value.updatedAt)
        .put("source", sourceJson(value.source)).put("content", contentJsonObject(value.content))

    fun eventJson(value: OaepEvent): JSONObject = JSONObject()
        .put("version", value.version).put("event_id", value.eventId)
        .put("session_id", value.sessionId).putOpt("run_id", value.runId)
        .putOpt("item_id", value.itemId).put("sequence", value.sequence)
        .put("type", value.type).put("timestamp", value.timestamp)
        .put("dedupe_key", value.dedupeKey).put("source", sourceJson(value.source))
        .put("data", JSONObject(value.data.extra).apply {
            value.data.item?.let { put("item", itemJson(it)) }
            value.data.delta?.let { put("delta", JSONObject().put("kind", it.kind)
                .putOpt("text", it.text).putOpt("segment_id", it.segmentId).putOpt("stream", it.stream)
                .putOpt("reasoning_kind", it.reasoningKind).putOpt("visibility", it.visibility)
                .putOpt("reasoning_source", it.reasoningSource)) }
            value.data.error?.let { put("error", errorJson(it)) }
        })

    fun contentJson(value: OaepItemContent): String = contentJsonObject(value).toString()

    fun snapshot(root: JSONObject): OaepSnapshot {
        require(root.getString("version") == OaepContract.VERSION) { "oaep_version_invalid" }
        val session = root.getJSONObject("session")
        return OaepSnapshot(
            version = root.getString("version"),
            session = OaepSession(
                id = session.required("id"),
                workspaceId = session.required("workspace_id"),
                title = session.stringOrNull("title"),
                status = session.required("status"),
                backend = session.stringOrNull("backend"),
                createdAt = session.required("created_at"),
                updatedAt = session.required("updated_at"),
            ),
            runs = root.objects("runs").map(::run),
            items = root.objects("items").map(::item),
            snapshotSequence = root.getLong("snapshot_sequence").also {
                require(it >= 0) { "oaep_snapshot_sequence_invalid" }
            },
            checkpoint = root.optJSONObject("checkpoint")?.let { checkpoint ->
                OaepSnapshotCheckpoint(
                    checkpoint.getLong("sequence"), checkpoint.required("snapshot_hash"),
                    checkpoint.getLong("item_count"),
                )
            },
            window = root.optJSONObject("window")?.let { window ->
                OaepSnapshotWindow(
                    window.getInt("limit"), window.getBoolean("has_more"),
                    window.stringOrNull("next_cursor"),
                )
            },
        ).also { snapshot ->
            validateSnapshot(snapshot)
            OaepProjectionIntegrity.verifyCompleteSnapshot(snapshot)
        }
    }

    fun session(root: JSONObject) = OaepSession(
        id = root.required("id"), workspaceId = root.required("workspace_id"),
        title = root.stringOrNull("title"), status = root.required("status"),
        backend = root.stringOrNull("backend"), createdAt = root.required("created_at"),
        updatedAt = root.required("updated_at"),
    )

    fun eventPage(root: JSONObject): OaepEventPage {
        require(root.getString("version") == OaepContract.VERSION) { "oaep_version_invalid" }
        require(root.getString("object") == "list") { "oaep_page_object_invalid" }
        val events = root.objects("data").map(::event)
        val next = root.getLong("next_sequence")
        require(events.zipWithNext().all { (left, right) -> left.sequence < right.sequence }) {
            "oaep_event_sequence_invalid"
        }
        require(events.isEmpty() || events.last().sequence == next) { "oaep_next_sequence_invalid" }
        return OaepEventPage(
            version = root.getString("version"),
            objectType = "list",
            data = events,
            nextSequence = next,
            hasMore = root.getBoolean("has_more"),
        )
    }

    fun event(root: JSONObject): OaepEvent {
        require(root.getString("version") == OaepContract.VERSION) { "oaep_version_invalid" }
        val type = root.required("type")
        val data = root.getJSONObject("data")
        val decoded = OaepEvent(
            version = root.getString("version"),
            eventId = root.required("event_id"),
            sessionId = root.required("session_id"),
            runId = root.stringOrNull("run_id"),
            itemId = root.stringOrNull("item_id"),
            sequence = root.getLong("sequence").also { require(it > 0) },
            type = type,
            timestamp = root.required("timestamp"),
            dedupeKey = root.required("dedupe_key"),
            source = source(root.getJSONObject("source")),
            data = OaepEventData(
                item = data.objectOrNull("item")?.let(::item),
                delta = data.objectOrNull("delta")?.let(::delta),
                error = data.objectOrNull("error")?.let(::error),
                extra = data.toMap().filterKeys { it !in setOf("item", "delta", "error") },
            ),
        )
        require(decoded.sessionId.isNotBlank())
        if (type.startsWith("event.item.")) {
            require(!decoded.runId.isNullOrBlank() && !decoded.itemId.isNullOrBlank()) {
                "oaep_item_event_scope_invalid"
            }
        }
        require((type == "event.item.delta") == (decoded.data.delta != null)) {
            "oaep_delta_shape_invalid"
        }
        if (type in setOf("event.item.completed", "event.item.failed")) {
            require(decoded.data.item != null) { "oaep_terminal_item_required" }
        }
        decoded.data.item?.let { item ->
            require(item.id == decoded.itemId && item.sessionId == decoded.sessionId &&
                item.runId == decoded.runId) { "oaep_event_item_scope_invalid" }
        }
        return decoded
    }

    fun item(root: JSONObject): OaepItem {
        val wireType = root.required("type")
        val type = wireType.takeIf { it in OaepContract.ITEM_TYPES } ?: "notice"
        val status = root.required("status")
        require(status in OaepContract.ITEM_STATUSES) { "oaep_item_status_invalid" }
        val content = root.getJSONObject("content")
        return OaepItem(
            id = root.required("id"),
            sessionId = root.required("session_id"),
            runId = root.required("run_id"),
            type = type,
            status = status,
            sequence = root.getLong("sequence").also { require(it > 0) },
            createdAt = root.required("created_at"),
            updatedAt = root.required("updated_at"),
            source = source(root.getJSONObject("source")),
            content = if (wireType == type) content(type, content) else OaepNoticeContent(
                level = "warning",
                code = "unsupported_oaep_item_type",
                message = "This client cannot render a newer OAEP Item type.",
                details = mapOf("wire_type" to wireType),
            ),
        )
    }

    private fun validateSnapshot(snapshot: OaepSnapshot) {
        require(snapshot.session.id.isNotBlank())
        snapshot.checkpoint?.let { checkpoint ->
            require(checkpoint.sequence == snapshot.snapshotSequence) {
                "oaep_snapshot_checkpoint_sequence_mismatch"
            }
            require(checkpoint.snapshotHash.matches(Regex("[0-9a-f]{64}"))) {
                "oaep_snapshot_checkpoint_hash_invalid"
            }
            require(checkpoint.itemCount >= snapshot.items.size) {
                "oaep_snapshot_checkpoint_count_invalid"
            }
        }
        snapshot.window?.let { window ->
            require(window.limit in 1..500) { "oaep_snapshot_window_limit_invalid" }
            require(window.hasMore == !window.nextCursor.isNullOrBlank()) {
                "oaep_snapshot_window_cursor_invalid"
            }
            require(snapshot.checkpoint != null) { "oaep_snapshot_window_checkpoint_missing" }
        }
        require(snapshot.runs.all { it.sessionId == snapshot.session.id }) {
            "oaep_snapshot_run_scope_mismatch"
        }
        require(snapshot.items.all { it.sessionId == snapshot.session.id }) {
            "oaep_snapshot_item_scope_mismatch"
        }
        val runs = snapshot.runs.map { it.id }.toSet()
        require(snapshot.items.all { it.runId in runs }) { "oaep_snapshot_item_run_missing" }
        require(snapshot.items.groupBy { it.runId }.values.all { values ->
            values.map { it.sequence }.let { it == it.sorted() && it.size == it.toSet().size }
        }) { "oaep_item_sequence_invalid" }
    }

    fun run(root: JSONObject) = OaepRun(
        id = root.required("id"),
        sessionId = root.required("session_id"),
        parentRunId = root.stringOrNull("parent_run_id"),
        sequence = root.longOrNull("sequence"),
        source = root.objectOrNull("source")?.let(::source),
        status = root.required("status"),
        createdAt = root.required("created_at"),
        updatedAt = root.required("updated_at"),
        completedAt = root.stringOrNull("completed_at"),
    )

    private fun source(root: JSONObject) = OaepSource(
        backend = root.required("backend"),
        backendItemId = root.stringOrNull("backend_item_id"),
        backendEventId = root.stringOrNull("backend_event_id"),
        client = root.stringOrNull("client"),
        messageId = root.stringOrNull("message_id"),
        runtimeId = root.stringOrNull("runtime_id"),
        backendVersion = root.stringOrNull("backend_version"),
        adapter = root.stringOrNull("adapter"),
        adapterVersion = root.stringOrNull("adapter_version"),
        mappingVersion = root.stringOrNull("mapping_version"),
        backendRunId = root.stringOrNull("backend_run_id"),
        backendRunIndex = root.longOrNull("backend_run_index"),
    )

    private fun delta(root: JSONObject) = OaepDelta(
        kind = root.required("kind"),
        text = root.stringOrNull("text"),
        segmentId = root.stringOrNull("segment_id"),
        stream = root.stringOrNull("stream"),
        reasoningKind = root.stringOrNull("reasoning_kind"),
        visibility = root.stringOrNull("visibility"),
        reasoningSource = root.stringOrNull("reasoning_source"),
    )

    private fun error(root: JSONObject) = OaepError(
        code = root.required("code"),
        message = root.required("message"),
        retryable = root.getBoolean("retryable"),
        details = root.objectOrNull("details")?.toMap().orEmpty(),
    )

    private fun content(type: String, root: JSONObject): OaepItemContent {
        val operation = root.objectOrNull("operation_ref")?.let(::operationRef)
        val resources = root.objectsOrEmpty("resource_refs").map(::resourceRef)
        return when (type) {
            "message" -> OaepMessageContent(
                role = root.required("role"),
                text = root.getString("text"),
                phase = root.stringOrNull("phase"),
                citations = root.objectsOrEmpty("citations").map { it.toMap() },
                parts = root.objectsOrEmpty("parts").map { it.toMap() },
                operationRef = operation,
                resourceRefs = resources,
            )
            "reasoning" -> OaepReasoningContent(root.objects("segments").map { segment ->
                buildMap {
                    put("id", segment.required("id")); put("text", segment.getString("text"))
                    segment.stringOrNull("kind")?.let { put("kind", it) }
                    segment.stringOrNull("visibility")?.let { put("visibility", it) }
                    segment.stringOrNull("source")?.let { put("source", it) }
                }
            }, operation, resources)
            "plan" -> OaepPlanContent(root.getString("text"), root.objects("steps").map { it.toMap() },
                root.stringOrNull("explanation"), operation, resources)
            "command_execution" -> OaepCommandExecutionContent(
                root.getJSONArray("command").strings(), root.getString("display_command"),
                root.getString("cwd"), root.getString("output"), root.stringOrNull("stdout_tail"),
                root.stringOrNull("stderr_tail"), root.intOrNull("exit_code"),
                root.doubleOrNull("duration_ms"),
                root.objectOrNull("replay_policy")?.toMap().orEmpty(), operation, resources,
            )
            "tool_call" -> OaepToolCallContent(
                root.required("tool_kind"), root.required("tool_name"), root.required("call_id"),
                root.getJSONObject("arguments").toMap(), root.opt("result").nullValue().jsonValue(),
                root.stringOrNull("server"), root.doubleOrNull("duration_ms"),
                root.objectOrNull("replay_policy")?.toMap().orEmpty(), operation, resources,
            )
            "file_change" -> OaepFileChangeContent(
                root.objects("changes").map { it.toMap() }, root.getString("summary"), operation, resources,
            )
            "artifact" -> OaepArtifactContent(
                root.required("artifact_id"), root.required("artifact_type"), root.required("name"),
                root.getString("summary"), root.stringOrNull("path"), root.stringOrNull("mime_type"),
                root.longOrNull("size"), root.stringOrNull("sha256"), root.optBoolean("previewable", false),
                root.optBoolean("downloadable", false), operation, resources,
            )
            "interaction" -> OaepInteractionContent(
                root.required("interaction_type"), root.getString("prompt"),
                root.objects("options").map { it.toMap() }, root.stringOrNull("approval_id"),
                root.stringOrNull("operation"), root.objectOrNull("request_summary")?.toMap().orEmpty(),
                root.stringOrNull("related_item_id"), root.opt("response").nullValue(),
                root.stringOrNull("deadline_at"), operation, resources,
            )
            "subtask" -> OaepSubtaskContent(
                root.required("title"), root.getString("summary"), root.stringOrNull("agent_name"),
                root.stringOrNull("child_run_id"), root.opt("result").nullValue(), operation, resources,
            )
            "notice" -> OaepNoticeContent(
                root.required("level"), root.required("code"), root.getString("message"),
                root.objectOrNull("error")?.let(::error), root.objectOrNull("details")?.toMap().orEmpty(),
                operation, resources,
            )
            else -> error("oaep_item_type_invalid")
        }
    }

    private fun operationRef(root: JSONObject) = OaepOperationRef(
        protocol = root.required("protocol").also { require(it == "owop/1") },
        operationId = root.required("operation_id"), workspaceId = root.required("workspace_id"),
        operation = root.required("operation"), correlationId = root.required("correlation_id"),
    )

    private fun resourceRef(root: JSONObject) = OaepResourceRef(
        protocol = root.required("protocol").also { require(it == "owop/1") },
        workspaceId = root.required("workspace_id"), resourceType = root.required("resource_type"),
        resourceId = root.required("resource_id"), operationId = root.stringOrNull("operation_id"),
        label = root.stringOrNull("label"), digest = root.stringOrNull("digest"),
    )

    fun sourceJson(value: OaepSource) = JSONObject()
        .put("backend", value.backend).putOpt("backend_item_id", value.backendItemId)
        .putOpt("backend_event_id", value.backendEventId).putOpt("client", value.client)
        .putOpt("message_id", value.messageId).putOpt("runtime_id", value.runtimeId)
        .putOpt("backend_version", value.backendVersion).putOpt("adapter", value.adapter)
        .putOpt("adapter_version", value.adapterVersion).putOpt("mapping_version", value.mappingVersion)
        .putOpt("backend_run_id", value.backendRunId).putOpt("backend_run_index", value.backendRunIndex)

    private fun errorJson(value: OaepError) = JSONObject()
        .put("code", value.code).put("message", value.message)
        .put("retryable", value.retryable).put("details", JSONObject(value.details))

    private fun operationJson(value: OaepOperationRef?) = value?.let {
        JSONObject().put("protocol", it.protocol).put("operation_id", it.operationId)
            .put("workspace_id", it.workspaceId).put("operation", it.operation)
            .put("correlation_id", it.correlationId)
    }

    private fun resourcesJson(values: List<OaepResourceRef>) = JSONArray(values.map {
        JSONObject().put("protocol", it.protocol).put("workspace_id", it.workspaceId)
            .put("resource_type", it.resourceType).put("resource_id", it.resourceId)
            .putOpt("operation_id", it.operationId).putOpt("label", it.label).putOpt("digest", it.digest)
    })

    private fun contentJsonObject(value: OaepItemContent): JSONObject {
        val root = when (value) {
            is OaepMessageContent -> JSONObject().put("role", value.role).put("text", value.text)
                .putOpt("phase", value.phase).put("citations", JSONArray(value.citations))
                .put("parts", JSONArray(value.parts))
            is OaepReasoningContent -> JSONObject().put("segments", JSONArray(value.segments))
            is OaepPlanContent -> JSONObject().put("text", value.text).put("steps", JSONArray(value.steps))
                .putOpt("explanation", value.explanation)
            is OaepCommandExecutionContent -> JSONObject().put("command", JSONArray(value.command))
                .put("display_command", value.displayCommand).put("cwd", value.cwd).put("output", value.output)
                .putOpt("stdout_tail", value.stdoutTail).putOpt("stderr_tail", value.stderrTail)
                .putOpt("exit_code", value.exitCode).putOpt("duration_ms", value.durationMs)
                .put("replay_policy", JSONObject(value.replayPolicy))
            is OaepToolCallContent -> JSONObject().put("tool_kind", value.toolKind)
                .put("tool_name", value.toolName).put("call_id", value.callId)
                .put("arguments", JSONObject(value.arguments)).put("result", jsonWireValue(value.result))
                .putOpt("server", value.server).putOpt("duration_ms", value.durationMs)
                .put("replay_policy", JSONObject(value.replayPolicy))
            is OaepFileChangeContent -> JSONObject().put("changes", JSONArray(value.changes))
                .put("summary", value.summary)
            is OaepArtifactContent -> JSONObject().put("artifact_id", value.artifactId)
                .put("artifact_type", value.artifactType).put("name", value.name).put("summary", value.summary)
                .putOpt("path", value.path).putOpt("mime_type", value.mimeType).putOpt("size", value.size)
                .putOpt("sha256", value.sha256).put("previewable", value.previewable)
                .put("downloadable", value.downloadable)
            is OaepInteractionContent -> JSONObject().put("interaction_type", value.interactionType)
                .put("prompt", value.prompt).put("options", JSONArray(value.options))
                .putOpt("approval_id", value.approvalId).putOpt("operation", value.operation)
                .put("request_summary", JSONObject(value.requestSummary))
                .putOpt("related_item_id", value.relatedItemId).putOpt("response", jsonWireValue(value.response))
                .putOpt("deadline_at", value.deadlineAt)
            is OaepSubtaskContent -> JSONObject().put("title", value.title).put("summary", value.summary)
                .putOpt("agent_name", value.agentName).putOpt("child_run_id", value.childRunId)
                .putOpt("result", jsonWireValue(value.result))
            is OaepNoticeContent -> JSONObject().put("level", value.level).put("code", value.code)
                .put("message", value.message).putOpt("error", value.error?.let(::errorJson))
                .put("details", JSONObject(value.details))
        }
        value.operationRef?.let { root.put("operation_ref", operationJson(it)) }
        if (value.resourceRefs.isNotEmpty()) root.put("resource_refs", resourcesJson(value.resourceRefs))
        return root
    }
}

private fun jsonWireValue(value: Any?): Any? = when (value) {
    null -> null
    is JSONObject, is JSONArray, is String, is Number, is Boolean -> value
    is Map<*, *> -> JSONObject(value.entries.associate { (key, nested) -> key.toString() to jsonWireValue(nested) })
    is Iterable<*> -> JSONArray(value.map(::jsonWireValue))
    is Array<*> -> JSONArray(value.map(::jsonWireValue))
    else -> value.toString()
}

private fun JSONObject.required(name: String): String = getString(name).also {
    require(it.isNotBlank()) { "oaep_${name}_required" }
}
    private fun JSONObject.stringOrNull(name: String): String? =
    if (!has(name) || isNull(name)) null else getString(name)
private fun JSONObject.objectOrNull(name: String): JSONObject? =
    if (!has(name) || isNull(name)) null else getJSONObject(name)
private fun JSONObject.objects(name: String): List<JSONObject> = getJSONArray(name).objects()
private fun JSONObject.objectsOrEmpty(name: String): List<JSONObject> =
    if (!has(name) || isNull(name)) emptyList() else getJSONArray(name).objects()
private fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }
private fun JSONArray.strings(): List<String> = List(length()) { getString(it) }
private fun JSONObject.intOrNull(name: String): Int? = if (!has(name) || isNull(name)) null else getInt(name)
private fun JSONObject.longOrNull(name: String): Long? = if (!has(name) || isNull(name)) null else getLong(name)
private fun JSONObject.doubleOrNull(name: String): Double? = if (!has(name) || isNull(name)) null else getDouble(name)
private fun Any?.nullValue(): Any? = if (this == JSONObject.NULL) null else this
private fun Any?.jsonValue(): Any? = when (this) {
    null, JSONObject.NULL -> null
    is JSONObject -> toMap()
    is JSONArray -> List(length()) { index -> get(index).jsonValue() }
    else -> this
}
private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key ->
    get(key).jsonValue()
}
