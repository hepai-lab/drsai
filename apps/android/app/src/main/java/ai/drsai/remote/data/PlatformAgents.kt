package ai.drsai.remote.data

import ai.drsai.remote.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private const val PLATFORM_AGENTS_PATH = "/api/native/v1/agents"
private const val MAX_REMOTE_CONTEXT_MESSAGES = 40
private const val MAX_REMOTE_CONTEXT_CHARS = 128_000
private const val MAX_REMOTE_MESSAGE_CHARS = 16_000

data class PlatformCatalogResult(
    val agents: List<Agent>,
    val status: AgentCatalogStatus,
)

class AccessTokenCoordinator(
    private val tokens: AuthTokenStore,
    private val oidc: TokenLifecycleClient,
) {
    private val mutex = Mutex()

    fun current(): String = tokens.accessToken
        ?.takeIf(String::isNotBlank)
        ?: throw ApiException(401, "请先登录", retryable = false)

    suspend fun refreshAfter(failedToken: String): String? = mutex.withLock {
        if (tokens.accessToken != failedToken) return@withLock tokens.accessToken
        val refreshToken = tokens.refreshToken ?: return@withLock null
        runCatching {
            oidc.refresh(refreshToken).also(tokens::save).accessToken
        }.getOrNull()
    }
}

class PlatformAgentClient(
    private val auth: AccessTokenCoordinator,
    private val baseUrl: String = BuildConfig.HAI_BASE_URL,
    private val http: OkHttpClient = platformHttpClient(readTimeoutSeconds = 20),
) {
    suspend fun listAgents(refresh: Boolean): PlatformCatalogResult = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}$PLATFORM_AGENTS_PATH?refresh=$refresh"
        val response = authenticatedCall { token ->
            Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (!it.isSuccessful) throw nativeApiError(it.code, raw)
            val root = runCatching { JSONObject(raw) }
                .getOrElse { throw ApiException(0, "平台智能体目录返回了无效数据") }
            val capabilitiesObject = root.optJSONObject("capabilities")
            val features = root.optJSONArray("capabilities").stringSet() +
                capabilitiesObject?.optJSONArray("features").stringSet()
            val apiVersion = root.stringOrNull("api_version")
                ?: it.header("X-HAI-Native-API-Version")
                ?: it.header("X-OpenDrSai-API-Version")
            val rows = root.optJSONArray("agents")
                ?: root.optJSONObject("data")?.optJSONArray("agents")
                ?: JSONArray()
            val agents = (0 until rows.length()).mapNotNull { index ->
                rows.optJSONObject(index)?.toPlatformAgent()
            }
            PlatformCatalogResult(
                agents = agents,
                status = AgentCatalogStatus(
                    state = "ready",
                    message = "已连接 HAI 平台智能体",
                    apiVersion = apiVersion,
                    capabilities = features,
                ),
            )
        }
    }

    private suspend fun authenticatedCall(factory: (String) -> Request): Response {
        val initial = auth.current()
        var response = execute(factory(initial))
        if (response.code == 401) {
            val raw = response.body?.string().orEmpty()
            val code = nativeErrorCode(raw)
            response.close()
            if (code != "token_expired") throw nativeApiError(401, raw)
            val refreshed = auth.refreshAfter(initial)
                ?: throw ApiException(401, "HAI 登录已过期，请重新登录", retryable = false)
            response = execute(factory(refreshed))
        }
        return response
    }

    private fun execute(request: Request): Response = try {
        http.newCall(request).execute()
    } catch (error: IOException) {
        throw ApiException(0, error.message ?: "无法连接 HAI 平台")
    }
}

