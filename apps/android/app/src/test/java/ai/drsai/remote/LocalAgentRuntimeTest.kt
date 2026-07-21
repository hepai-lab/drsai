package ai.drsai.remote

import ai.drsai.remote.data.*
import ai.drsai.remote.runtime.context.PromptFragment
import ai.drsai.remote.runtime.context.PromptLayer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class LocalAgentRuntimeTest {
    @Test fun runtime_streams_and_persists_a_plain_answer() = runTest {
        val dao = FakeDao()
        val gateway = FakeGateway(listOf(listOf(ModelDelta("你好", emptyList(), null))))
        val conversation = conversation()
        val events = LocalAgentRuntime(gateway, dao).run("u1", conversation, "测试").toList()
        assertTrue(events.any { it is RuntimeEvent.TextDelta && it.text == "你好" })
        assertTrue(events.any { it == RuntimeEvent.Completed })
        assertEquals("你好", dao.messages.last { it.role == "assistant" }.content)
        assertEquals("complete", dao.messages.last { it.role == "assistant" }.status)
    }

    @Test fun runtime_binds_document_context_to_the_current_user_message() = runTest {
        val dao = FakeDao()
        val gateway = FakeGateway(listOf(listOf(ModelDelta("已分析", emptyList(), null))))
        val attachment = MessageAttachment(
            id = "a1", messageId = "m1", conversationId = "c1", remoteId = "att_1",
            name = "report.txt", mimeType = "text/plain", size = 5, kind = "file",
        )
        LocalAgentRuntime(
            gateway,
            dao,
            attachmentContexts = object : AttachmentContextGateway {
                override suspend fun context(remoteId: String) = AttachmentContext(remoteId, "document", "text/plain", "真实附件内容", false)
            },
        ).run("u1", conversation(), "分析", listOf(attachment), userMessageId = "m1").toList()
        assertTrue(gateway.requests.first().any { it.role == "system" && it.content.contains("真实附件内容") })
        assertTrue(dao.messages.any { !it.visible && it.content.contains("真实附件内容") })
        assertEquals("att_1", dao.attachments.single().remoteId)
    }

    @Test fun imageDescriptionEntersBudgetedContextButFailedAttachmentDoesNot() = runTest {
        val dao = FakeDao()
        val gateway = FakeGateway(listOf(listOf(ModelDelta("ok", emptyList(), "stop"))))
        val requested = mutableListOf<String>()
        val attachments = listOf(
            MessageAttachment(
                id = "image", messageId = "m1", conversationId = "c1", remoteId = "remote-image",
                name = "scope.jpg", mimeType = "image/jpeg", size = 12, kind = "image", status = "sent",
            ),
            MessageAttachment(
                id = "failed", messageId = "m1", conversationId = "c1", remoteId = "remote-failed",
                name = "failed.txt", mimeType = "text/plain", size = 12, kind = "file", status = "failed",
            ),
        )
        LocalAgentRuntime(
            gateway,
            dao,
            attachmentContexts = object : AttachmentContextGateway {
                override suspend fun context(remoteId: String): AttachmentContext {
                    requested += remoteId
                    return AttachmentContext(remoteId, "description", "text/plain", "oscilloscope trace", false)
                }
            },
        ).run("u1", conversation(), "analyze", attachments, userMessageId = "m1").toList()

        assertEquals(listOf("remote-image"), requested)
        val context = gateway.requests.single().single { it.role == "system" && it.content.contains("scope.jpg") }
        assertTrue(context.content.contains("图片描述"))
        assertTrue(context.content.contains("oscilloscope trace"))
        assertFalse(gateway.requests.flatten().any { it.content.contains("failed.txt") })
    }

    @Test fun runtime_executes_a_safe_tool_and_returns_the_result() = runTest {
        val dao = FakeDao()
        val gateway = FakeGateway(listOf(
            listOf(ModelDelta(null, listOf(ToolCallDelta(0, "c1", "get_current_time", "{}")), "tool_calls")),
            listOf(ModelDelta("完成", emptyList(), "stop")),
        ))
        val events = LocalAgentRuntime(gateway, dao).run("u1", conversation(), "几点了").toList()
        assertTrue(events.any { it is RuntimeEvent.ToolStarted && it.name == "get_current_time" })
        assertTrue(dao.messages.any { it.role == "tool" && it.toolCallId == "c1" })
        assertTrue(gateway.requests.last().any { it.role == "tool" && it.toolCallId == "c1" })
    }

    @Test fun rejectedToolProducesOneFailureTerminalInsteadOfAFalseSuccess() = runTest {
        val dao = FakeDao()
        val gateway = FakeGateway(listOf(
            listOf(ModelDelta(null, listOf(ToolCallDelta(0, "bad-call", "unknown.tool", "{}")), "tool_calls")),
            listOf(ModelDelta("已处理", emptyList(), "stop")),
        ))
        val events = LocalAgentRuntime(gateway, dao).run("u1", conversation(), "调用工具").toList()
        assertEquals(1, events.count { it is RuntimeEvent.ToolStarted })
        assertEquals(1, events.count { it is RuntimeEvent.ToolFailed })
        assertEquals(0, events.count { it is RuntimeEvent.ToolFinished })
        assertTrue(dao.messages.single { it.role == "tool" }.content.contains("tool_not_registered"))
    }

    @Test fun local_memory_is_scoped_by_user_and_validated() = runTest {
        val dao = FakeDao()
        val tools = LocalToolRegistry(dao)
        tools.execute("u1", CompletedToolCall("1", "save_memory", "{\"content\":\"喜欢绿色\"}"))
        tools.execute("u2", CompletedToolCall("2", "save_memory", "{\"content\":\"喜欢蓝色\"}"))
        val own = tools.execute("u1", CompletedToolCall("3", "search_memory", "{\"query\":\"喜欢\",\"limit\":10}"))
        assertTrue(own.contains("绿色"))
        assertFalse(own.contains("蓝色"))
        val invalid = tools.execute("u1", CompletedToolCall("4", "save_memory", "{\"content\":\"\"}"))
        assertTrue(invalid.contains("error"))
    }

    @Test fun disabledMemoryIsNotIncludedInModelContext() = runTest {
        val dao = FakeDao().apply { memories += MemoryEntity(1, "u1", "private preference") }
        val gateway = FakeGateway(listOf(listOf(ModelDelta("ok", emptyList(), "stop"))))
        LocalAgentRuntime(gateway, dao, memoryEnabled = { false })
            .run("u1", conversation(), "hello").toList()
        assertFalse(gateway.requests.flatten().any { it.content.contains("private preference") })
    }

    @Test fun context_is_bounded_to_twenty_persisted_messages() = runTest {
        val dao = FakeDao()
        repeat(30) { index ->
            dao.messages += MessageEntity("m$index", "c1", if (index % 2 == 0) "user" else "assistant", "message-$index")
        }
        val gateway = FakeGateway(listOf(listOf(ModelDelta("ok", emptyList(), "stop"))))
        LocalAgentRuntime(gateway, dao).run("u1", conversation(), "latest").toList()
        assertTrue(gateway.requests.single().size <= 21) // system + at most 20 persisted messages
        assertEquals("latest", gateway.requests.single().last().content)
        assertNotNull(dao.summary)
        assertTrue(dao.summary!!.sourceCount > 0)
        assertTrue(gateway.requests.single().any { it.content.contains("较早会话摘要") })
    }

    @Test fun runtime_stops_at_the_model_round_limit() = runTest {
        val toolRound = listOf(ModelDelta(null, listOf(ToolCallDelta(0, "c", "get_current_time", "{}")), "tool_calls"))
        val events = LocalAgentRuntime(FakeGateway(List(8) { toolRound }), FakeDao())
            .run("u1", conversation(), "loop")
            .toList()
        assertTrue(events.last() is RuntimeEvent.Failed)
        assertTrue((events.last() as RuntimeEvent.Failed).message.contains("8"))
        assertFalse((events.last() as RuntimeEvent.Failed).retryable)
    }

    @Test fun runtimeRejectsMoreThanFiveToolCallsBeforeAnyToolExecutes() = runTest {
        val calls = (0 until 6).map { index ->
            ToolCallDelta(index, "call-$index", "get_current_time", "{}")
        }
        val dao = FakeDao()
        val events = LocalAgentRuntime(
            FakeGateway(listOf(listOf(ModelDelta(null, calls, "tool_calls")))),
            dao,
        ).run("u1", conversation(), "many tools").toList()

        assertTrue(events.last() is RuntimeEvent.Failed)
        assertFalse((events.last() as RuntimeEvent.Failed).retryable)
        assertFalse(events.any { it is RuntimeEvent.ToolStarted })
        assertFalse(dao.messages.any { it.role == "tool" })
    }

    @Test fun unsupported_tools_downgrade_to_plain_chat_once() = runTest {
        val gateway = object : ModelGateway {
            var calls = 0
            override suspend fun listModels() = emptyList<ModelInfo>()
            override fun selectModel(models: List<ModelInfo>) = models.first()
            override suspend fun streamCompletion(model: String, messages: List<RuntimeMessage>, toolsEnabled: Boolean, onDelta: suspend (ModelDelta) -> Unit) {
                calls += 1
                if (toolsEnabled) throw ApiException(400, "tools unsupported")
                onDelta(ModelDelta("fallback", emptyList(), "stop"))
            }
            override fun cancelActive() = Unit
            override suspend fun logout() = Unit
        }
        val events = LocalAgentRuntime(gateway, FakeDao()).run("u1", conversation(), "hello").toList()
        assertTrue(events.any { it is RuntimeEvent.ToolDowngraded })
        assertTrue(events.any { it == RuntimeEvent.Completed })
        assertEquals(2, gateway.calls)
    }

    @Test fun projectInstructionVersionChangeRequiresARetryBeforeModelCall() = runTest {
        var version = "v1"
        val gateway = FakeGateway(listOf(
            listOf(ModelDelta("first", emptyList(), "stop")),
            listOf(ModelDelta("confirmed", emptyList(), "stop")),
        ))
        val runtime = LocalAgentRuntime(
            gateway,
            FakeDao(),
            projectInstructions = {
                listOf(PromptFragment(PromptLayer.PROJECT, "instructions-$version", "saf:AGENTS.md", version))
            },
        )
        assertEquals(RuntimeEvent.Completed, runtime.run("u1", conversation(), "one").toList().last())
        version = "v2"
        val changed = runtime.run("u1", conversation(), "two").toList().last() as RuntimeEvent.Failed
        assertFalse(changed.retryable)
        assertEquals(1, gateway.requests.size)
        assertEquals(RuntimeEvent.Completed, runtime.run("u1", conversation(), "two").toList().last())
        assertEquals(2, gateway.requests.size)
        assertTrue(gateway.requests.last().first().content.contains("PROJECT:saf:AGENTS.md@v2"))
    }

    private fun conversation() = Conversation("c1", "测试", modelId = "deepseek-ai/deepseek-v4-pro")
}

