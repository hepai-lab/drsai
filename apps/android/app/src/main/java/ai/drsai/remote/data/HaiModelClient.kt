package ai.drsai.remote.data

import ai.drsai.remote.BuildConfig
import kotlinx.coroutines.Dispatchers
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
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class ApiException(
    val status: Int,
    override val message: String,
    val retryable: Boolean = status == 0 || status == 408 || status == 429 || status >= 500,
) : Exception(message)

internal class SseParser {
    private var buffer = ""
    private val dataLines = mutableListOf<String>()

    fun feed(chunk: String): List<String> {
        buffer += chunk
        val events = mutableListOf<String>()
        while (true) {
            val newline = buffer.indexOf('\n')
            if (newline < 0) break
            val line = buffer.substring(0, newline).removeSuffix("\r")
            buffer = buffer.substring(newline + 1)
            consume(line)?.let(events::add)
        }
        return events
    }

    fun finish(): List<String> {
        val events = mutableListOf<String>()
        if (buffer.isNotEmpty()) consume(buffer.removeSuffix("\r"))?.let(events::add)
        buffer = ""
        if (dataLines.isNotEmpty()) {
            events += dataLines.joinToString("\n")
            dataLines.clear()
        }
        return events
    }

    private fun consume(line: String): String? {
        if (line.isEmpty()) {
            if (dataLines.isEmpty()) return null
            return dataLines.joinToString("\n").also { dataLines.clear() }
        }
        if (line.startsWith("data:")) dataLines += line.removePrefix("data:").removePrefix(" ")
        return null
    }
}

