package ai.drsai.remote.runtime.tools

import ai.drsai.remote.workbench.model.RuntimeCapability
import java.net.InetAddress
import java.net.URI
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

const val ANDROID_MCP_PROTOCOL_VERSION = "2025-11-25"
private const val MCP_ACCEPT = "application/json, text/event-stream"
private const val MAX_MCP_RESPONSE_BYTES = 512L * 1024L
private const val MAX_MCP_TOOLS = 256
private const val MAX_MCP_PAGES = 10

data class McpServerEndpoint(
    val id: String,
    val url: String,
    internal val allowInsecureForTests: Boolean = false,
) {
    init {
        require(id.matches(Regex("[a-z0-9][a-z0-9_-]{0,39}"))) { "mcp_server_id_invalid" }
        if (!allowInsecureForTests) McpEndpointPolicy.validate(url)
    }

    internal companion object {
        fun testOnly(id: String, url: String) = McpServerEndpoint(id, url, allowInsecureForTests = true)
    }
}

object McpEndpointPolicy {
    fun validate(url: String) {
        val uri = runCatching { URI(url) }.getOrElse { error("mcp_endpoint_invalid") }
        require(uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.fragment == null) {
            "mcp_endpoint_https_required"
        }
        require(uri.port in setOf(-1, 443)) { "mcp_endpoint_port_forbidden" }
        val host = uri.host.lowercase()
        require(host !in setOf("localhost", "localhost.localdomain") && !host.endsWith(".local")) {
            "mcp_endpoint_local_forbidden"
        }
        val literal = if (host.matches(Regex("[0-9.]+")) || ':' in host) {
            runCatching { InetAddress.getByName(host) }.getOrNull()
        } else null
        if (literal != null && (literal.isAnyLocalAddress || literal.isLoopbackAddress || literal.isLinkLocalAddress || literal.isSiteLocalAddress)) {
            require(false) { "mcp_endpoint_private_forbidden" }
        }
    }
}

fun interface McpBearerTokenProvider {
    fun token(accountSubject: String, serverId: String): String?
}

data class McpRemoteTool(
    val remoteName: String,
    val modelName: String,
    val title: String,
    val description: String,
    val inputSchema: JSONObject,
    val readOnly: Boolean,
)