class AgentRepository(
    private val client: PlatformAgentClient,
    private val dao: ChatDao,
) {
    suspend fun load(userId: String, refresh: Boolean = false): PlatformCatalogResult {
        return try {
            val live = client.listAgents(refresh)
            dao.clearAgentCatalog(userId)
            dao.saveAgentCatalog(live.agents.map { it.toEntity(userId) })
            live
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            val cached = dao.agentCatalogSnapshot(userId).map(AgentCatalogEntity::toAgent)
            if (cached.isNotEmpty()) {
                PlatformCatalogResult(
                    cached,
                    AgentCatalogStatus(
                        state = "cached",
                        message = "平台暂时不可用，正在显示上次同步的智能体",
                        cached = true,
                    ),
                )
            } else {
                PlatformCatalogResult(
                    emptyList(),
                    AgentCatalogStatus(
                        state = if ((error as? ApiException)?.status == 403) "forbidden" else "error",
                        message = error.message ?: "无法加载平台智能体",
                    ),
                )
            }
        }
    }
}

class PlatformAgentRuntime(
    private val auth: AccessTokenCoordinator,
    private val dao: ChatDao,
    private val baseUrl: String = BuildConfig.HAI_BASE_URL,
    private val http: OkHttpClient = platformHttpClient(readTimeoutSeconds = 300),
) {
    private val activeCall = AtomicReference<okhttp3.Call?>()
    private val pausedRuns = ConcurrentHashMap.newKeySet<String>()
    private val stoppedRuns = ConcurrentHashMap.newKeySet<String>()

    fun pause(runId: String) {
        pausedRuns += runId
        activeCall.getAndSet(null)?.cancel()
    }

    fun stop(runId: String) {
        stoppedRuns += runId
        activeCall.getAndSet(null)?.cancel()
    }

    fun run(conversation: Conversation, input: String): Flow<RuntimeEvent> = channelFlow {
        val runId = UUID.randomUUID().toString()
        val worker = launch(Dispatchers.IO) {
            send(RuntimeEvent.Started(runId))
            dao.saveMessage(
                MessageEntity(
                    id = UUID.randomUUID().toString(),
                    conversationId = conversation.id,
                    role = "user",
                    content = input,
                ),
            )
            dao.updateConversation(conversation.id, conversation.title, System.currentTimeMillis())
            val assistantId = UUID.randomUUID().toString()
            val text = StringBuilder()
            try {
                val messages = remoteContext(dao.visibleMessageSnapshot(conversation.id))
                val body = JSONObject()
                    .put("messages", JSONArray(messages))
                    .put("stream", true)
                    .put("thread_id", conversation.id)
                    .put("run_id", runId)
                    .put("metadata", JSONObject().put("client", "android"))
                val platformId = conversation.agentId.removePrefix("platform:")
                val url = "${baseUrl.trimEnd('/')}$PLATFORM_AGENTS_PATH/${platformId.encodePathSegment()}/chat"
                val response = authenticatedStream { token ->
                    Request.Builder()
                        .url(url)
                        .header("Accept", "text/event-stream")
                        .header("Authorization", "Bearer $token")
                        .post(body.toString().toRequestBody("application/json".toMediaType()))
                        .build()
                }
                response.use {
                    if (!it.isSuccessful) throw nativeApiError(it.code, it.body?.string().orEmpty())
                    if (!it.header("Content-Type").orEmpty().startsWith("text/event-stream")) {
                        throw ApiException(502, "平台智能体返回了无效的流式响应")
                    }
                    val reader = it.body?.charStream() ?: throw ApiException(502, "平台智能体响应为空")
                    val parser = SseParser()
                    val chars = CharArray(2048)
                    var sawDone = false
                    while (!sawDone) {
                        val count = reader.read(chars)
                        if (count < 0) break
                        parser.feed(String(chars, 0, count)).forEach { event ->
                            if (event == "[DONE]") {
                                sawDone = true
                            } else {
                                val delta = nativeTextDelta(event)
                                if (delta.isNotEmpty()) {
                                    text.append(delta)
                                    dao.saveMessage(
                                        MessageEntity(
                                            id = assistantId,
                                            conversationId = conversation.id,
                                            role = "assistant",
                                            content = text.toString(),
                                            status = "streaming",
                                        ),
                                    )
                                    send(RuntimeEvent.TextDelta(delta))
                                }
                            }
                        }
                    }
                    if (!sawDone) throw ApiException(0, "平台智能体流在完成前中断")
                }
                if (text.isBlank()) throw ApiException(0, "平台智能体没有返回可显示内容")
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
            } catch (_: CancellationException) {
                val paused = runId in pausedRuns
                markAssistant(assistantId, conversation.id, text.toString(), if (paused) "paused" else "stopped")
                send(if (paused) RuntimeEvent.Paused else RuntimeEvent.Completed)
            } catch (error: Throwable) {
                val interrupted = runId in pausedRuns || runId in stoppedRuns
                if (interrupted) {
                    val paused = runId in pausedRuns
                    markAssistant(assistantId, conversation.id, text.toString(), if (paused) "paused" else "stopped")
                    send(if (paused) RuntimeEvent.Paused else RuntimeEvent.Completed)
                } else {
                    markAssistant(assistantId, conversation.id, text.toString(), "failed")
                    send(RuntimeEvent.Failed(error.message ?: "平台智能体运行失败", (error as? ApiException)?.retryable ?: true))
                }
            } finally {
                activeCall.set(null)
                pausedRuns -= runId
                stoppedRuns -= runId
                close()
            }
        }
        awaitClose {
            worker.cancel()
            activeCall.getAndSet(null)?.cancel()
        }
    }

    private suspend fun authenticatedStream(factory: (String) -> Request): Response {
        val initial = auth.current()
        var response = execute(factory(initial))
        if (response.code == 401) {
            val raw = response.body?.string().orEmpty()
            val code = nativeErrorCode(raw)
            response.close()
            if (code != "token_expired") throw nativeApiError(401, raw)
            val refreshed = auth.refreshAfter(initial)
                ?: throw ApiException(401, "HAI 登录已过期，请重新登录", retryable = false)
            response = execute(factory(refreshed))
        }
        return response
    }

    private fun execute(request: Request): Response {
        val call = http.newCall(request)
        activeCall.set(call)
        return try {
            call.execute()
        } catch (error: IOException) {
            throw ApiException(0, error.message ?: "平台智能体连接中断")
        }
    }

    private suspend fun markAssistant(id: String, conversationId: String, content: String, status: String) {
        if (content.isNotBlank()) {
            dao.saveMessage(MessageEntity(id, conversationId, "assistant", content, status = status))
        }
    }
}

