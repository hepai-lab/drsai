package ai.drsai.remote

import ai.drsai.remote.data.AccessTokenCoordinator
import ai.drsai.remote.data.AuthTokenStore
import ai.drsai.remote.data.AuthTokens
import ai.drsai.remote.data.PlatformAgentClient
import ai.drsai.remote.data.PlatformAgentRuntime
import ai.drsai.remote.data.AgentCatalogEntity
import ai.drsai.remote.data.ChatDao
import ai.drsai.remote.data.Conversation
import ai.drsai.remote.data.ConversationEntity
import ai.drsai.remote.data.ConversationSummaryEntity
import ai.drsai.remote.data.MemoryEntity
import ai.drsai.remote.data.MessageEntity
import ai.drsai.remote.data.MessageAttachmentEntity
import ai.drsai.remote.data.MessageAttachment
import ai.drsai.remote.data.RuntimeEvent
import ai.drsai.remote.data.TokenLifecycleClient
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.data.User
import ai.drsai.remote.data.nativeApiError
import ai.drsai.remote.data.nativeTextDelta
import ai.drsai.remote.data.nativeArtifacts
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PlatformAgentClientTest {
    private lateinit var server: MockWebServer

    @Before fun startServer() { server = MockWebServer().also { it.start() } }
    @After fun stopServer() { server.shutdown() }

    @Test fun catalog_parses_native_v1_shape_and_public_capabilities() = runTest {
        server.enqueue(MockResponse().setBody(
            """{
              "status":true,
              "data":{"api_version":"native-v1","capabilities":{"features":["agents","agent-chat","attachment-upload"]},"agents":[
                {"id":"ddf-1","name":"DDF 助手","description":"远程分析", "mode":"ddf",
                 "available":true,"is_default":true,"capabilities":{"chat":true,"document-input":true},
                 "examples":[{"zh":"分析这组数据","en":"Analyze data"}]},
                {"id":"remote-1","name":"离线助手","mode":"remote","status":"offline","capabilities":[]}
              ]}
            }""".trimIndent(),
        ))
        val store = PlatformFakeTokenStore("token", "refresh")
        val client = PlatformAgentClient(
            AccessTokenCoordinator(store, PlatformFakeTokenLifecycle()),
            server.url("").toString(),
        )

        val result = client.listAgents(refresh = true)

        assertEquals("native-v1", result.status.apiVersion)
        assertTrue("agent-chat" in result.status.capabilities)
        assertTrue("attachment-upload" in result.status.capabilities)
        assertEquals("platform:ddf-1", result.agents[0].id)
        assertTrue(result.agents[0].chatSupported)
        assertTrue("document-input" in result.agents[0].capabilities)
        assertTrue(result.agents[0].isDefault)
        assertEquals(listOf("分析这组数据"), result.agents[0].examples)
        assertFalse(result.agents[1].available)
        assertFalse(result.agents[1].chatSupported)
        assertEquals("true", server.takeRequest().requestUrl?.queryParameter("refresh"))
    }

    @Test fun catalog_refreshes_once_only_for_expired_oidc_token() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody(
            """{"detail":{"code":"token_expired","message":"expired"}}""",
        ))
        server.enqueue(MockResponse().setBody(
            """{"api_version":"native-v1","capabilities":[],"data":{"agents":[]}}""",
        ))
        val store = PlatformFakeTokenStore("old", "refresh")
        val lifecycle = PlatformFakeTokenLifecycle()
        val client = PlatformAgentClient(AccessTokenCoordinator(store, lifecycle), server.url("").toString())

        client.listAgents(refresh = false)

        assertEquals(1, lifecycle.refreshes)
        assertEquals("Bearer old", server.takeRequest().getHeader("Authorization"))
        assertEquals("Bearer new", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun native_stream_parser_ignores_null_and_maps_errors() {
        assertEquals("", nativeTextDelta("""{"choices":[{"delta":{"content":null}}]}"""))
        assertEquals("你好", nativeTextDelta("""{"choices":[{"delta":{"content":"你好"}}]}"""))
        assertEquals("该智能体暂不支持 Android 对话", nativeApiError(
            409,
            """{"detail":{"code":"agent_chat_unsupported"}}""",
        ).message)
        val artifact = nativeArtifacts("""{"file_events":[{"id":"att_result","name":"result.txt","mime_type":"text/plain","size":12,"sha256":"hash"}]}""").single()
        assertEquals("att_result", artifact.id)
        assertEquals("result.txt", artifact.name)
    }

    @Test fun platform_runtime_streams_and_persists_native_agent_reply() = runTest {
        server.enqueue(MockResponse()
            .addHeader("Content-Type", "text/event-stream")
            .setChunkedBody(
                "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n" +
                "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n" +
                    "data: {\"file_events\":[{\"id\":\"att_result\",\"name\":\"result.txt\",\"mime_type\":\"text/plain\",\"size\":12,\"sha256\":\"hash\"}]}\n\n" +
                    "data: [DONE]\n\n",
                9,
            ))
        val dao = PlatformRuntimeFakeDao()
        val runtime = PlatformAgentRuntime(
            AccessTokenCoordinator(PlatformFakeTokenStore("token", "refresh"), PlatformFakeTokenLifecycle()),
            dao,
            server.url("").toString(),
        )
        val conversation = Conversation(
            id = "thread-1",
            title = "测试",
            agentId = "platform:ddf-1",
            agentName = "DDF 助手",
            agentSource = "platform",
        )

        val attachment = MessageAttachment("a1", "m1", "thread-1", "att_server", "x.txt", "text/plain", 1, "file")
        val events = runtime.run(conversation, "hello", listOf(attachment), requestedRunId = "run-fixed", userMessageId = "m1", assistantMessageId = "assistant-1").toList()

        assertEquals("你好", events.filterIsInstance<RuntimeEvent.TextDelta>().joinToString(separator = "") { it.text })
        assertTrue(events.last() == RuntimeEvent.Completed)
        assertEquals("你好", dao.messages.last { it.role == "assistant" }.content)
        assertEquals("complete", dao.messages.last { it.role == "assistant" }.status)
        val request = server.takeRequest()
        assertEquals("/api/native/v1/agents/ddf-1/chat", request.requestUrl?.encodedPath)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"thread_id\":\"thread-1\""))
        assertTrue(body.contains("\"id\":\"att_server\""))
        assertEquals("android-chat-run-fixed", request.getHeader("Idempotency-Key"))
        assertEquals("att_server", dao.attachments.first().remoteId)
        assertTrue(events.any { it is RuntimeEvent.Artifact && it.attachment.id == "att_result" })
        assertEquals("att_result", dao.attachments.last().remoteId)
    }
}