class McpStreamableHttpClient(
    private val endpoint: McpServerEndpoint,
    private val accountSubject: String,
    private val tokens: McpBearerTokenProvider,
    private val http: OkHttpClient = OkHttpClient.Builder()
        .dns(PublicOnlyMcpDns)
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build(),
) {
    val serverId: String get() = endpoint.id
    private val ids = AtomicLong(0)
    @Volatile private var sessionId: String? = null
    @Volatile private var initialized = false

    @Synchronized
    fun initialize() {
        if (initialized) return
        val id = nextId()
        val response = request(JSONObject()
            .put("jsonrpc", "2.0").put("id", id).put("method", "initialize")
            .put("params", JSONObject()
                .put("protocolVersion", ANDROID_MCP_PROTOCOL_VERSION)
                .put("capabilities", JSONObject())
                .put("clientInfo", JSONObject().put("name", "OpenDrSai-Android").put("version", BuildVersion.VALUE))),
            includeProtocol = false,
        )
        val result = result(response, id)
        require(result.getString("protocolVersion") == ANDROID_MCP_PROTOCOL_VERSION) { "mcp_protocol_version_unsupported" }
        require(result.optJSONObject("capabilities")?.has("tools") == true) { "mcp_tools_capability_missing" }
        notification("notifications/initialized")
        initialized = true
    }

    fun listTools(): List<McpRemoteTool> {
        initialize()
        val tools = mutableListOf<McpRemoteTool>()
        var cursor: String? = null
        repeat(MAX_MCP_PAGES) {
            val id = nextId()
            val params = JSONObject().apply { cursor?.let { put("cursor", it) } }
            val payload = result(request(JSONObject()
                .put("jsonrpc", "2.0").put("id", id).put("method", "tools/list").put("params", params)), id)
            val page = payload.optJSONArray("tools") ?: error("mcp_tools_list_invalid")
            for (index in 0 until page.length()) {
                require(tools.size < MAX_MCP_TOOLS) { "mcp_tools_limit_exceeded" }
                val raw = page.getJSONObject(index)
                val remoteName = raw.getString("name")
                require(remoteName.matches(Regex("[A-Za-z0-9_.-]{1,128}"))) { "mcp_tool_name_invalid" }
                val input = raw.optJSONObject("inputSchema") ?: error("mcp_tool_schema_missing:$remoteName")
                require(input.optString("type") == "object") { "mcp_tool_schema_invalid:$remoteName" }
                tools += McpRemoteTool(
                    remoteName = remoteName,
                    modelName = modelToolName(endpoint.id, remoteName),
                    title = raw.optString("title", remoteName).take(160),
                    description = raw.optString("description", remoteName).take(1_000),
                    inputSchema = input,
                    readOnly = raw.optJSONObject("annotations")?.optBoolean("readOnlyHint", false) == true,
                )
            }
            cursor = payload.optString("nextCursor").takeIf(String::isNotBlank)
            if (cursor == null) return tools.sortedBy { it.modelName }
        }
        error("mcp_tools_pagination_limit")
    }

    fun call(tool: McpRemoteTool, arguments: JSONObject): String {
        initialize()
        val id = nextId()
        val result = result(request(JSONObject()
            .put("jsonrpc", "2.0").put("id", id).put("method", "tools/call")
            .put("params", JSONObject().put("name", tool.remoteName).put("arguments", arguments))), id)
        val content = result.optJSONArray("content") ?: JSONArray()
        require(content.length() <= 64) { "mcp_tool_content_limit" }
        return JSONObject()
            .put("server_id", endpoint.id)
            .put("tool", tool.remoteName)
            .put("is_error", result.optBoolean("isError", false))
            .put("content", content)
            .putOpt("structured_content", result.optJSONObject("structuredContent"))
            .toString()
    }

    fun close() {
        val session = sessionId ?: return
        val request = baseRequest().delete().header("MCP-Session-Id", session)
            .header("MCP-Protocol-Version", ANDROID_MCP_PROTOCOL_VERSION).build()
        runCatching { http.newCall(request).execute().close() }
        sessionId = null
        initialized = false
    }

    private fun notification(method: String) {
        val payload = JSONObject().put("jsonrpc", "2.0").put("method", method)
        execute(payload, includeProtocol = true).use { response ->
            require(response.code == 202) { "mcp_notification_rejected:${response.code}" }
        }
    }

    private fun request(payload: JSONObject, includeProtocol: Boolean = true): JSONObject {
        val id = payload.getLong("id")
        return try {
            execute(payload, includeProtocol).use { response -> decodeResponse(response, id) }
        } catch (interrupted: McpSseInterrupted) {
            val cursor = interrupted.lastEventId ?: error("mcp_sse_disconnected_before_response")
            resumeSse(id, cursor)
        } catch (expired: McpSessionExpired) {
            sessionId = null
            initialized = false
            if (payload.getString("method") == "initialize") throw expired
            initialize()
            execute(payload, includeProtocol = true).use { response -> decodeResponse(response, id) }
        }
    }

    private fun resumeSse(requestId: Long, lastEventId: String): JSONObject {
        val builder = baseRequest().get()
            .header("Accept", "text/event-stream")
            .header("Last-Event-ID", lastEventId)
            .header("MCP-Protocol-Version", ANDROID_MCP_PROTOCOL_VERSION)
        sessionId?.let { builder.header("MCP-Session-Id", it) }
        return http.newCall(builder.build()).execute().use { response -> decodeResponse(response, requestId) }
    }

    private fun execute(payload: JSONObject, includeProtocol: Boolean): okhttp3.Response {
        val body = payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val builder = baseRequest().post(body).header("Accept", MCP_ACCEPT)
        if (includeProtocol) builder.header("MCP-Protocol-Version", ANDROID_MCP_PROTOCOL_VERSION)
        sessionId?.let { builder.header("MCP-Session-Id", it) }
        return http.newCall(builder.build()).execute()
    }

    private fun baseRequest(): Request.Builder = Request.Builder().url(endpoint.url).apply {
        tokens.token(accountSubject, endpoint.id)?.takeIf(String::isNotBlank)?.let { token ->
            header("Authorization", "Bearer $token")
        }
    }

    private fun decodeResponse(response: okhttp3.Response, requestId: Long): JSONObject {
        if (response.code == 401 || response.code == 403) error("mcp_authentication_failed")
        if (response.code == 404 && sessionId != null) throw McpSessionExpired()
        require(response.isSuccessful) { "mcp_http_${response.code}" }
        response.header("MCP-Session-Id")?.let { value ->
            require(value.isNotBlank() && value.all { it.code in 0x21..0x7e }) { "mcp_session_id_invalid" }
            sessionId = value
        }
        val body = response.body ?: error("mcp_response_body_missing")
        require(body.contentLength() <= MAX_MCP_RESPONSE_BYTES || body.contentLength() == -1L) { "mcp_response_too_large" }
        val contentType = response.header("Content-Type").orEmpty().substringBefore(';').trim().lowercase()
        return when (contentType) {
            "application/json" -> JSONObject(body.string().also { require(it.length <= MAX_MCP_RESPONSE_BYTES) { "mcp_response_too_large" } })
            "text/event-stream" -> decodeSse(body.charStream(), requestId)
            else -> error("mcp_content_type_invalid")
        }
    }

    private fun decodeSse(reader: java.io.Reader, requestId: Long): JSONObject {
        reader.buffered().useLines { lines ->
            var data = StringBuilder()
            var events = 0
            var lastEventId: String? = null
            for (line in lines) {
                if (line.isEmpty()) {
                    if (data.isNotEmpty()) {
                        events += 1
                        require(events <= 512) { "mcp_sse_event_limit" }
                        val value = JSONObject(data.toString())
                        if (value.opt("id")?.toString() == requestId.toString()) return value
                        data = StringBuilder()
                    }
                } else if (line.startsWith("id:")) {
                    lastEventId = line.removePrefix("id:").trim().takeIf(String::isNotBlank)
                } else if (line.startsWith("data:")) {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(line.removePrefix("data:").trimStart())
                    require(data.length <= MAX_MCP_RESPONSE_BYTES) { "mcp_response_too_large" }
                }
            }
            throw McpSseInterrupted(lastEventId)
        }
    }

    private fun result(response: JSONObject, requestId: Long): JSONObject {
        require(response.optString("jsonrpc") == "2.0" && response.opt("id")?.toString() == requestId.toString()) {
            "mcp_jsonrpc_response_invalid"
        }
        response.optJSONObject("error")?.let { error ->
            throw IllegalStateException("mcp_rpc_${error.optInt("code")}:${error.optString("message").take(160)}")
        }
        return response.optJSONObject("result") ?: error("mcp_jsonrpc_result_missing")
    }

    private fun nextId() = ids.incrementAndGet()

    private class McpSessionExpired : RuntimeException()
    private class McpSseInterrupted(val lastEventId: String?) : RuntimeException()

    private object BuildVersion { const val VALUE = "1.5.6" }

    companion object {
        fun modelToolName(serverId: String, remoteName: String): String {
            val normalized = remoteName.lowercase().replace(Regex("[^a-z0-9_.-]+"), "_").trim('_').take(60)
            require(normalized.isNotBlank()) { "mcp_tool_name_invalid" }
            return "mcp.$serverId.$normalized"
        }
    }
}

