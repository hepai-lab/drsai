package ai.drsai.remote.runtime.context

import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import java.security.MessageDigest

enum class PromptLayer(val priority: Int) {
    SYSTEM(0),
    AGENT(1),
    PROJECT(2),
    USER_PREFERENCE(3),
    SESSION(4),
}

data class PromptFragment(
    val layer: PromptLayer,
    val content: String,
    val source: String,
    val version: String? = null,
)

object ProjectInstructionVersion {
    fun digest(content: String): String = MessageDigest.getInstance("SHA-256")
        .digest(content.replace("\r\n", "\n").trim().encodeToByteArray())
        .joinToString("") { "%02x".format(it) }

    fun versions(values: List<PromptFragment>): Map<String, String> = values
        .filter { it.layer == PromptLayer.PROJECT }
        .associate { it.source to (it.version ?: digest(it.content)) }

    fun changed(previous: List<PromptFragment>, current: List<PromptFragment>): Set<String> =
        changed(versions(previous), versions(current))

    fun changed(previous: Map<String, String>, current: Map<String, String>): Set<String> {
        val before = previous
        val after = current
        return (before.keys + after.keys).filterTo(sortedSetOf()) { before[it] != after[it] }
    }
}

data class ContextMessage(
    val role: String,
    val content: String,
    val toolCallId: String? = null,
    val toolCalls: List<ContextToolCall> = emptyList(),
    val pinned: Boolean = false,
)

data class ContextToolCall(val id: String, val name: String, val arguments: String)

data class ContextBudget(
    val maxTokens: Int,
    val reservedResponseTokens: Int,
    val maxMessages: Int = 40,
) {
    init {
        require(maxTokens > 0) { "context_max_tokens_invalid" }
        require(reservedResponseTokens in 0 until maxTokens) { "response_reserve_invalid" }
        require(maxMessages > 0) { "context_message_limit_invalid" }
    }
    val inputTokens: Int get() = maxTokens - reservedResponseTokens
}

fun interface TokenEstimator {
    fun estimate(value: String): Int
}

object ConservativeTokenEstimator : TokenEstimator {
    override fun estimate(value: String): Int = if (value.isEmpty()) 0 else (value.length + 2) / 3
}

data class ContextAssembly(
    val messages: List<ContextMessage>,
    val estimatedTokens: Int,
    val omittedMessages: Int,
    val includedSources: List<String>,
)

data class BudgetedAttachmentContext(val content: String, val omittedChars: Int, val truncated: Boolean)

object AttachmentContextBudgeter {
    fun prepare(parts: List<String>, maxChars: Int = 12_000): BudgetedAttachmentContext {
        require(maxChars >= 256) { "attachment_context_budget_too_small" }
        val full = parts.filter(String::isNotBlank).joinToString("\n\n")
        if (full.length <= maxChars) return BudgetedAttachmentContext(full, 0, false)
        val omitted = full.length - maxChars
        val suffix = "\n\n[附件上下文已省略约 $omitted 字符；完整内容请通过原附件或结果 Artifact 查看]"
        val prefix = full.take((maxChars - suffix.length).coerceAtLeast(0))
        return BudgetedAttachmentContext((prefix + suffix).take(maxChars), full.length - prefix.length, true)
    }
}

data class ImageContextCandidate(val id: String, val name: String, val sizeBytes: Long)

data class BudgetedImageContext(
    val included: List<ImageContextCandidate>,
    val omitted: List<ImageContextCandidate>,
) {
    val referenceNotice: String? get() = omitted.takeIf { it.isNotEmpty() }?.joinToString(
        prefix = "[图片未内联到模型请求，仍可从原附件/Artifact 查看：",
        postfix = "]",
    ) { "${it.name} (${it.id})" }
}

/** Bounds Base64 expansion and heap pressure before image bytes enter a model request. */
object ImageContextBudgeter {
    fun select(
        candidates: List<ImageContextCandidate>,
        maxImages: Int = 4,
        maxSingleBytes: Long = 8L * 1024 * 1024,
        maxTotalBytes: Long = 12L * 1024 * 1024,
    ): BudgetedImageContext {
        require(maxImages > 0) { "image_count_budget_invalid" }
        require(maxSingleBytes > 0 && maxTotalBytes > 0) { "image_byte_budget_invalid" }
        val included = mutableListOf<ImageContextCandidate>()
        val omitted = mutableListOf<ImageContextCandidate>()
        var used = 0L
        candidates.forEach { candidate ->
            val valid = candidate.id.isNotBlank() && candidate.name.isNotBlank() && candidate.sizeBytes > 0
            val fits = valid && candidate.sizeBytes <= maxSingleBytes &&
                included.size < maxImages && candidate.sizeBytes <= maxTotalBytes - used
            if (fits) {
                included += candidate
                used += candidate.sizeBytes
            } else {
                omitted += candidate
            }
        }
        return BudgetedImageContext(included, omitted)
    }
}

