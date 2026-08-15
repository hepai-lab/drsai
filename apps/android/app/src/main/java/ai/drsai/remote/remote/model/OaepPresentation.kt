package ai.drsai.remote.remote.model

import ai.drsai.remote.remote.generated.*

/** Stable presentation contract between OAEP and Compose. Protocol items must not be rendered directly. */
sealed interface OaepTimelineEntry { val stableId: String

    data class UserMessage(
        override val stableId: String,
        val text: String,
        val resources: List<RemoteTranscriptResource> = emptyList(),
    ) : OaepTimelineEntry

    data class AssistantTurn(
        override val stableId: String,
        val runId: String,
        val status: String,
        val startedAt: String,
        val completedAt: String?,
        val process: List<OaepProcessItem>,
        val interactions: List<OaepInteractionItem>,
        val results: List<OaepResultItem>,
        val outcome: UserRunOutcome = UserRunOutcome.derive(status, process),
    ) : OaepTimelineEntry
}

enum class UserRunOutcome(val terminal: Boolean, val recoverable: Boolean = false) {
    QUEUED(false),
    RUNNING(false),
    RECOVERABLE(false, true),
    COMPLETED(true),
    PARTIAL(true),
    FAILED(true),
    CANCELLED(true),
    PROCESSING(false);

    companion object {
        fun derive(runStatus: String, process: List<OaepProcessItem>): UserRunOutcome = when (runStatus) {
            "queued" -> QUEUED
            "running" -> RUNNING
            "waiting", "paused", "recovering" -> RECOVERABLE
            "completed" -> if (process.any { it.status == "failed" || it.taskProgress?.partialFailure == true }) PARTIAL else COMPLETED
            "failed" -> FAILED
            "cancelled" -> CANCELLED
            else -> PROCESSING
        }
    }
}

data class OaepProcessItem(
    val id: String,
    val kind: String,
    val title: String,
    val text: String,
    val status: String,
    val detail: String? = null,
    val executionLocation: String? = null,
    val sources: List<OaepSourceLink> = emptyList(),
    val stage: UserTaskStage = UserTaskStage.PROCESSING,
    val purpose: String? = null,
    val inputSummary: String? = null,
    val durationMs: Double? = null,
    val advancedDetail: String? = detail,
    val taskProgress: OaepTaskProgress? = null,
    val operationOutcome: ai.drsai.remote.runtime.security.ToolOperationOutcome? = null,
)

data class OaepTaskStep(val title: String, val status: String)

data class OaepTaskProgress(val goal: String, val steps: List<OaepTaskStep>) {
    val completed: Int get() = steps.count { it.status == "completed" }
    val running: Int get() = steps.count { it.status == "running" }
    val waiting: Int get() = steps.count { it.status in setOf("pending", "waiting") }
    val failed: Int get() = steps.count { it.status == "failed" }
    val partialFailure: Boolean get() = failed > 0 && completed > 0
}

enum class UserTaskStage {
    UNDERSTANDING,
    PLANNING,
    SEARCHING,
    READING,
    USING_LOCAL_FILES,
    DELEGATING,
    PRODUCING_RESULT,
    PROCESSING,
}

enum class OaepSourceType { WEB, LOCAL_DOCUMENT, ARTIFACT }

data class OaepSourceLink(
    val label: String,
    val url: String?,
    val type: OaepSourceType = OaepSourceType.WEB,
    val verified: Boolean = false,
)

data class OaepInteractionItem(
    val id: String,
    val title: String,
    val prompt: String,
    val status: String,
)

data class OaepResultItem(
    val id: String,
    val kind: String,
    val title: String? = null,
    val text: String,
    val status: String,
    val sources: List<OaepSourceLink> = emptyList(),
)