private object PublicOnlyMcpDns : okhttp3.Dns {
    override fun lookup(hostname: String): List<InetAddress> = okhttp3.Dns.SYSTEM.lookup(hostname).also { addresses ->
        require(addresses.isNotEmpty() && addresses.none {
            it.isAnyLocalAddress || it.isLoopbackAddress || it.isLinkLocalAddress || it.isSiteLocalAddress
        }) { "mcp_endpoint_private_forbidden" }
    }
}

class AndroidMcpToolManager(
    private val registry: ToolRegistry,
    private val authorizer: McpConnectorAuthorizer? = null,
) {
    private data class ConnectionKey(val accountSubject: String, val serverId: String)
    private val connected = linkedMapOf<ConnectionKey, Pair<McpStreamableHttpClient, List<McpRemoteTool>>>()

    @Synchronized
    fun connect(accountSubject: String, client: McpStreamableHttpClient): List<McpRemoteTool> {
        require(accountSubject.isNotBlank()) { "mcp_account_required" }
        authorizer?.requireScope(accountSubject, client.serverId, McpConnectorScope.DISCOVER.wireName)
        disconnect(accountSubject, client.serverId)
        val tools = client.listTools()
        tools.forEach { tool ->
            registry.register(
                ToolDefinition(
                    id = tool.modelName,
                    version = 1,
                    description = "${tool.title}: ${tool.description}",
                    risk = ToolRisk.SENSITIVE,
                    parameterSchemaJson = tool.inputSchema.toString(),
                    requiredArguments = tool.inputSchema.optJSONArray("required").let { required ->
                        if (required == null) emptySet() else (0 until required.length()).mapTo(linkedSetOf()) { required.getString(it) }
                    },
                    requiredCapabilities = setOf(RuntimeCapability.MCP),
                    source = "mcp",
                ),
                approvalPreviewer = ToolApprovalPreviewer { _, arguments ->
                    JSONObject().put("server", tool.modelName.substringAfter("mcp.").substringBefore('.'))
                        .put("tool", tool.remoteName).put("arguments", arguments).toString()
                },
                ownerSubject = accountSubject,
                available = { context ->
                    context.accountSubject == accountSubject &&
                        (authorizer?.isActive(accountSubject, client.serverId) != false)
                },
            ) { context, arguments ->
                require(context.accountSubject == accountSubject) { "mcp_account_scope_denied" }
                authorizer?.requireScope(
                    accountSubject,
                    client.serverId,
                    if (tool.readOnly) McpConnectorScope.CALL_READ.wireName else McpConnectorScope.CALL_WRITE.wireName,
                )
                client.call(tool, arguments)
            }
        }
        connected[ConnectionKey(accountSubject, client.serverId)] = client to tools
        return tools
    }

    @Synchronized
    fun disconnect(accountSubject: String, serverId: String) {
        val previous = connected.remove(ConnectionKey(accountSubject, serverId)) ?: return
        registry.unregister(accountSubject, previous.second.mapTo(linkedSetOf(), McpRemoteTool::modelName))
        previous.first.close()
    }

    @Synchronized
    fun disconnectAll(accountSubject: String) {
        connected.keys.filter { it.accountSubject == accountSubject }.map(ConnectionKey::serverId)
            .forEach { disconnect(accountSubject, it) }
    }

    @Synchronized
    fun hasConnected(accountSubject: String): Boolean = connected.entries.any { (key, value) ->
        key.accountSubject == accountSubject && value.second.isNotEmpty() &&
            (authorizer?.isActive(accountSubject, key.serverId) != false)
    }
}
