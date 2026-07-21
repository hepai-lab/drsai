package ai.drsai.remote.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.io.File
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import ai.drsai.remote.runtime.tools.ToolExecutionContext
import ai.drsai.remote.runtime.tools.ToolExecutionOutcome
import ai.drsai.remote.runtime.tools.ToolRegistry
import ai.drsai.remote.runtime.tools.ToolApprovalGateway
import ai.drsai.remote.runtime.tools.defaultLocalToolRegistry
import ai.drsai.remote.runtime.context.ContextAssembler
import ai.drsai.remote.runtime.context.ContextBudget
import ai.drsai.remote.runtime.context.ContextMessage
import ai.drsai.remote.runtime.context.ContextToolCall
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.ProjectInstructionVersion
import ai.drsai.remote.runtime.context.AttachmentContextBudgeter
import ai.drsai.remote.runtime.context.ImageContextBudgeter
import ai.drsai.remote.runtime.context.ImageContextCandidate
import ai.drsai.remote.runtime.context.PromptLayer
import ai.drsai.remote.runtime.context.ConversationCompactor
import ai.drsai.remote.runtime.context.SummarizableMessage

private const val MAX_MODEL_ROUNDS = 8
private const val MAX_TOOL_CALLS_PER_ROUND = 5
private const val MAX_CONTEXT_MESSAGES = 20
private const val MAX_CONTEXT_CHARS = 32_000
private const val MAX_TOOL_OUTPUT_CHARS = 4_096

class LocalToolRegistry(
    private val dao: ChatDao,
    private val registry: ToolRegistry = defaultLocalToolRegistry(dao),
    private val capabilities: (String) -> Set<ai.drsai.remote.workbench.model.RuntimeCapability> = {
        DEFAULT_AGENT.capabilities.mapNotNull { value ->
            runCatching {
                ai.drsai.remote.workbench.model.RuntimeCapability.valueOf(value.uppercase().replace('-', '_'))
            }.getOrNull()
        }.toSet()
    },
    private val approvals: ToolApprovalGateway? = null,
) {
    data class Result(val output: String, val succeeded: Boolean, val code: String? = null)

    suspend fun execute(userId: String, call: CompletedToolCall, runId: String? = null, sessionId: String? = null): String =
        executeDetailed(userId, call, runId, sessionId).output

    suspend fun executeDetailed(userId: String, call: CompletedToolCall, runId: String? = null, sessionId: String? = null): Result {
        val context = ToolExecutionContext(userId, capabilities(userId), runId = runId, sessionId = sessionId, toolCallId = call.id)
        return when (val outcome = registry.execute(context, call.name, call.arguments)) {
            is ToolExecutionOutcome.Success -> Result(outcome.output, true)
            is ToolExecutionOutcome.ApprovalRequired -> {
                val gateway = approvals
                if (gateway == null || runId == null || sessionId == null) {
                    rejected("approval_required", "工具 ${call.name} 需要用户批准")
                } else if (gateway.awaitApproval(
                        context, runId, sessionId, call.id, outcome.definition, outcome.arguments,
                    )
                ) {
                    when (val approved = registry.execute(context.copy(approved = true), call.name, call.arguments)) {
                        is ToolExecutionOutcome.Success -> Result(approved.output, true)
                        is ToolExecutionOutcome.Rejected -> rejected(approved.code, "工具 ${call.name} 被拒绝：${approved.code}")
                        is ToolExecutionOutcome.ApprovalRequired -> rejected("approval_state_invalid", "工具 ${call.name} 审批状态无效")
                    }
                } else rejected("approval_declined", "用户拒绝了工具 ${call.name}")
            }
            is ToolExecutionOutcome.Rejected -> rejected(outcome.code, "工具 ${call.name} 被拒绝：${outcome.code}")
        }.let { it.copy(output = it.output.take(MAX_TOOL_OUTPUT_CHARS)) }
    }

    private fun rejected(code: String, message: String) = Result(
        JSONObject().put("error", message).put("code", code).toString(), false, code,
    )
}