fun projectOaepPresentation(
    snapshot: OaepSnapshot,
    strings: OaepPresentationStrings = EnglishOaepPresentationStrings,
): List<OaepTimelineEntry> {
    val runs = snapshot.runs.sortedWith(
        compareBy<OaepRun> { it.sequence ?: Long.MAX_VALUE }.thenBy { it.createdAt }.thenBy { it.id },
    )
    val itemsByRun = snapshot.items.groupBy(OaepItem::runId)
    return buildList {
        runs.forEach { run ->
            val items = itemsByRun[run.id].orEmpty().sortedWith(compareBy<OaepItem> { it.sequence }.thenBy { it.id })
            items.filter { (it.content as? OaepMessageContent)?.role == "user" }.forEach { item ->
                val content = item.content as OaepMessageContent
                add(OaepTimelineEntry.UserMessage(item.id, sanitizeRemoteTranscriptText(content.text), content.toResources()))
            }
            val process = mutableListOf<OaepProcessItem>()
            val interactions = mutableListOf<OaepInteractionItem>()
            val results = mutableListOf<OaepResultItem>()
            items.filterNot { (it.content as? OaepMessageContent)?.role == "user" }.forEach { item ->
                when (val content = item.content) {
                    is OaepMessageContent -> if (content.role == "assistant") {
                        if (content.phase == "commentary") process += OaepProcessItem(
                            item.id, "progress", strings.text(OaepPresentationText.PROGRESS_TITLE), sanitizeRemoteTranscriptText(content.text), item.status,
                            stage = UserTaskStage.PROCESSING,
                        )
                        else results += OaepResultItem(
                            item.id, "markdown", text = sanitizeRemoteTranscriptText(content.text), status = item.status,
                            sources = (content.citations.toSourceLinks() + content.resourceRefs.map { ref ->
                                OaepSourceLink(ref.label ?: strings.text(OaepPresentationText.LOCAL_DOCUMENT), null, OaepSourceType.LOCAL_DOCUMENT, verified = true)
                            }).distinctBy(::sourceIdentity),
                        )
                    }
                    is OaepReasoningContent -> process += OaepProcessItem(item.id, "reasoning", strings.text(OaepPresentationText.REASONING_TITLE), strings.text(OaepPresentationText.REASONING_BODY), item.status, stage = UserTaskStage.UNDERSTANDING)
                    is OaepPlanContent -> process += OaepProcessItem(
                        item.id, "plan", strings.text(OaepPresentationText.PLAN_TITLE), "", item.status, stage = UserTaskStage.PLANNING,
                        purpose = strings.text(OaepPresentationText.PLAN_PURPOSE),
                        taskProgress = OaepTaskProgress(
                            sanitizeRemoteTranscriptText(content.text).ifBlank { strings.text(OaepPresentationText.CURRENT_TASK) },
                            content.steps.mapNotNull(::safeTaskStep),
                        ),
                    )
                    is OaepCommandExecutionContent -> process += OaepProcessItem(item.id, "command", strings.text(OaepPresentationText.COMMAND_TITLE), sanitizeRemoteTranscriptText(content.output.ifBlank { content.stdoutTail.orEmpty() }), item.status, sanitizeRemoteTranscriptText(content.displayCommand), stage = UserTaskStage.PROCESSING)
                    is OaepToolCallContent -> process += OaepProcessItem(
                        item.id, "tool", toolPresentationTitle(content.toolName, item.status, strings),
                        safePresentationResult(content.result, item.status), item.status,
                        detail = content.server?.let { "MCP · $it" } ?: content.toolName,
                        executionLocation = toolExecutionLocation(content, item.source),
                        sources = toolSourceLinks(content, strings),
                        stage = toolTaskStage(content.toolName),
                        purpose = toolPurpose(content.toolName, strings),
                        inputSummary = safeInputSummary(content.arguments, strings),
                        durationMs = content.durationMs,
                        operationOutcome = ai.drsai.remote.runtime.security.ToolOperationOutcomePolicy.present(content.toolName, item.status, content.result, strings.toolOutcomeStrings()),
                    )
                    is OaepFileChangeContent -> process += OaepProcessItem(item.id, "file", strings.text(OaepPresentationText.FILE_TITLE), sanitizeRemoteTranscriptText(content.summary), item.status, stage = UserTaskStage.USING_LOCAL_FILES)
                    is OaepSubtaskContent -> process += OaepProcessItem(
                        item.id, "subtask", if (item.status in setOf("pending", "running")) strings.text(OaepPresentationText.DELEGATING_TITLE, content.title.ifBlank { strings.text(OaepPresentationText.SUBTASK) }) else content.title.ifBlank { strings.text(OaepPresentationText.SUBTASK) },
                        sanitizeRemoteTranscriptText(content.summary), item.status, content.agentName,
                        executionLocation = content.agentName?.let { "Subagent · $it" } ?: "Android Agent Runtime",
                        stage = UserTaskStage.DELEGATING,
                        taskProgress = OaepTaskProgress(
                            content.title.ifBlank { strings.text(OaepPresentationText.SUBTASK) },
                            listOf(OaepTaskStep(content.title.ifBlank { strings.text(OaepPresentationText.SUBTASK) }, item.status)),
                        ),
                    )
                    is OaepNoticeContent -> process += OaepProcessItem(
                        item.id, "notice", strings.text(OaepPresentationText.PROCESSING), sanitizeRemoteTranscriptText(content.message), item.status,
                        detail = null,
                        stage = UserTaskStage.PROCESSING,
                        advancedDetail = "${content.level.ifBlank { "info" }} · ${content.code.ifBlank { "unknown_event" }}",
                    )
                    is OaepInteractionContent -> interactions += OaepInteractionItem(item.id, content.interactionType.ifBlank { strings.text(OaepPresentationText.ACTION_REQUIRED) }, sanitizeRemoteTranscriptText(content.prompt), item.status)
                    is OaepArtifactContent -> results += OaepResultItem(
                        item.id, "artifact", content.name.ifBlank { strings.text(OaepPresentationText.ARTIFACT) }, sanitizeRemoteTranscriptText(content.summary), item.status,
                        sources = listOf(OaepSourceLink(content.name.ifBlank { strings.text(OaepPresentationText.ARTIFACT) }, null, OaepSourceType.ARTIFACT, verified = item.status == "completed")),
                    )
                }
            }
            if (process.isNotEmpty() || interactions.isNotEmpty() || results.isNotEmpty() || run.status in setOf("queued", "running", "waiting", "failed")) {
                add(OaepTimelineEntry.AssistantTurn("run:${run.id}", run.id, run.status, run.createdAt, run.completedAt, process, interactions, results))
            }
        }
    }
}