interface ModelGateway {
    suspend fun listModels(): List<ModelInfo>
    fun selectModel(models: List<ModelInfo>): ModelInfo
    suspend fun streamCompletion(
        model: String,
        messages: List<RuntimeMessage>,
        toolsEnabled: Boolean,
        onDelta: suspend (ModelDelta) -> Unit,
    )
    suspend fun streamCompletionWithTools(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletion(model, messages, tools.length() > 0, onDelta)
    fun cancelActive()
    suspend fun logout()
}

class HaiModelClient(
    private val tokens: AuthTokenStore,
    private val oidc: TokenLifecycleClient,
    private val baseUrl: String = BuildConfig.MODEL_BASE_URL,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .callTimeout(5, TimeUnit.MINUTES)
        .build(),
    private val availableToolNames: () -> Set<String> = { BASE_LOCAL_TOOL_NAMES },
) : ModelGateway {
    private val refreshMutex = Mutex()
    private val activeCall = AtomicReference<okhttp3.Call?>()
    private val activeResponse = AtomicReference<Response?>()

    override fun cancelActive() {
        activeCall.getAndSet(null)?.cancel()
        activeResponse.getAndSet(null)?.close()
    }

    override suspend fun listModels(): List<ModelInfo> = withContext(Dispatchers.IO) {
        val response = authenticatedResponse { token ->
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/models")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        }
        response.use {
            val raw = it.body?.string().orEmpty()
            if (!it.isSuccessful) throw responseError(it.code, raw)
            val items = JSONObject(raw).optJSONArray("data") ?: JSONArray()
            (0 until items.length()).mapNotNull { index ->
                val row = items.optJSONObject(index) ?: return@mapNotNull null
                row.optString("id").takeIf(String::isNotBlank)?.let { id ->
                    val name = row.stringOrNull("name").orEmpty().ifBlank { id }
                    ModelInfo(id, name, modelSupportsVision(row, id, name))
                }
            }
        }
    }

    override fun selectModel(models: List<ModelInfo>): ModelInfo = selectPreferredModel(models)

    override suspend fun streamCompletion(
        model: String,
        messages: List<RuntimeMessage>,
        toolsEnabled: Boolean,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletionInternal(
        model, messages, if (toolsEnabled) toolDefinitions(availableToolNames()) else null, onDelta,
    )

    override suspend fun streamCompletionWithTools(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletionInternal(model, messages, tools.toHaiToolDefinitions(), onDelta)

    private suspend fun streamCompletionInternal(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray?,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("model", model)
            .put("messages", JSONArray(messages.map(::messageJson)))
            .put("stream", true)
            .put("max_tokens", 2048)
        if (tools != null && tools.length() > 0) {
            body.put("tools", tools)
            body.put("tool_choice", "auto")
        }
        val response = authenticatedResponse { token ->
            Request.Builder()
                .url("${baseUrl.trimEnd('/')}/chat/completions")
                .header("Accept", "text/event-stream")
                .header("Authorization", "Bearer $token")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
        }
        response.use {
            if (!it.isSuccessful) throw responseError(it.code, it.body?.string().orEmpty())
            val reader = it.body?.charStream() ?: throw ApiException(0, "模型响应为空")
            val parser = SseParser()
            val chars = CharArray(2048)
            var sawDone = false
            while (true) {
                val count = reader.read(chars)
                if (count < 0) break
                parser.feed(String(chars, 0, count)).forEach { event ->
                    if (event == "[DONE]") sawDone = true else onDelta(parseDelta(event))
                }
                if (sawDone) break
            }
            if (!sawDone) {
                parser.finish().forEach { event ->
                    if (event == "[DONE]") sawDone = true else onDelta(parseDelta(event))
                }
            }
            if (!sawDone) throw ApiException(0, "模型流在完成前中断")
        }
    }

    override suspend fun logout() {
        tokens.refreshToken?.let { oidc.revoke(it) }
    }

    private suspend fun authenticatedResponse(factory: (String) -> Request): Response {
        val initial = tokens.accessToken ?: throw ApiException(401, "请先登录", retryable = false)
        var response = execute(factory(initial))
        if (response.code == 401 && refresh(initial)) {
            response.close()
            response = execute(factory(tokens.accessToken ?: initial))
        }
        return response
    }

    private suspend fun execute(request: Request): Response = withContext(Dispatchers.IO) {
        val call = http.newCall(request)
        activeCall.set(call)
        try {
            call.execute().also { activeResponse.set(it) }
        } catch (error: IOException) {
            throw ApiException(0, error.message ?: "网络连接失败")
        } finally {
            activeCall.compareAndSet(call, null)
        }
    }

    private suspend fun refresh(failedToken: String): Boolean = refreshMutex.withLock {
        if (tokens.accessToken != failedToken) return@withLock true
        val refreshToken = tokens.refreshToken ?: return@withLock false
        runCatching {
            val auth = oidc.refresh(refreshToken)
            tokens.save(auth)
            true
        }.getOrDefault(false)
    }

    private fun responseError(status: Int, raw: String): ApiException {
        val json = runCatching { JSONObject(raw) }.getOrNull()
        val detail = json?.optJSONObject("error")?.stringOrNull("message")
            ?: json?.stringOrNull("detail")
            ?: json?.stringOrNull("message")
        val imageUnsupported = status == 400 && (
            raw.contains("unknown variant `image_url`", ignoreCase = true) ||
                raw.contains("unknown variant 'image_url'", ignoreCase = true) ||
                (raw.contains("image_url", ignoreCase = true) && raw.contains("expected `text`", ignoreCase = true))
            )
        val message = when {
            imageUnsupported -> "当前 HAI 模型不支持图片输入，请切换到视觉模型"
            status == 401 -> "HAI 登录已过期，请重新登录"
            status == 403 -> "当前账号没有使用该模型的权限"
            status == 404 -> "请求的 HAI 模型不可用"
            status == 429 -> "模型请求过于频繁或额度不足，请稍后重试"
            status in 500..599 -> "HAI 模型服务暂时不可用"
            else -> detail?.takeIf(String::isNotBlank) ?: "模型请求失败（HTTP $status）"
        }
        return ApiException(status, message, retryable = !imageUnsupported && (status == 408 || status == 429 || status >= 500))
    }

    private fun parseDelta(raw: String): ModelDelta {
        val root = runCatching { JSONObject(raw) }.getOrElse { throw ApiException(0, "模型返回了无效流数据") }
        root.optJSONObject("error")?.let {
            throw ApiException(0, it.optString("message", "模型流返回错误"))
        }
        val choice = root.optJSONArray("choices")?.optJSONObject(0)
            ?: return ModelDelta(null, emptyList(), null)
        val delta = choice.optJSONObject("delta") ?: JSONObject()
        val calls = delta.optJSONArray("tool_calls") ?: JSONArray()
        return ModelDelta(
            content = delta.stringOrNull("content")?.takeIf(String::isNotEmpty),
            toolCalls = (0 until calls.length()).mapNotNull { index ->
                val item = calls.optJSONObject(index) ?: return@mapNotNull null
                val function = item.optJSONObject("function") ?: JSONObject()
                ToolCallDelta(
                    index = item.optInt("index", index),
                    id = item.stringOrNull("id")?.takeIf(String::isNotBlank),
                    name = function.stringOrNull("name")?.takeIf(String::isNotBlank),
                    arguments = function.stringOrNull("arguments").orEmpty(),
                )
            },
            finishReason = choice.stringOrNull("finish_reason")?.takeIf(String::isNotBlank),
        )
    }

    private fun messageJson(message: RuntimeMessage): JSONObject {
        val json = JSONObject().put("role", message.role)
        if (message.role == "tool") {
            json.put("content", message.content).put("tool_call_id", message.toolCallId)
        } else if (message.images.isNotEmpty()) {
            val content = JSONArray().put(JSONObject().put("type", "text").put("text", message.content))
            message.images.forEach { image ->
                content.put(
                    JSONObject().put("type", "image_url").put(
                        "image_url",
                        JSONObject().put("url", image.dataUrl),
                    ),
                )
            }
            json.put("content", content)
        } else {
            json.put("content", message.content)
        }
        if (message.toolCalls.isNotEmpty()) {
            json.put("tool_calls", JSONArray(message.toolCalls.map { call ->
                JSONObject()
                    .put("id", call.id)
                    .put("type", "function")
                    .put("function", JSONObject().put("name", call.name).put("arguments", call.arguments))
            }))
        }
        return json
    }

    private fun toolDefinitions(available: Set<String>) = JSONArray(listOf(
        tool("get_current_time", "Get the current device time and timezone", JSONObject().put("type", "object").put("properties", JSONObject())),
        tool("get_device_info", "Get non-identifying Android environment information", JSONObject().put("type", "object").put("properties", JSONObject())),
        tool("save_memory", "Save a short fact the user explicitly wants remembered", JSONObject()
            .put("type", "object")
            .put("properties", JSONObject().put("content", JSONObject().put("type", "string").put("maxLength", 500)))
            .put("required", JSONArray().put("content"))),
        tool("search_memory", "Search facts previously saved for this user", JSONObject()
            .put("type", "object")
            .put("properties", JSONObject()
                .put("query", JSONObject().put("type", "string").put("maxLength", 100))
                .put("limit", JSONObject().put("type", "integer").put("minimum", 1).put("maximum", 10)))
            .put("required", JSONArray().put("query"))),
        tool("workspace.list", "List files in the user-granted workspace", JSONObject()
            .put("type", "object").put("properties", JSONObject().put("path", JSONObject().put("type", "string")))),
        tool("workspace.read", "Read a text file in the user-granted workspace", JSONObject()
            .put("type", "object").put("properties", JSONObject().put("path", JSONObject().put("type", "string")))
            .put("required", JSONArray().put("path"))),
        tool("workspace.search", "Search file names in the user-granted workspace", JSONObject()
            .put("type", "object").put("properties", JSONObject().put("query", JSONObject().put("type", "string")))
            .put("required", JSONArray().put("query"))),
        tool("workspace.write", "Write a file in the user-granted workspace after approval", JSONObject()
            .put("type", "object").put("properties", JSONObject()
                .put("path", JSONObject().put("type", "string"))
                .put("content", JSONObject().put("type", "string")))
            .put("required", JSONArray().put("path").put("content"))),
    ).filter { it.optJSONObject("function")?.optString("name") in available })

    private fun tool(name: String, description: String, parameters: JSONObject) = JSONObject()
        .put("type", "function")
        .put("function", JSONObject().put("name", name).put("description", description).put("parameters", parameters))
}

private fun JSONObject.stringOrNull(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return opt(name) as? String
}

private fun JSONArray.toHaiToolDefinitions(): JSONArray = JSONArray().also { output ->
    repeat(length()) { index ->
        val source = getJSONObject(index)
        if (source.optString("type") == "function" && source.optJSONObject("function") != null) {
            output.put(source)
        } else {
            val name = source.getString("name")
            val parameters = source.optJSONObject("parameters")
                ?: JSONObject().put("type", "object").put("properties", JSONObject())
            output.put(
                JSONObject().put("type", "function").put(
                    "function",
                    JSONObject().put("name", name)
                        .put("description", source.optString("description", name))
                        .put("parameters", parameters),
                )
            )
        }
    }
}

internal fun selectPreferredModel(models: List<ModelInfo>): ModelInfo {
    if (models.isEmpty()) throw ApiException(404, "当前 HAI 账号没有可用模型", retryable = false)
    return models.firstOrNull { it.id == "deepseek-ai/deepseek-v4-pro" }
        ?: models.firstOrNull { it.id.contains("deepseek-v4-pro", ignoreCase = true) }
        ?: models.first()
}

private val BASE_LOCAL_TOOL_NAMES = setOf(
    "get_current_time", "get_device_info", "save_memory", "search_memory",
)

internal fun selectVisionModel(models: List<ModelInfo>, preferred: ModelInfo? = null): ModelInfo? =
    preferred?.takeIf(ModelInfo::vision) ?: models.firstOrNull(ModelInfo::vision)

internal fun modelSupportsVision(row: JSONObject, id: String, name: String): Boolean {
    fun explicit(container: JSONObject?): Boolean? {
        if (container == null) return null
        if (container.has("vision") && !container.isNull("vision")) return container.optBoolean("vision")
        if (container.has("multimodal") && !container.isNull("multimodal")) return container.optBoolean("multimodal")
        return null
    }
    explicit(row)?.let { return it }
    explicit(row.optJSONObject("model_info"))?.let { return it }
    explicit(row.optJSONObject("capabilities"))?.let { return it }
    val modalities = sequenceOf(
        row.optJSONArray("input_modalities"),
        row.optJSONObject("architecture")?.optJSONArray("input_modalities"),
        row.optJSONObject("model_info")?.optJSONArray("input_modalities"),
    ).filterNotNull().flatMap { array -> (0 until array.length()).asSequence().map { array.optString(it) } }
        .map(String::lowercase).toSet()
    if (modalities.isNotEmpty()) return modalities.any { it in setOf("image", "images", "vision") }

    val value = "$id $name".lowercase()
    if (listOf("deepseek", "gpt-3.5", "gpt-35", "o1-mini", "o1-preview", "minimax").any(value::contains)) return false
    return listOf(
        "vision", "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl", "internvl", "deepseek-vl",
        "glm-4v", "glm-5", "gpt-4o", "gpt-4.1", "gpt-5", "claude", "gemini", "pixtral", "llava",
    ).any(value::contains)
}