private class PlatformFakeTokenStore(
    override var accessToken: String?,
    override var refreshToken: String?,
) : AuthTokenStore {
    override fun save(auth: AuthTokens) {
        accessToken = auth.accessToken
        refreshToken = auth.refreshToken
    }
}

private class PlatformFakeTokenLifecycle : TokenLifecycleClient {
    var refreshes = 0
    override suspend fun refresh(refreshToken: String): AuthTokens {
        refreshes += 1
        return AuthTokens("new", "new-refresh", User("u1"))
    }
    override suspend fun revoke(refreshToken: String) = Unit
}

private class PlatformRuntimeFakeDao : ChatDao {
    val messages = mutableListOf<MessageEntity>()
    val attachments = mutableListOf<MessageAttachmentEntity>()
    val toolArtifactRows = mutableListOf<ToolArtifactEntity>()
    override fun conversations(userId: String): Flow<List<ConversationEntity>> = flowOf(emptyList())
    override suspend fun conversationSnapshot(userId: String) = emptyList<ConversationEntity>()
    override suspend fun visibleMessageSnapshot(id: String) = messages.filter { it.conversationId == id && it.visible }
    override suspend fun runtimeMessageSnapshot(id: String) = messages.filter { it.conversationId == id }
    override suspend fun searchVisibleMessages(userId: String, escapedQuery: String, limit: Int) = emptyList<MessageEntity>()
    override suspend fun saveConversation(item: ConversationEntity) = Unit
    override suspend fun saveMessage(item: MessageEntity) {
        messages.removeAll { it.id == item.id }
        messages += item
    }
    override suspend fun saveMessages(items: List<MessageEntity>) = items.forEach { saveMessage(it) }
    override suspend fun saveAttachments(items: List<MessageAttachmentEntity>) { attachments += items }
    override suspend fun attachmentSnapshot(id: String) = attachments.filter { it.conversationId == id }
    override suspend fun allAttachmentsForUser(userId: String) = attachments.toList()
    override suspend fun deleteAttachment(id: String) { attachments.removeAll { it.id == id } }
    override suspend fun updateConversation(id: String, title: String, updatedAt: Long) = Unit
    override suspend fun deleteConversation(id: String) = Unit
    override suspend fun saveMemory(item: MemoryEntity) = 1L
    override suspend fun searchMemories(userId: String, query: String, limit: Int) = emptyList<MemoryEntity>()
    override suspend fun memorySnapshot(userId: String, limit: Int) = emptyList<MemoryEntity>()
    override suspend fun deleteMemory(userId: String, id: Long) = 0
    override suspend fun saveConversationSummary(item: ConversationSummaryEntity) = Unit
    override suspend fun conversationSummary(conversationId: String) = null
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