private class FakeGateway(private val rounds: List<List<ModelDelta>>) : ModelGateway {
    var index = 0
    val requests = mutableListOf<List<RuntimeMessage>>()
    override suspend fun listModels() = listOf(ModelInfo("deepseek-ai/deepseek-v4-pro"))
    override fun selectModel(models: List<ModelInfo>) = models.first()
    override suspend fun streamCompletion(model: String, messages: List<RuntimeMessage>, toolsEnabled: Boolean, onDelta: suspend (ModelDelta) -> Unit) {
        requests += messages.toList()
        rounds[index++].forEach { onDelta(it) }
    }
    override fun cancelActive() = Unit
    override suspend fun logout() = Unit
}

private class FakeDao : ChatDao {
    val conversations = mutableListOf<ConversationEntity>()
    val messages = mutableListOf<MessageEntity>()
    val memories = mutableListOf<MemoryEntity>()
    val attachments = mutableListOf<MessageAttachmentEntity>()
    val toolArtifactRows = mutableListOf<ToolArtifactEntity>()
    var summary: ConversationSummaryEntity? = null
    override fun conversations(userId: String): Flow<List<ConversationEntity>> = flowOf(conversations.filter { it.userId == userId })
    override suspend fun conversationSnapshot(userId: String) = conversations.filter { it.userId == userId }
    override suspend fun visibleMessageSnapshot(id: String) = messages.filter { it.conversationId == id && it.visible }
    override suspend fun runtimeMessageSnapshot(id: String) = messages.filter { it.conversationId == id }
    override suspend fun searchVisibleMessages(userId: String, escapedQuery: String, limit: Int) = emptyList<MessageEntity>()
    override suspend fun saveConversation(item: ConversationEntity) { conversations.removeAll { it.id == item.id }; conversations += item }
    override suspend fun saveMessage(item: MessageEntity) { messages.removeAll { it.id == item.id }; messages += item }
    override suspend fun saveMessages(items: List<MessageEntity>) { items.forEach { saveMessage(it) } }
    override suspend fun saveAttachments(items: List<MessageAttachmentEntity>) { attachments.removeAll { old -> items.any { it.id == old.id } }; attachments += items }
    override suspend fun attachmentSnapshot(id: String) = attachments.filter { it.conversationId == id }
    override suspend fun allAttachmentsForUser(userId: String) = attachments.toList()
    override suspend fun deleteAttachment(id: String) { attachments.removeAll { it.id == id } }
    override suspend fun updateConversation(id: String, title: String, updatedAt: Long) = Unit
    override suspend fun deleteConversation(id: String) { conversations.removeAll { it.id == id }; messages.removeAll { it.conversationId == id } }
    override suspend fun saveMemory(item: MemoryEntity): Long {
        val id = (memories.maxOfOrNull { it.id } ?: 0) + 1
        memories += item.copy(id = id)
        return id
    }
    override suspend fun searchMemories(userId: String, query: String, limit: Int) = memories
        .filter { it.userId == userId && it.content.contains(query) }
        .sortedByDescending { it.createdAt }
        .take(limit)
    override suspend fun memorySnapshot(userId: String, limit: Int) = memories.filter { it.userId == userId }.take(limit)
    override suspend fun deleteMemory(userId: String, id: Long): Int = if (memories.removeAll { it.userId == userId && it.id == id }) 1 else 0
    override suspend fun saveConversationSummary(item: ConversationSummaryEntity) { summary = item }
    override suspend fun conversationSummary(conversationId: String) = summary?.takeIf { it.conversationId == conversationId }
    override suspend fun saveToolArtifact(item: ToolArtifactEntity) { toolArtifactRows += item }
    override suspend fun toolArtifacts(userId: String, runId: String) = toolArtifactRows.filter { it.userId == userId && it.runId == runId }
    override suspend fun allToolArtifacts(userId: String) = toolArtifactRows.filter { it.userId == userId }
    override suspend fun deleteToolArtifacts(userId: String, ids: List<String>): Int {
        val before = toolArtifactRows.size
        toolArtifactRows.removeAll { it.userId == userId && it.id in ids }
        return before - toolArtifactRows.size
    }

    override suspend fun pruneToolArtifacts(userId: String, before: Long, activeRunIds: List<String>) = 0
    override suspend fun agentCatalogSnapshot(userId: String) = emptyList<AgentCatalogEntity>()
    override suspend fun saveAgentCatalog(items: List<AgentCatalogEntity>) = Unit
    override suspend fun clearAgentCatalog(userId: String) = Unit
}
