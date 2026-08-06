package ai.drsai.remote.data

import ai.drsai.remote.BuildConfig
import ai.drsai.remote.runtime.python.ModelRuntimeCapabilities
import ai.drsai.remote.runtime.security.SensitiveDataRedactor
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
    val code: String? = null,
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

interface ToolChoiceAwareModelGateway {
    suspend fun streamCompletionWithToolChoice(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
    )
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
    private val providerStore: ModelConfigurationResolver? = null,
    private val requestTemperature: Double? = null,
) : ModelGateway, ToolChoiceAwareModelGateway, PinnedModelRouteGateway {
    init {
        require(requestTemperature == null || requestTemperature in 0.0..2.0) {
            "model_temperature_invalid"
        }
    }

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
                    ModelInfo(
                        id,
                        name,
                        modelSupportsVision(row, id, name),
                        modelSupportsTools(row, id, name),
                    )
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
    ) {
        require(!toolsEnabled) { "model_tool_schemas_required" }
        streamCompletionInternal(model, messages, null, ModelToolChoiceProtocolAdapter.none(), onDelta)
    }

    override suspend fun pinModelRoute(modelId: String): JSONObject {
        val configured = providerStore?.resolveModel(modelId)
        if (configured == null) {
            if (tokens.accessToken.isNullOrBlank()) throw ApiException(
                401, "model_provider_credentials_missing:hepai", retryable = false,
                code = "model_provider_credentials_missing",
            )
            return PinnedModelRoute.create(modelId, "hepai", modelId, baseUrl, "openai", 0, "oidc")
        }
        val (provider, model) = configured
        if (providerStore.apiKey(provider.id).isNullOrBlank()) throw ApiException(
            401, "model_provider_credentials_missing:${provider.id}", retryable = false,
            code = "model_provider_credentials_missing",
        )
        return PinnedModelRoute.create(
            modelId, provider.id, model.upstreamId, provider.baseUrl, provider.wireApi, provider.revision, "api_key",
        )
    }

    override suspend fun streamCompletionWithTools(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletionInternal(model, messages, tools, ModelToolChoiceProtocolAdapter.automatic(), onDelta)

    override suspend fun streamCompletionWithToolChoice(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletionInternal(model, messages, tools, toolChoice, onDelta)

    override suspend fun streamCompletionWithPinnedRoute(
        modelId: String,
        route: JSONObject,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
    ) = streamCompletionInternal(modelId, messages, tools, toolChoice, onDelta, route)

    private suspend fun streamCompletionInternal(
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray?,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
        pinnedRoute: JSONObject? = null,
    ) = withContext(Dispatchers.IO) {
        val validatedRoute = pinnedRoute?.let { PinnedModelRoute.validate(it, model) }
        val customConfiguration = if (validatedRoute == null) providerStore?.resolveModel(model) else null
        val customProvider = when {
            validatedRoute == null -> customConfiguration?.first
            validatedRoute.getString("provider_id") == "hepai" -> null
            else -> ModelProviderEntity(
                validatedRoute.getString("provider_id"), null, validatedRoute.getString("provider_id"),
                validatedRoute.getString("base_url"), validatedRoute.getString("wire_api"),
                false, true, validatedRoute.getLong("provider_revision"), 0, 0,
            )
        }
        val upstreamModel = validatedRoute?.getString("upstream_model_id")
            ?: customConfiguration?.second?.upstreamId ?: model
        if (customProvider?.wireApi == "anthropic") {
            streamAnthropic(customProvider, upstreamModel, messages, tools, toolChoice, onDelta)
            return@withContext
        }
        val providerCapabilities = ModelRuntimeCapabilities(
            model, "openai", tools = tools != null && tools.length() > 0, parallelTools = false,
            reasoning = false, source = "configured",
        )
        val wireTools = tools?.let { ModelToolSchemaProtocolAdapter.adapt(providerCapabilities, it) }
        val body = JSONObject()
            .put("model", upstreamModel)
            .put("messages", JSONArray(messages.map(::messageJson)))
            .put("stream", true)
            .put("max_tokens", 2048)
        if (requestTemperature != null) body.put("temperature", requestTemperature)
        if (wireTools != null && wireTools.length() > 0) {
            body.put("tools", wireTools)
            body.put("tool_choice", ModelToolChoiceProtocolAdapter.openAi(toolChoice))
        }
        val requestFactory: (String, String) -> Request = { endpoint, token -> Request.Builder()
                .url("${endpoint.trimEnd('/')}/chat/completions")
                .header("Accept", "text/event-stream")
                .header("Authorization", "Bearer $token")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
        }
        val response = if (customProvider == null) {
            authenticatedResponse { token -> requestFactory(baseUrl, token) }
        } else {
            val apiKey = providerStore?.apiKey(customProvider.id)
                ?: throw ApiException(
                    401, "model_provider_credentials_missing:${customProvider.id}", retryable = false,
                    code = "model_provider_credentials_missing",
                )
            executeProviderRequest(
                customProvider,
                upstreamModel,
                requestFactory(customProvider.baseUrl, apiKey),
            )
        }
        response.use {
            if (!it.isSuccessful) throw responseError(
                it.code, it.body?.string().orEmpty(), customProvider, upstreamModel,
                toolSchemaRequest = wireTools != null && wireTools.length() > 0,
            )
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

    private suspend fun executeProviderRequest(
        provider: ModelProviderEntity,
        model: String,
        request: Request,
    ): Response {
        val host = request.url.host
        runCatching {
            Log.i(
                "HaiModelClient",
                "provider_request provider=${provider.displayName.take(80)} protocol=${provider.wireApi} host=$host model=${model.take(120)}",
            )
        }
        var response = execute(request)
        if (response.code !in setOf(502, 503, 504)) return response
        val firstStatus = response.code
        response.close()
        runCatching {
            Log.w(
                "HaiModelClient",
                "provider_request_retry provider=${provider.displayName.take(80)} host=$host model=${model.take(120)} status=$firstStatus",
            )
        }
        delay(750)
        response = execute(request)
        return response
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

    private fun responseError(
        status: Int,
        raw: String,
        provider: ModelProviderEntity? = null,
        upstreamModel: String? = null,
        toolSchemaRequest: Boolean = false,
    ): ApiException {
        val json = runCatching { JSONObject(raw) }.getOrNull()
        val detail = json?.optJSONObject("error")?.stringOrNull("message")
            ?: json?.stringOrNull("detail")
            ?: json?.stringOrNull("message")
        val safeDetail = SensitiveDataRedactor.redact(detail.orEmpty()).take(240)
        runCatching {
            Log.w(
                "HaiModelClient",
                "model_request_failed status=$status detail=$safeDetail",
            )
        }
        val imageUnsupported = status == 400 && (
            raw.contains("unknown variant `image_url`", ignoreCase = true) ||
                raw.contains("unknown variant 'image_url'", ignoreCase = true) ||
                (raw.contains("image_url", ignoreCase = true) && raw.contains("expected `text`", ignoreCase = true))
            )
        val providerName = provider?.displayName?.trim()?.take(80).orEmpty().ifBlank { "HAI" }
        val host = provider?.baseUrl?.let { value -> runCatching { java.net.URI(value).host }.getOrNull() }
        val route = listOfNotNull(host, upstreamModel?.takeIf(String::isNotBlank)).joinToString(" · ")
        val routeSuffix = route.takeIf(String::isNotBlank)?.let { "（$it）" }.orEmpty()
        val schemaRejected = status == 400 && toolSchemaRequest && listOf(
            "schema", "input_schema", "tools", "tool_choice", "function",
        ).any { raw.contains(it, ignoreCase = true) }
        val message = when {
            imageUnsupported -> "当前 $providerName 模型不支持图片输入，请切换到视觉模型"
            schemaRejected -> "$providerName 不接受当前工具 Schema$routeSuffix"
            status == 401 && provider == null -> "HAI 登录已过期，请重新登录"
            status == 401 -> "$providerName API Key 无效或已过期"
            status == 403 -> "$providerName 拒绝访问当前模型"
            status == 404 -> "$providerName 未提供请求的模型$routeSuffix"
            status == 429 -> "模型请求过于频繁或额度不足，请稍后重试"
            status in 500..599 -> "$providerName 模型服务暂时不可用（HTTP $status）$routeSuffix"
            else -> safeDetail.takeIf(String::isNotBlank) ?: "模型请求失败（HTTP $status）"
        }
        return ApiException(
            status,
            message,
            retryable = !imageUnsupported && !schemaRejected && (status == 408 || status == 429 || status >= 500),
            code = if (schemaRejected) "model_tool_schema_rejected" else null,
        )
    }

    private fun parseDelta(raw: String): ModelDelta {
        val root = runCatching { JSONObject(raw) }.getOrElse { throw ApiException(0, "模型返回了无效流数据") }
        root.optJSONObject("error")?.let {
            throw ApiException(0, SensitiveDataRedactor.redact(it.optString("message", "模型流返回错误")))
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
                    name = function.stringOrNull("name")?.takeIf(String::isNotBlank)?.let(::fromHaiToolName),
                    arguments = function.stringOrNull("arguments").orEmpty(),
                )
            },
            finishReason = choice.stringOrNull("finish_reason")?.takeIf(String::isNotBlank),
            // Only the provider's explicit public summary channel is accepted. Never expose reasoning_content/CoT.
            reasoningSummary = delta.stringOrNull("reasoning_summary")?.takeIf(String::isNotBlank),
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
                    .put("function", JSONObject().put("name", toHaiToolName(call.name)).put("arguments", call.arguments))
            }))
        }
        return json
    }