private fun JSONObject.toPlatformAgent(): Agent? {
    val rawId = stringOrNull("id") ?: return null
    val name = stringOrNull("name") ?: return null
    if (rawId.startsWith("hai.native.")) return null
    val capabilitiesObject = optJSONObject("capabilities")
    val capabilities = optJSONArray("capabilities").stringSet() +
        (capabilitiesObject?.keys()?.asSequence()
            ?.filter { key -> capabilitiesObject.opt(key) == true }
            ?.toSet() ?: emptySet())
    val available = when {
        has("available") -> optBoolean("available", false)
        optString("status") in setOf("offline", "disabled", "unreachable") -> false
        optString("availability") == "unavailable" -> false
        else -> true
    }
    val chat = "chat" in capabilities
    return Agent(
        id = "platform:$rawId",
        platformId = rawId,
        name = name,
        description = stringOrNull("description").orEmpty(),
        source = "platform",
        mode = optString("mode", "remote"),
        available = available,
        chatSupported = available && chat,
        isDefault = optBoolean("is_default", false),
        owner = stringOrNull("owner") ?: stringOrNull("author"),
        capabilities = capabilities,
        logoUrl = stringOrNull("logo"),
        examples = optJSONArray("examples").exampleList(),
    )
}

private fun Agent.toEntity(userId: String) = AgentCatalogEntity(
    id = id,
    userId = userId,
    platformId = platformId.orEmpty(),
    name = name,
    description = description,
    mode = mode,
    available = available,
    chatSupported = chatSupported,
    isDefault = isDefault,
    owner = owner,
    capabilitiesJson = JSONArray(capabilities.toList()).toString(),
    logoUrl = logoUrl,
    examplesJson = JSONArray(examples).toString(),
    savedAt = System.currentTimeMillis(),
)

