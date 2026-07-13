package ai.drsai.remote

import ai.drsai.remote.data.*
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

    @Test fun context_is_bounded_to_twenty_persisted_messages() = runTest {
        val dao = FakeDao()
        repeat(30) { index ->
            dao.messages += MessageEntity("m$index", "c1", if (index % 2 == 0) "user" else "assistant", "message-$index")
        }
        val gateway = FakeGateway(listOf(listOf(ModelDelta("ok", emptyList(), "stop"))))
        LocalAgentRuntime(gateway, dao).run("u1", conversation(), "latest").toList()
        assertTrue(gateway.requests.single().size <= 21) // system + at most 20 persisted messages
        assertEquals("latest", gateway.requests.single().last().content)
    }

    @Test fun runtime_stops_at_the_model_round_limit() = runTest {
        val toolRound = listOf(ModelDelta(null, listOf(ToolCallDelta(0, "c", "get_current_time", "{}")), "tool_calls"))
        val events = LocalAgentRuntime(FakeGateway(List(8) { toolRound }), FakeDao())
            .run("u1", conversation(), "loop")
            .toList()
        assertTrue(events.last() is RuntimeEvent.Failed)
        assertTrue((events.last() as RuntimeEvent.Failed).message.contains("8"))
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
    override fun conversations(userId: String): Flow<List<ConversationEntity>> = flowOf(conversations.filter { it.userId == userId })
    override suspend fun conversationSnapshot(userId: String) = conversations.filter { it.userId == userId }
    override suspend fun visibleMessageSnapshot(id: String) = messages.filter { it.conversationId == id && it.visible }
    override suspend fun runtimeMessageSnapshot(id: String) = messages.filter { it.conversationId == id }
    override suspend fun saveConversation(item: ConversationEntity) { conversations.removeAll { it.id == item.id }; conversations += item }
    override suspend fun saveMessage(item: MessageEntity) { messages.removeAll { it.id == item.id }; messages += item }
    override suspend fun saveMessages(items: List<MessageEntity>) { items.forEach { saveMessage(it) } }
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
}