private fun JSONObject.stringOrNull(name: String): String? {
    if (!has(name) || isNull(name)) return null
    return opt(name) as? String
}

    private suspend fun streamAnthropic(
        provider: ModelProviderEntity,
        model: String,
        messages: List<RuntimeMessage>,
        tools: JSONArray?,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
    ) {
        val apiKey = providerStore?.apiKey(provider.id)
            ?: throw ApiException(
                401, "model_provider_credentials_missing:${provider.id}", retryable = false,
                code = "model_provider_credentials_missing",
            )
        val system = messages.filter { it.role == "system" }.joinToString("\n\n") { it.content }
        val body = JSONObject()
            .put("model", model)
            .put("messages", JSONArray(messages.filterNot { it.role == "system" }.map(::anthropicMessageJson)))
            .put("stream", true)
            .put("max_tokens", 2048)
        if (requestTemperature != null) body.put("temperature", requestTemperature)
        if (system.isNotBlank()) body.put("system", system)
        val providerCapabilities = ModelRuntimeCapabilities(
            model, "anthropic", tools = tools != null && tools.length() > 0, parallelTools = false,
            reasoning = false, source = "configured",
        )
        val wireTools = tools?.let { ModelToolSchemaProtocolAdapter.adapt(providerCapabilities, it) }
        val anthropicChoice = ModelToolChoiceProtocolAdapter.anthropic(toolChoice)
        if (wireTools != null && wireTools.length() > 0 && anthropicChoice != null) {
            body.put("tools", wireTools)
            body.put("tool_choice", anthropicChoice)
        }
        val endpoint = if (provider.baseUrl.trimEnd('/').endsWith("/v1")) {
            "${provider.baseUrl.trimEnd('/')}/messages"
        } else "${provider.baseUrl.trimEnd('/')}/v1/messages"
        val request = Request.Builder().url(endpoint)
                .header("Accept", "text/event-stream")
                .header("x-api-key", apiKey)
                .header("anthropic-version", "2023-06-01")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build()
        val response = executeProviderRequest(provider, model, request)
        response.use {
            if (!it.isSuccessful) throw responseError(
                it.code, it.body?.string().orEmpty(), provider, model,
                toolSchemaRequest = wireTools != null && wireTools.length() > 0,
            )
            val reader = it.body?.charStream() ?: throw ApiException(0, "模型响应为空")
            val parser = SseParser()
            val chars = CharArray(2048)
            var completed = false
            while (!completed) {
                val count = reader.read(chars)
                if (count < 0) break
                parser.feed(String(chars, 0, count)).forEach { event ->
                    val delta = parseAnthropicDelta(event)
                    if (delta.finishReason == "message_stop") completed = true else onDelta(delta)
                }
            }
            if (!completed) parser.finish().forEach { event ->
                val delta = parseAnthropicDelta(event)
                if (delta.finishReason == "message_stop") completed = true else onDelta(delta)
            }
            if (!completed) throw ApiException(0, "模型流在完成前中断")
        }
    }

    private fun anthropicMessageJson(message: RuntimeMessage): JSONObject {
        if (message.role == "tool") {
            return JSONObject().put("role", "user").put("content", JSONArray().put(
                JSONObject().put("type", "tool_result").put("tool_use_id", message.toolCallId).put("content", message.content),
            ))
        }
        val content = JSONArray()
        if (message.content.isNotBlank()) content.put(JSONObject().put("type", "text").put("text", message.content))
        message.images.forEach { image ->
            val encoded = image.dataUrl.substringAfter("base64,", "")
            if (encoded.isNotBlank()) content.put(JSONObject().put("type", "image").put("source", JSONObject()
                .put("type", "base64").put("media_type", image.mimeType).put("data", encoded)))
        }
        message.toolCalls.forEach { call ->
            content.put(JSONObject().put("type", "tool_use").put("id", call.id).put("name", toHaiToolName(call.name))
                .put("input", runCatching { JSONObject(call.arguments) }.getOrDefault(JSONObject())))
        }
        return JSONObject().put("role", if (message.role == "assistant") "assistant" else "user")
            .put("content", if (content.length() == 0) JSONArray().put(JSONObject().put("type", "text").put("text", " ")) else content)
    }

    private fun parseAnthropicDelta(raw: String): ModelDelta {
        val root = runCatching { JSONObject(raw) }.getOrElse { throw ApiException(0, "模型返回了无效流数据") }
        root.optJSONObject("error")?.let { throw ApiException(0, it.optString("message", "模型流返回错误")) }
        return when (root.optString("type")) {
            "content_block_start" -> {
                val block = root.optJSONObject("content_block") ?: JSONObject()
                if (block.optString("type") == "tool_use") ModelDelta(null, listOf(ToolCallDelta(root.optInt("index"), block.optString("id"), fromHaiToolName(block.optString("name")), "")), null)
                else ModelDelta(null, emptyList(), null)
            }
            "content_block_delta" -> {
                val delta = root.optJSONObject("delta") ?: JSONObject()
                when (delta.optString("type")) {
                    "text_delta" -> ModelDelta(delta.optString("text").takeIf(String::isNotEmpty), emptyList(), null)
                    "input_json_delta" -> ModelDelta(null, listOf(ToolCallDelta(root.optInt("index"), null, null, delta.optString("partial_json"))), null)
                    else -> ModelDelta(null, emptyList(), null)
                }
            }
            "message_delta" -> ModelDelta(null, emptyList(), root.optJSONObject("delta")?.optString("stop_reason")?.takeIf(String::isNotBlank))
            "message_stop" -> ModelDelta(null, emptyList(), "message_stop")
            else -> ModelDelta(null, emptyList(), null)
        }
    }
}

