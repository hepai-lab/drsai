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
    ) : OaepTimelineEntry
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
)

data class OaepSourceLink(val label: String, val url: String)

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

fun projectOaepPresentation(snapshot: OaepSnapshot): List<OaepTimelineEntry> {
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
                        if (content.phase == "commentary") process += OaepProcessItem(item.id, "progress", "进度", sanitizeRemoteTranscriptText(content.text), item.status)
                        else results += OaepResultItem(
                            item.id, "markdown", text = sanitizeRemoteTranscriptText(content.text), status = item.status,
                            sources = content.citations.toSourceLinks(),
                        )
                    }
                    is OaepReasoningContent -> process += OaepProcessItem(item.id, "reasoning", "思考过程", content.segments.joinToString("\n") { it["text"].orEmpty() }.let(::sanitizeRemoteTranscriptText), item.status)
                    is OaepPlanContent -> process += OaepProcessItem(item.id, "plan", "计划", sanitizeRemoteTranscriptText(content.text), item.status)
                    is OaepCommandExecutionContent -> process += OaepProcessItem(item.id, "command", "命令", sanitizeRemoteTranscriptText(content.output.ifBlank { content.stdoutTail.orEmpty() }), item.status, sanitizeRemoteTranscriptText(content.displayCommand))
                    is OaepToolCallContent -> process += OaepProcessItem(
                        item.id, "tool", toolPresentationTitle(content.toolName, item.status),
                        safePresentationResult(content.result, item.status), item.status,
                        detail = content.server?.let { "MCP · $it" } ?: content.toolName,
                        executionLocation = toolExecutionLocation(content, item.source),
                        sources = toolSourceLinks(content),
                    )
                    is OaepFileChangeContent -> process += OaepProcessItem(item.id, "file", "文件修改", sanitizeRemoteTranscriptText(content.summary), item.status)
                    is OaepSubtaskContent -> process += OaepProcessItem(
                        item.id, "subtask", if (item.status in setOf("pending", "running")) "正在委派 · ${content.title.ifBlank { "子任务" }}" else content.title.ifBlank { "子任务" },
                        sanitizeRemoteTranscriptText(content.summary), item.status, content.agentName,
                        executionLocation = content.agentName?.let { "Subagent · $it" } ?: "Android Agent Runtime",
                    )
                    is OaepNoticeContent -> process += OaepProcessItem(item.id, "notice", content.code.ifBlank { "通知" }, sanitizeRemoteTranscriptText(content.message), item.status, content.level)
                    is OaepInteractionContent -> interactions += OaepInteractionItem(item.id, content.interactionType.ifBlank { "需要操作" }, sanitizeRemoteTranscriptText(content.prompt), item.status)
                    is OaepArtifactContent -> results += OaepResultItem(item.id, "artifact", content.name.ifBlank { "产物" }, sanitizeRemoteTranscriptText(content.summary), item.status)
                }
            }
            if (process.isNotEmpty() || interactions.isNotEmpty() || results.isNotEmpty() || run.status in setOf("queued", "running", "waiting", "failed")) {
                add(OaepTimelineEntry.AssistantTurn("run:${run.id}", run.id, run.status, run.createdAt, run.completedAt, process, interactions, results))
            }
        }
    }
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

private fun toolPresentationTitle(name: String, status: String): String {
    val active = status in setOf("pending", "running", "waiting")
    return when (name) {
        "web.search" -> if (active) "正在搜索网页" else "网页搜索"
        "web.fetch" -> if (active) "正在读取网页" else "网页读取"
        "delegate" -> if (active) "正在委派" else "委派"
        else -> if (active) "正在调用 · ${name.ifBlank { "工具" }}" else name.ifBlank { "工具" }
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
    url.toSafeSourceLink((citation["title"] as? String).orEmpty())
}.distinctBy(OaepSourceLink::url)

private fun toolSourceLinks(content: OaepToolCallContent): List<OaepSourceLink> = buildList {
    fun collect(value: Any?) {
        when (value) {
            is Map<*, *> -> {
                val url = listOf("url", "final_url", "requested_url").firstNotNullOfOrNull { value[it] as? String }
                url?.toSafeSourceLink((value["title"] as? String).orEmpty())?.let(::add)
                value.values.forEach(::collect)
            }
            is Iterable<*> -> value.forEach(::collect)
        }
    }
    collect(content.result)
    if (content.toolName == "web.fetch") collect(content.arguments)
}.distinctBy(OaepSourceLink::url).take(8)

private fun String.toSafeSourceLink(title: String): OaepSourceLink? {
    val normalized = trim()
    if (!normalized.startsWith("https://") && !normalized.startsWith("http://")) return null
    return OaepSourceLink(title.trim().ifBlank { normalized }, normalized)
}