private fun toolTaskStage(name: String): UserTaskStage = when (name) {
    "web.search" -> UserTaskStage.SEARCHING
    "web.fetch" -> UserTaskStage.READING
    "delegate" -> UserTaskStage.DELEGATING
    else -> if (name.startsWith("workspace.")) UserTaskStage.USING_LOCAL_FILES else UserTaskStage.PROCESSING
}

private fun toolPurpose(name: String, strings: OaepPresentationStrings): String = when (name) {
    "web.search" -> strings.text(OaepPresentationText.SEARCH_PURPOSE)
    "web.fetch" -> strings.text(OaepPresentationText.FETCH_PURPOSE)
    "delegate" -> strings.text(OaepPresentationText.DELEGATE_PURPOSE)
    else -> if (name.startsWith("workspace.")) strings.text(OaepPresentationText.WORKSPACE_PURPOSE) else strings.text(OaepPresentationText.STEP_PURPOSE)
}

private fun safeInputSummary(arguments: Map<String, Any?>, strings: OaepPresentationStrings): String? {
    if (arguments.isEmpty()) return null
    val safeKeys = listOf("query", "url", "path", "name", "operation")
    val values = safeKeys.mapNotNull { key -> arguments[key]?.toString()?.takeIf(String::isNotBlank)?.let { "$key=${it.take(120)}" } }
    return values.takeIf(List<String>::isNotEmpty)?.joinToString(" · ")?.let(::sanitizeRemoteTranscriptText)
        ?: strings.text(OaepPresentationText.INPUT_PROVIDED)
}

private fun safeTaskStep(value: Map<String, Any?>): OaepTaskStep? {
    val title = sanitizeRemoteTranscriptText((value["title"] ?: value["text"] ?: value["id"] ?: return null).toString()).take(160)
    if (title.isBlank()) return null
    val status = value["status"]?.toString()?.lowercase().orEmpty().let {
        if (it in setOf("pending", "running", "waiting", "completed", "failed", "cancelled")) it else "pending"
    }
    return OaepTaskStep(title, status)
}

