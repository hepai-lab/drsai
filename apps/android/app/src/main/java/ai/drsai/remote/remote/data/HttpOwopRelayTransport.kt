package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RuntimeId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

class HttpOwopRelayTransport(
    baseUrl: String,
    private val runtimeId: RuntimeId,
    private val accessToken: () -> String,
    private val http: OkHttpClient = OkHttpClient(),
) : OwopRelayTransport {
    private val root = baseUrl.trimEnd('/').toHttpUrl()

    override suspend fun execute(request: OwopRequest): OwopResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("version", request.version).put("request_id", request.requestId)
            .put("correlation_id", request.correlationId).put("operation", request.operation.wireName)
            .put("params", JSONObject(request.params))
        val url = root.newBuilder().addPathSegments(
            "v1/runtimes/${runtimeId.value}/workspaces/${request.workspaceId.value}/owop",
        ).build()
        http.newCall(Request.Builder().url(url).header("Authorization", "Bearer ${accessToken()}")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()).execute().use { response ->
            val payload = JSONObject(response.body?.string() ?: error("relay_empty_response"))
            if (!response.isSuccessful) {
                return@withContext OwopResult.Failure(request.requestId, payload.optString("code", "owop_failed"),
                    payload.optString("message", "OWOP failed"), payload.optString("correlation_id", request.correlationId),
                    payload.optBoolean("retryable", false), payload.optJSONObject("details")?.toMap().orEmpty())
            }
            require(payload.getString("request_id") == request.requestId) { "owop_request_identity_mismatch" }
            require(RuntimeId(payload.getString("runtime_id")) == runtimeId) { "owop_runtime_identity_mismatch" }
            require(payload.getString("workspace_id") == request.workspaceId.value) { "owop_workspace_identity_mismatch" }
            OwopResult.Success(request.requestId, payload.getJSONObject("result").toMap())
        }
    }
}

private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key -> get(key).toKotlin() }
private fun Any?.toKotlin(): Any? = when (this) {
    JSONObject.NULL -> null
    is JSONObject -> toMap()
    is JSONArray -> (0 until length()).map { get(it).toKotlin() }
    else -> this
}
