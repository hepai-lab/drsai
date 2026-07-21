package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteRuntimeRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

data class DiscoveredRuntime(
    val reference: RemoteRuntimeRef,
    val instanceId: String,
    val version: String,
    val protocolVersion: String,
    val connectionGeneration: Long,
    val state: RemoteConnectionState,
)

interface RelayDiscoveryService {
    suspend fun listRuntimes(cursor: String? = null, query: String? = null): Page<DiscoveredRuntime>
    suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String? = null, query: String? = null): Page<RemoteWorkspaceRef>
    suspend fun associate(accessGrantPayload: String): RuntimeId
}

class HttpRelayDiscoveryService(
    baseUrl: String,
    private val accessToken: () -> String,
    private val refreshAfter: suspend (String) -> String? = { null },
    private val http: OkHttpClient = OkHttpClient(),
) : RelayDiscoveryService {
    private val root = baseUrl.trimEnd('/').toHttpUrl()

    override suspend fun listRuntimes(cursor: String?, query: String?): Page<DiscoveredRuntime> =
        getPage("v1/runtimes", cursor, query) { item ->
            val identity = item.getJSONObject("runtime")
            val runtimeId = RuntimeId(identity.getString("runtime_id"))
            DiscoveredRuntime(
                reference = RemoteRuntimeRef(runtimeId, item.getString("display_name")),
                instanceId = identity.getString("instance_id"),
                version = identity.getString("version"),
                protocolVersion = identity.getString("protocol_version"),
                connectionGeneration = identity.getLong("connection_generation"),
                state = when (identity.getString("status")) {
                    "online" -> RemoteConnectionState.ONLINE
                    "degraded" -> RemoteConnectionState.DEGRADED
                    "offline" -> RemoteConnectionState.OFFLINE
                    else -> RemoteConnectionState.INCOMPATIBLE
                },
            )
        }

    override suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String?, query: String?): Page<RemoteWorkspaceRef> =
        getPage("v1/runtimes/${runtimeId.value}/workspaces", cursor, query) { item ->
            val returnedRuntime = RuntimeId(item.getString("runtime_id"))
            require(returnedRuntime == runtimeId) { "relay_workspace_runtime_mismatch" }
            RemoteWorkspaceRef(returnedRuntime, WorkspaceId(item.getString("workspace_id")), item.getString("display_name"))
        }

    override suspend fun associate(accessGrantPayload: String): RuntimeId = withContext(Dispatchers.IO) {
        val code = parseAccessGrantCode(accessGrantPayload)
        val body = JSONObject().put("request_id", java.util.UUID.randomUUID().toString())
            .put("correlation_id", java.util.UUID.randomUUID().toString()).put("code", code)
        val request = Request.Builder().url(root.newBuilder().addPathSegments("v1/associations").build())
            .header("Authorization", "Bearer ${accessToken()}")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw RelayHttpException(response.code, response.header("X-Correlation-Id"))
            RuntimeId(JSONObject(response.body?.string() ?: error("relay_empty_response")).getString("runtime_id"))
        }
    }

    private suspend fun <T> getPage(path: String, cursor: String?, query: String?, decode: (JSONObject) -> T): Page<T> =
        withContext(Dispatchers.IO) {
            val url = root.newBuilder().addPathSegments(path).apply {
                cursor?.let { addQueryParameter("cursor", it) }
                query?.takeIf(String::isNotBlank)?.let { addQueryParameter("query", it) }
            }.build()
            val initialToken = accessToken()
            fun execute(token: String) = http.newCall(
                Request.Builder().url(url).header("Authorization", "Bearer $token").get().build()
            ).execute()
            var response = execute(initialToken)
            if (response.code == 401) {
                response.close()
                val refreshed = refreshAfter(initialToken)
                if (refreshed.isNullOrBlank()) throw RelayHttpException(401, null)
                response = execute(refreshed)
            }
            response.use {
                if (!response.isSuccessful) throw RelayHttpException(response.code, response.header("X-Correlation-Id"))
                val rootObject = JSONObject(response.body?.string() ?: error("relay_empty_response"))
                val items = rootObject.getJSONArray("items")
                Page(List(items.length()) { index -> decode(items.getJSONObject(index)) },
                    rootObject.optString("next_cursor").takeIf { it.isNotBlank() && it != "null" })
            }
        }
}

fun parseAccessGrantCode(payload: String): String {
    val trimmed = payload.trim()
    val code = if (trimmed.startsWith("opendrsai://associate")) {
        android.net.Uri.parse(trimmed).getQueryParameter("code").orEmpty()
    } else trimmed
    require(code.matches(Regex("^[A-Za-z0-9_-]{16,128}$"))) { "access_grant_payload_invalid" }
    return code
}

class RelayHttpException(val status: Int, val correlationId: String?) :
    IllegalStateException("relay_http_$status${correlationId?.let { " ($it)" }.orEmpty()}")