private fun AgentCatalogEntity.toAgent() = Agent(
    id = id,
    platformId = platformId,
    name = name,
    description = description,
    source = "platform",
    mode = mode,
    available = available,
    chatSupported = chatSupported,
    isDefault = isDefault,
    owner = owner,
    capabilities = runCatching { JSONArray(capabilitiesJson).stringSet() }.getOrDefault(emptySet()),
    logoUrl = logoUrl,
    examples = runCatching { JSONArray(examplesJson).stringList() }.getOrDefault(emptyList()),
)

private fun remoteContext(items: List<MessageEntity>): List<JSONObject> {
    val selected = mutableListOf<Pair<MessageEntity, String>>()
    var chars = 0
    for (item in items.asReversed()) {
        if (selected.size >= MAX_REMOTE_CONTEXT_MESSAGES) break
        if (item.role !in setOf("user", "assistant")) continue
        val content = item.content.takeLast(MAX_REMOTE_MESSAGE_CHARS)
        if (chars + content.length > MAX_REMOTE_CONTEXT_CHARS) break
        selected += item to content
        chars += content.length
    }
    return selected.asReversed().map { (item, content) ->
        JSONObject().put("role", item.role).put("content", content)
    }
}

internal fun nativeTextDelta(raw: String): String {
    val root = runCatching { JSONObject(raw) }
        .getOrElse { throw ApiException(502, "平台智能体返回了无效流数据") }
    root.optJSONObject("error")?.let { error ->
        throw ApiException(502, error.optString("message", "平台智能体流返回错误"))
    }
    return root.optJSONArray("choices")
        ?.optJSONObject(0)
        ?.optJSONObject("delta")
        ?.stringOrNull("content")
        .orEmpty()
}

internal fun nativeApiError(status: Int, raw: String): ApiException {
    val code = nativeErrorCode(raw)
    val message = when (code) {
        "token_expired", "invalid_token" -> "HAI 登录已过期，请重新登录"
        "native_access_forbidden", "agent_forbidden" -> "当前账号没有使用该智能体的权限"
        "agent_not_found" -> "选择的智能体已不可用，请刷新列表"
        "agent_chat_unsupported" -> "该智能体暂不支持 Android 对话"
        "agent_credentials_unavailable" -> "平台尚未准备好该智能体的运行凭据"
        "agent_credentials_invalid" -> "平台智能体运行凭据无效，请联系管理员"
        "quota_exceeded" -> "智能体额度已用尽，请稍后重试"
        "catalog_unavailable" -> "HAI 智能体目录暂时不可用"
        else -> when (status) {
            401 -> "HAI 登录已过期，请重新登录"
            403 -> "当前账号没有使用平台智能体的权限"
            404 -> "平台智能体接口不可用"
            409 -> "该智能体暂不支持对话"
            429 -> "请求过于频繁或额度不足"
            in 500..599 -> "HAI 平台智能体服务暂时不可用"
            else -> "平台智能体请求失败（HTTP $status）"
        }
    }
    return ApiException(status, message, status == 0 || status == 408 || status == 429 || status >= 500)
}

internal fun nativeErrorCode(raw: String): String {
    val root = runCatching { JSONObject(raw) }.getOrNull() ?: return ""
    val detail = root.optJSONObject("detail")
    return detail?.optString("code").orEmpty().ifBlank {
        root.optJSONObject("error")?.optString("code").orEmpty()
    }
}

private fun JSONArray?.stringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }
}

private fun JSONArray?.stringSet(): Set<String> = stringList().toSet()

private fun JSONArray?.exampleList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index ->
        when (val item = opt(index)) {
            is String -> item.takeIf(String::isNotBlank)
            is JSONObject -> item.stringOrNull("zh") ?: item.stringOrNull("en")
            else -> null
        }
    }
}

private fun JSONObject.stringOrNull(name: String): String? = optString(name)
    .takeUnless { it.isBlank() || it == "null" }

private fun String.encodePathSegment(): String = java.net.URLEncoder.encode(this, Charsets.UTF_8.name())
    .replace("+", "%20")

private fun platformHttpClient(readTimeoutSeconds: Long) = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(readTimeoutSeconds, TimeUnit.SECONDS)
    .callTimeout(readTimeoutSeconds + 15, TimeUnit.SECONDS)
    .followRedirects(false)
    .followSslRedirects(false)
    .build()