class ContextAssembler(private val estimator: TokenEstimator = ConservativeTokenEstimator) {
    fun assemble(
        prompts: List<PromptFragment>,
        history: List<ContextMessage>,
        summary: ContextMessage? = null,
        attachmentContext: List<ContextMessage> = emptyList(),
        budget: ContextBudget,
    ): ContextAssembly {
        val orderedPrompts = prompts
            .filter { it.content.isNotBlank() }
            .sortedWith(compareBy(PromptFragment::layer, PromptFragment::source))
        require(orderedPrompts.any { it.layer == PromptLayer.SYSTEM }) { "system_prompt_required" }
        val system = ContextMessage(
            role = "system",
            content = orderedPrompts.joinToString("\n\n") {
                "[${it.layer.name}:${it.source}${it.version?.let { version -> "@$version" }.orEmpty()}]\n${it.content.trim()}"
            },
            pinned = true,
        )
        val mandatory = buildList {
            add(system)
            summary?.let { add(it.copy(pinned = true)) }
            addAll(attachmentContext.map { it.copy(content = SensitiveDataRedactor.redact(it.content), pinned = true) })
        }
        var used = mandatory.sumOf { estimator.estimate(it.content) }
        require(used <= budget.inputTokens) { "mandatory_context_exceeds_budget" }

        val selected = ArrayDeque<ContextMessage>()
        history.asReversed().forEach { message ->
            if (selected.size + mandatory.size >= budget.maxMessages) return@forEach
            val cost = estimator.estimate(message.content)
            if (used + cost <= budget.inputTokens) {
                selected.addFirst(message)
                used += cost
            }
        }
        // A leading tool result without its assistant tool call is invalid.
        while (selected.firstOrNull()?.role == "tool") selected.removeFirst()
        val messages = mandatory + selected
        return ContextAssembly(
            messages = messages,
            estimatedTokens = messages.sumOf { estimator.estimate(it.content) },
            omittedMessages = (history.size - selected.size).coerceAtLeast(0),
            includedSources = orderedPrompts.map(PromptFragment::source),
        )
    }
}

data class MemoryPrivacyPolicy(
    val enabled: Boolean = true,
    val allowLongTermMemory: Boolean = true,
    val excludedLabels: Set<String> = setOf("credential", "secret", "medical"),
) {
    private val sensitiveContent: Regex get() = Regex(
        "(?i)(身份证|银行卡|密码\\s*[:：]|病历|诊断结果|medical record|diagnosis|private key)",
    )

    fun mayPersist(label: String, content: String): Boolean =
        enabled && allowLongTermMemory && label.lowercase() !in excludedLabels &&
            SensitiveDataRedactor.redact(content) == content && !sensitiveContent.containsMatchIn(content)
}

data class ConversationSummary(
    val sessionId: String,
    val fromMessageId: String,
    val toMessageId: String,
    val content: String,
    val sourceCount: Int,
) {
    init {
        require(sessionId.isNotBlank()) { "summary_session_required" }
        require(fromMessageId.isNotBlank() && toMessageId.isNotBlank()) { "summary_range_required" }
        require(content.isNotBlank()) { "summary_content_required" }
        require(sourceCount > 0) { "summary_source_count_invalid" }
    }
}

data class SummarizableMessage(val id: String, val role: String, val content: String)

object ConversationCompactor {
    fun compact(
        sessionId: String,
        messages: List<SummarizableMessage>,
        keepRecent: Int = 16,
        maxChars: Int = 4_000,
    ): ConversationSummary? {
        require(keepRecent > 0) { "summary_keep_recent_invalid" }
        require(maxChars > 0) { "summary_max_chars_invalid" }
        val sources = messages.dropLast(keepRecent).filter { it.content.isNotBlank() }
        if (sources.isEmpty()) return null
        val content = buildString {
            append("较早会话摘要（按原始顺序）：\n")
            sources.forEach { message ->
                if (length >= maxChars) return@forEach
                val normalized = message.content.replace(Regex("\\s+"), " ").trim()
                append("- ").append(message.role).append(": ")
                    .append(normalized.take(320)).append('\n')
            }
        }.take(maxChars).trim()
        return ConversationSummary(
            sessionId, sources.first().id, sources.last().id, content, sources.size,
        )
    }
}