internal fun toHaiToolName(canonical: String): String = canonical.replace(".", "__dot__")

internal fun fromHaiToolName(wire: String): String = wire.replace("__dot__", ".")

internal fun selectPreferredModel(models: List<ModelInfo>): ModelInfo {
    if (models.isEmpty()) throw ApiException(404, "当前 HAI 账号没有可用模型", retryable = false)
    return models.firstOrNull(ModelInfo::tools)
        ?: models.firstOrNull { it.id == "deepseek-ai/deepseek-v4-pro" }
        ?: models.firstOrNull { it.id.contains("deepseek-v4-pro", ignoreCase = true) }
        ?: models.first()
}

internal fun selectVisionModel(models: List<ModelInfo>, preferred: ModelInfo? = null): ModelInfo? =
    preferred?.takeIf(ModelInfo::vision) ?: models.firstOrNull(ModelInfo::vision)

internal fun modelSupportsTools(row: JSONObject, id: String, name: String): Boolean {
    fun explicit(container: JSONObject?): Boolean? {
        if (container == null) return null
        listOf("tools", "tool_calling", "supports_tools", "function_calling").forEach { key ->
            if (container.has(key) && !container.isNull(key)) return container.optBoolean(key)
        }
        val capabilities = container.optJSONArray("capabilities") ?: return null
        return (0 until capabilities.length()).any { index ->
            capabilities.optString(index).lowercase() in setOf("tools", "tool_calling", "function_calling")
        }
    }
    explicit(row)?.let { return it }
    explicit(row.optJSONObject("model_info"))?.let { return it }
    val value = "$id $name".lowercase()
    if ("deepseek" in value) return false
    return listOf("gpt-4", "gpt-5", "qwen", "claude", "gemini", "glm-4", "glm-5").any(value::contains)
}

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