private fun OaepMessageContent.toResources(): List<RemoteTranscriptResource> = resourceRefs.map { ref ->
    val part = parts.firstOrNull { ((it["resource_ref"] as? Map<*, *>)?.get("resource_id") as? String) == ref.resourceId }
    RemoteTranscriptResource(ref.resourceId, ref.label ?: (part?.get("name") as? String) ?: ref.resourceId, (part?.get("type") as? String) ?: ref.resourceType, (part?.get("mime_type") as? String) ?: "application/octet-stream", (part?.get("size") as? Number)?.toLong(), ref.digest)
}

private fun safePresentationResult(result: Any?, status: String): String = when (result) {
    null -> status
    is String -> sanitizeRemoteTranscriptText(result)
    is Number, is Boolean -> result.toString()
    is Map<*, *> -> sanitizeRemoteTranscriptText((result["summary"] ?: result["message"] ?: result["status"] ?: status).toString())
    else -> status
}

private fun toolPresentationTitle(name: String, status: String, strings: OaepPresentationStrings): String {
    val template = strings.toolTemplate(name)
    return when (status) {
        "pending", "running", "waiting" -> template.runningTemplate
        "failed", "cancelled" -> template.failureTemplate
        else -> template.successTemplate
    }
}

private fun toolExecutionLocation(content: OaepToolCallContent, source: OaepSource): String = when {
    content.server != null -> "Android Agent Runtime → MCP · ${content.server}"
    content.toolKind == "core" -> "Android Agent Runtime · Shared Core"
    content.toolKind == "host" -> "Android Agent Runtime · Android Host"
    source.runtimeId != null -> "Remote Runtime · ${source.runtimeId}"
    else -> source.backend.ifBlank { "Agent Runtime" }
}

private fun List<Map<String, Any?>>.toSourceLinks(): List<OaepSourceLink> = mapNotNull { citation ->
    val url = citation["url"] as? String ?: return@mapNotNull null
    url.toSafeSourceLink((citation["title"] as? String).orEmpty(), verified = false)
}.distinctBy(::sourceIdentity)

private fun toolSourceLinks(
    content: OaepToolCallContent,
    strings: OaepPresentationStrings = EnglishOaepPresentationStrings,
): List<OaepSourceLink> = buildList {
    fun collect(value: Any?) {
        when (value) {
            is Map<*, *> -> {
                val url = listOf("url", "final_url", "requested_url").firstNotNullOfOrNull { value[it] as? String }
                url?.toSafeSourceLink((value["title"] as? String).orEmpty(), verified = true)?.let(::add)
                value.values.forEach(::collect)
            }
            is Iterable<*> -> value.forEach(::collect)
        }
    }
    collect(content.result)
    if (content.toolName == "web.fetch") collect(content.arguments)
    if (content.toolName.startsWith("workspace.")) {
        val path = content.arguments["path"]?.toString()?.trim().orEmpty()
        if (path.isNotBlank()) add(OaepSourceLink(path.substringAfterLast('/').substringAfterLast('\\').ifBlank { strings.text(OaepPresentationText.LOCAL_DOCUMENT) }, null, OaepSourceType.LOCAL_DOCUMENT, verified = content.result != null))
    }
}.distinctBy(::sourceIdentity).take(8)

private fun String.toSafeSourceLink(title: String, verified: Boolean): OaepSourceLink? {
    val normalized = trim()
    val uri = runCatching { java.net.URI(normalized) }.getOrNull() ?: return null
    if (uri.scheme !in setOf("https", "http") || uri.host.isNullOrBlank() || uri.userInfo != null) return null
    return OaepSourceLink(title.trim().ifBlank { normalized }, uri.normalize().toASCIIString(), verified = verified)
}

private fun sourceIdentity(source: OaepSourceLink): String =
    "${source.type}:${source.url?.lowercase() ?: source.label.lowercase()}"