class LocalAgentRuntime(
    private val client: ModelGateway,
    private val dao: ChatDao,
    private val tools: LocalToolRegistry = LocalToolRegistry(dao),
    private val attachmentContexts: AttachmentContextGateway? = null,
    private val projectInstructions: suspend (String) -> List<PromptFragment> = { emptyList() },
    private val memoryEnabled: (String) -> Boolean = { true },
) {
    private val pausedRuns = ConcurrentHashMap.newKeySet<String>()
    private val stoppedRuns = ConcurrentHashMap.newKeySet<String>()
    private val toolsUnsupported = ConcurrentHashMap.newKeySet<String>()
    private val projectInstructionVersions = ConcurrentHashMap<String, Map<String, String>>()

    fun pause(runId: String) {
        pausedRuns += runId
        client.cancelActive()
    }

    fun stop(runId: String) {
        stoppedRuns += runId
        client.cancelActive()
    }

    fun run(
        userId: String,
        conversation: Conversation,
        input: String,
        attachments: List<MessageAttachment> = emptyList(),
        requestedRunId: String? = null,
        userMessageId: String? = null,
    ): Flow<RuntimeEvent> = channelFlow {
        val runId = requestedRunId ?: UUID.randomUUID().toString()
        val worker = launch {
            send(RuntimeEvent.Started(runId))
            val userMessage = MessageEntity(
                id = userMessageId ?: UUID.randomUUID().toString(),
                conversationId = conversation.id,
                role = "user",
                content = input,
            )
            dao.saveMessage(userMessage)
            if (attachments.isNotEmpty()) dao.saveAttachments(attachments.map(MessageAttachment::toEntity))
            dao.updateConversation(conversation.id, conversation.title, System.currentTimeMillis())
            try {
                // Capture before persisting the hidden attachment record. The current request receives
                // that content through attachmentPrompts exactly once; later runs read the persisted row.
                val persistedRuntimeMessages = dao.runtimeMessageSnapshot(conversation.id)
                val attachmentPrompts = mutableListOf<ContextMessage>()
                val eligibleAttachments = attachments.filter { it.status.equals("sent", ignoreCase = true) }
                val imageAttachments = eligibleAttachments.filter { it.kind == "image" }
                val readableImages = imageAttachments.filter { attachment ->
                    attachment.kind == "image" && attachment.localPath?.let(::File)?.isFile == true
                }
                val imageBudget = ImageContextBudgeter.select(readableImages.map { attachment ->
                    ImageContextCandidate(attachment.id, attachment.name, File(attachment.localPath!!).length())
                })
                val unavailableImages = imageAttachments.filterNot { candidate ->
                    readableImages.any { it.id == candidate.id }
                }.map { ImageContextCandidate(it.id, it.name, it.size) }
                val imageReferenceNotice = (imageBudget.omitted + unavailableImages).takeIf { it.isNotEmpty() }
                    ?.joinToString(
                        prefix = "[图片未内联到模型请求，仍可从原附件/Artifact 查看：",
                        postfix = "]",
                    ) { "${it.name} (${it.id})" }
                if (attachments.isNotEmpty()) {
                    val documentParts = eligibleAttachments.mapNotNull { attachment ->
                        val remoteId = attachment.remoteId ?: return@mapNotNull null
                        val extracted = attachmentContexts?.context(remoteId) ?: return@mapNotNull null
                        extracted.text?.let { text ->
                            buildString {
                                append(if (attachment.kind == "image") "图片描述：" else "附件：")
                                append("${attachment.name}\n类型：${attachment.mimeType}\n")
                                append(text)
                                if (extracted.truncated) append("\n[附件内容已按安全上限截断]")
                            }
                        }
                    }.toMutableList()
                    imageReferenceNotice?.let(documentParts::add)
                    if (documentParts.isNotEmpty()) {
                        val budgeted = AttachmentContextBudgeter.prepare(documentParts)
                        val hidden = budgeted.content
                        dao.saveMessage(
                            MessageEntity(
                                id = UUID.randomUUID().toString(), conversationId = conversation.id, role = "system",
                                content = "以下内容来自当前用户消息绑定的附件：\n$hidden", visible = false,
                            ),
                        )
                        attachmentPrompts += ContextMessage(
                            "system", "以下内容来自当前用户消息绑定的附件：\n$hidden", pinned = true,
                        )
                    }
                }
                val context = buildContext(
                    userId,
                    conversation,
                    persistedRuntimeMessages,
                    attachmentPrompts,
                )
                if (imageBudget.included.isNotEmpty()) {
                    val includedIds = imageBudget.included.mapTo(hashSetOf(), ImageContextCandidate::id)
                    val images = readableImages.filter { it.id in includedIds }.mapNotNull { attachment ->
                        val file = attachment.localPath?.let(::File)?.takeIf(File::isFile) ?: return@mapNotNull null
                        RuntimeImage(
                            attachment.mimeType,
                            "data:${attachment.mimeType};base64,${Base64.getEncoder().encodeToString(file.readBytes())}",
                        )
                    }
                    if (images.isNotEmpty()) {
                        val userIndex = context.indexOfLast { it.role == "user" }
                        if (userIndex >= 0) context[userIndex] = context[userIndex].copy(images = images)
                    }
                }
                var modelRound = 0
                var toolsEnabled = conversation.modelId !in toolsUnsupported
                while (modelRound < MAX_MODEL_ROUNDS) {
                    val assistantId = UUID.randomUUID().toString()
                    val text = StringBuilder()
                    val callBuilders = linkedMapOf<Int, MutableToolCall>()
                    try {
                        client.streamCompletion(conversation.modelId, context, toolsEnabled) { delta ->
                            delta.content?.let { chunk ->
                                text.append(chunk)
                                send(RuntimeEvent.TextDelta(chunk))
                                dao.saveMessage(
                                    MessageEntity(
                                        id = assistantId,
                                        conversationId = conversation.id,
                                        role = "assistant",
                                        content = text.toString(),
                                        status = "streaming",
                                    ),
                                )
                            }
                            delta.toolCalls.forEach { piece ->
                                val builder = callBuilders.getOrPut(piece.index) { MutableToolCall() }
                                piece.id?.let { builder.id = it }
                                piece.name?.let { builder.name = it }
                                builder.arguments.append(piece.arguments)
                            }
                        }
                    } catch (error: ApiException) {
                        if (toolsEnabled && error.status == 400 && text.isEmpty() && callBuilders.isEmpty()) {
                            toolsUnsupported += conversation.modelId
                            toolsEnabled = false
                            send(RuntimeEvent.ToolDowngraded("当前模型不支持本地工具，已切换为纯对话"))
                            continue
                        }
                        throw error
                    }
                    modelRound += 1
                    val calls = callBuilders.values.mapIndexed { index, builder -> builder.complete(index) }
                    if (calls.isEmpty()) {
                        if (text.isBlank()) throw ApiException(422, "模型没有返回可显示内容", retryable = false)
                        dao.saveMessage(
                            MessageEntity(
                                id = assistantId,
                                conversationId = conversation.id,
                                role = "assistant",
                                content = text.toString(),
                                status = "complete",
                            ),
                        )
                        send(RuntimeEvent.Completed)
                        return@launch
                    }
                    if (calls.size > MAX_TOOL_CALLS_PER_ROUND) {
                        throw ApiException(422, "单轮工具调用超过安全上限", retryable = false)
                    }
                    val payload = JSONArray(calls.map { JSONObject().put("id", it.id).put("name", it.name).put("arguments", it.arguments) }).toString()
                    dao.saveMessage(
                        MessageEntity(
                            id = assistantId,
                            conversationId = conversation.id,
                            role = "assistant",
                            content = text.toString(),
                            toolPayload = payload,
                            visible = text.isNotBlank(),
                        ),
                    )
                    context += RuntimeMessage("assistant", text.toString(), toolCalls = calls)
                    for (call in calls) {
                        send(RuntimeEvent.ToolStarted(call.name))
                        val toolResult = tools.executeDetailed(userId, call, runId, conversation.id)
                        val result = toolResult.output
                        dao.saveMessage(
                            MessageEntity(
                                id = UUID.randomUUID().toString(),
                                conversationId = conversation.id,
                                role = "tool",
                                content = result,
                                toolCallId = call.id,
                                toolName = call.name,
                                visible = false,
                            ),
                        )
                        context += RuntimeMessage("tool", result, toolCallId = call.id)
                        send(
                            if (toolResult.succeeded) RuntimeEvent.ToolFinished(call.name)
                            else RuntimeEvent.ToolFailed(call.name, toolResult.code ?: "tool_execution_failed"),
                        )
                    }
                }
                throw ApiException(422, "Agent 已达到 8 轮运行上限", retryable = false)
            } catch (_: CancellationException) {
                val status = if (runId in pausedRuns) "paused" else "stopped"
                markLatestAssistant(conversation.id, status)
                send(if (status == "paused") RuntimeEvent.Paused else RuntimeEvent.Cancelled)
            } catch (error: Throwable) {
                val status = when {
                    runId in pausedRuns -> "paused"
                    runId in stoppedRuns -> "stopped"
                    else -> "failed"
                }
                markLatestAssistant(conversation.id, status)
                if (status == "paused") send(RuntimeEvent.Paused)
                else if (status == "stopped") send(RuntimeEvent.Cancelled)
                else send(RuntimeEvent.Failed(error.message ?: "Agent 运行失败", (error as? ApiException)?.retryable ?: true))
            } finally {
                pausedRuns -= runId
                stoppedRuns -= runId
                close()
            }
        }
        awaitClose {
            worker.cancel()
            client.cancelActive()
        }
    }

    private suspend fun markLatestAssistant(conversationId: String, status: String) {
        val latest = dao.runtimeMessageSnapshot(conversationId).lastOrNull { it.role == "assistant" }
        if (latest != null) dao.saveMessage(latest.copy(status = status))
    }

    private suspend fun buildContext(
        userId: String,
        conversation: Conversation,
        entities: List<MessageEntity>,
        attachmentPrompts: List<ContextMessage>,
    ): MutableList<RuntimeMessage> {
        val history = entities.map { entity ->
            val calls = entity.toolPayload?.let { raw ->
                val array = runCatching { JSONArray(raw) }.getOrNull() ?: JSONArray()
                (0 until array.length()).mapNotNull { index ->
                    array.optJSONObject(index)?.let {
                        ContextToolCall(it.optString("id"), it.optString("name"), it.optString("arguments"))
                    }
                }
            }.orEmpty()
            ContextMessage(
                role = entity.role,
                content = sanitizeLegacyAssistantText(entity.role, entity.content),
                toolCallId = entity.toolCallId,
                toolCalls = calls,
            )
        }
        val memories = if (memoryEnabled(userId)) dao.searchMemories(userId, "", 5) else emptyList()
        val generatedSummary = ConversationCompactor.compact(
            conversation.id,
            entities.map { SummarizableMessage(it.id, it.role, sanitizeLegacyAssistantText(it.role, it.content)) },
            keepRecent = MAX_CONTEXT_MESSAGES - 4,
        )
        if (generatedSummary != null) {
            val existing = dao.conversationSummary(conversation.id)
            if (existing?.toMessageId != generatedSummary.toMessageId) {
                dao.saveConversationSummary(
                    ConversationSummaryEntity(
                        conversation.id,
                        generatedSummary.fromMessageId,
                        generatedSummary.toMessageId,
                        generatedSummary.content,
                        generatedSummary.sourceCount,
                        System.currentTimeMillis(),
                    ),
                )
            }
        }
        val persistedSummary = dao.conversationSummary(conversation.id)
        val currentProjectInstructions = projectInstructions(userId)
        val currentInstructionVersions = ProjectInstructionVersion.versions(currentProjectInstructions)
        val previousInstructionVersions = projectInstructionVersions.put(userId, currentInstructionVersions)
        if (previousInstructionVersions != null) {
            val changed = ProjectInstructionVersion.changed(previousInstructionVersions, currentInstructionVersions)
            if (changed.isNotEmpty()) {
                throw ApiException(
                    409,
                    "项目指令已更新（${changed.joinToString()}），请重试确认使用新版本",
                    retryable = false,
                )
            }
        }
        val prompts = buildList {
            add(PromptFragment(PromptLayer.SYSTEM, DEFAULT_AGENT.systemPrompt, "android-app"))
            if (conversation.agentId != DEFAULT_AGENT.id) {
                add(PromptFragment(PromptLayer.AGENT, "当前智能体：${conversation.agentName}", conversation.agentId))
            }
            if (memories.isNotEmpty()) {
                add(PromptFragment(
                    PromptLayer.USER_PREFERENCE,
                    memories.joinToString("\n") { "- ${it.content}" },
                    "local-memory",
                ))
            }
            addAll(currentProjectInstructions)
        }
        val assembly = ContextAssembler().assemble(
            prompts = prompts,
            history = history,
            summary = persistedSummary?.let {
                ContextMessage("system", it.content, pinned = true)
            },
            attachmentContext = attachmentPrompts,
            budget = ContextBudget(
                maxTokens = MAX_CONTEXT_CHARS / 3,
                reservedResponseTokens = 2_048,
                maxMessages = MAX_CONTEXT_MESSAGES + 1,
            ),
        )
        return assembly.messages.mapTo(mutableListOf()) { message ->
            RuntimeMessage(
                role = message.role,
                content = message.content,
                toolCallId = message.toolCallId,
                toolCalls = message.toolCalls.map { CompletedToolCall(it.id, it.name, it.arguments) },
            )
        }
    }

    private class MutableToolCall {
        var id: String = ""
        var name: String = ""
        val arguments = StringBuilder()

        fun complete(index: Int) = CompletedToolCall(
            id = id.ifBlank { "tool-$index-${UUID.randomUUID()}" },
            name = name.ifBlank { "unknown_tool" },
            arguments = arguments.toString().ifBlank { "{}" },
        )
    }
}
