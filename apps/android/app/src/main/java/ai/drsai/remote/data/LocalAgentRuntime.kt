package ai.drsai.remote.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.io.File
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

private const val MAX_MODEL_ROUNDS = 8
private const val MAX_TOOL_CALLS_PER_ROUND = 5
private const val MAX_CONTEXT_MESSAGES = 20
private const val MAX_CONTEXT_CHARS = 32_000
private const val MAX_TOOL_OUTPUT_CHARS = 4_096

class LocalToolRegistry(private val dao: ChatDao) {
    suspend fun execute(userId: String, call: CompletedToolCall): String {
        val args = runCatching { JSONObject(call.arguments.ifBlank { "{}" }) }
            .getOrElse { return error("工具参数不是有效 JSON") }
        return when (call.name) {
            "get_current_time" -> JSONObject()
                .put("time", ZonedDateTime.now().format(DateTimeFormatter.ISO_ZONED_DATE_TIME))
                .toString()
            "save_memory" -> {
                val content = args.optString("content").trim()
                if (content.isEmpty() || content.length > 500) return error("content 长度必须为 1–500 字符")
                val id = dao.saveMemory(MemoryEntity(userId = userId, content = content))
                JSONObject().put("saved", true).put("id", id).toString()
            }
            "search_memory" -> {
                val query = args.optString("query").trim()
                if (query.isEmpty() || query.length > 100) return error("query 长度必须为 1–100 字符")
                val limit = args.optInt("limit", 5).coerceIn(1, 10)
                val items = dao.searchMemories(userId, query, limit)
                JSONObject().put("items", JSONArray(items.map { JSONObject().put("id", it.id).put("content", it.content) })).toString()
            }
            else -> error("Android Runtime 不允许工具 ${call.name}")
        }.take(MAX_TOOL_OUTPUT_CHARS)
    }

    private fun error(message: String) = JSONObject().put("error", message).toString()
}

class LocalAgentRuntime(
    private val client: ModelGateway,
    private val dao: ChatDao,
    private val tools: LocalToolRegistry = LocalToolRegistry(dao),
    private val attachmentContexts: AttachmentContextGateway? = null,
) {
    private val pausedRuns = ConcurrentHashMap.newKeySet<String>()
    private val stoppedRuns = ConcurrentHashMap.newKeySet<String>()
    private val toolsUnsupported = ConcurrentHashMap.newKeySet<String>()

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
                val context = buildContext(dao.runtimeMessageSnapshot(conversation.id))
                if (attachments.isNotEmpty()) {
                    val documentParts = attachments.filter { it.kind != "image" }.mapNotNull { attachment ->
                        val remoteId = attachment.remoteId ?: return@mapNotNull null
                        val extracted = attachmentContexts?.context(remoteId) ?: return@mapNotNull null
                        extracted.text?.let { text ->
                            buildString {
                                append("附件：${attachment.name}\n类型：${attachment.mimeType}\n")
                                append(text)
                                if (extracted.truncated) append("\n[附件内容已按安全上限截断]")
                            }
                        }
                    }
                    if (documentParts.isNotEmpty()) {
                        val hidden = documentParts.joinToString("\n\n").take(80_000)
                        dao.saveMessage(
                            MessageEntity(
                                id = UUID.randomUUID().toString(), conversationId = conversation.id, role = "system",
                                content = "以下内容来自当前用户消息绑定的附件：\n$hidden", visible = false,
                            ),
                        )
                        context += RuntimeMessage("system", "以下内容来自当前用户消息绑定的附件：\n$hidden")
                    }
                    val images = attachments.filter { it.kind == "image" }.mapNotNull { attachment ->
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
                        if (text.isBlank()) throw ApiException(0, "模型没有返回可显示内容")
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
                    if (calls.size > MAX_TOOL_CALLS_PER_ROUND) throw ApiException(0, "单轮工具调用超过安全上限")
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
                        val result = tools.execute(userId, call)
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
                        send(RuntimeEvent.ToolFinished(call.name))
                    }
                }
                throw ApiException(0, "Agent 已达到 8 轮运行上限")
            } catch (_: CancellationException) {
                val status = if (runId in pausedRuns) "paused" else "stopped"
                markLatestAssistant(conversation.id, status)
                send(if (status == "paused") RuntimeEvent.Paused else RuntimeEvent.Completed)
            } catch (error: Throwable) {
                val status = when {
                    runId in pausedRuns -> "paused"
                    runId in stoppedRuns -> "stopped"
                    else -> "failed"
                }
                markLatestAssistant(conversation.id, status)
                if (status == "paused") send(RuntimeEvent.Paused)
                else if (status == "stopped") send(RuntimeEvent.Completed)
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

    private fun buildContext(entities: List<MessageEntity>): MutableList<RuntimeMessage> {
        val selected = mutableListOf<MessageEntity>()
        var chars = 0
        for (entity in entities.asReversed()) {
            if (selected.size >= MAX_CONTEXT_MESSAGES) break
            val size = entity.content.length + (entity.toolPayload?.length ?: 0)
            if (chars + size > MAX_CONTEXT_CHARS) {
                if (selected.isEmpty()) selected += entity.copy(content = entity.content.takeLast(MAX_CONTEXT_CHARS))
                break
            }
            selected += entity
            chars += size
        }
        while (selected.lastOrNull()?.role == "tool") selected.removeAt(selected.lastIndex)
        val result = mutableListOf(RuntimeMessage("system", DEFAULT_AGENT.systemPrompt))
        selected.asReversed().forEach { entity ->
            val calls = entity.toolPayload?.let { raw ->
                val array = runCatching { JSONArray(raw) }.getOrNull() ?: JSONArray()
                (0 until array.length()).mapNotNull { index ->
                    array.optJSONObject(index)?.let { CompletedToolCall(it.optString("id"), it.optString("name"), it.optString("arguments")) }
                }
            }.orEmpty()
            result += RuntimeMessage(
                entity.role,
                sanitizeLegacyAssistantText(entity.role, entity.content),
                entity.toolCallId,
                calls,
            )
        }
        return result
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
