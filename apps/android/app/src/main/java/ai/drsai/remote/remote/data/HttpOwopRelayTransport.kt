package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.authorizeRelayRequest
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
    private val deviceProof: RelayDeviceProof? = null,
) : OwopRelayTransport {
    private val root = baseUrl.trimEnd('/').toHttpUrl()

    override suspend fun execute(request: OwopRequest): OwopResult = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("version", request.version).put("request_id", request.requestId)
            .put("correlation_id", request.correlationId).put("operation", request.operation.wireName)
            .put("params", JSONObject(request.params))
        val url = root.withRelayPath(
            listOf("v1", "runtimes", runtimeId.value, "workspaces", request.workspaceId.value, "owop"),
        )
        val token = accessToken()
        val authorized = authorizeRelayRequest(
            deviceProof,
            Request.Builder().url(url)
                .header("Authorization", "Bearer $token")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .build(),
            token,
        )
        http.newCall(authorized).execute().use { response ->
            val payload = JSONObject(response.body?.string() ?: error("relay_empty_response"))
            if (!response.isSuccessful) {
                val error = payload.structuredError()
                return@withContext OwopResult.Failure(
                    request.requestId,
                    error.optString("code", "owop_failed"),
                    error.optString("message", "OWOP failed"),
                    error.optString(
                        "correlation_id",
                        payload.optString("correlation_id", request.correlationId),
                    ),
                    error.optBoolean("retryable", false),
                    error.optJSONObject("details")?.toMap().orEmpty(),
                )
            }
            require(payload.getString("request_id") == request.requestId) { "owop_request_identity_mismatch" }
            require(RuntimeId(payload.getString("runtime_id")) == runtimeId) { "owop_runtime_identity_mismatch" }
            require(payload.getString("workspace_id") == request.workspaceId.value) { "owop_workspace_identity_mismatch" }
            OwopResult.Success(request.requestId, payload.getJSONObject("result").toMap())
        }
    }
}

private fun JSONObject.structuredError(): JSONObject {
    optJSONObject("error")?.let { return it }
    optJSONObject("detail")?.let { detail ->
        detail.optJSONObject("error")?.let { return it }
        if (detail.has("code")) return detail
    }
    return this
}

private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key -> get(key).toKotlin() }
private fun Any?.toKotlin(): Any? = when (this) {
    JSONObject.NULL -> null
    is JSONObject -> toMap()
    is JSONArray -> (0 until length()).map { get(it).toKotlin() }
    else -> this
}
