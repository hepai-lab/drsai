package ai.drsai.remote.data

import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

internal object PinnedModelRoute {
    const val VERSION = "p9-model-route-v1"

    fun create(
        modelId: String,
        providerId: String,
        upstreamModelId: String,
        baseUrl: String,
        wireApi: String,
        providerRevision: Long,
        credentialKind: String,
    ): JSONObject {
        require(modelId.isNotBlank() && providerId.isNotBlank() && upstreamModelId.isNotBlank()) { "model_route_identity_invalid" }
        require(baseUrl.isNotBlank()) { "model_route_base_url_missing" }
        require(wireApi in setOf("openai", "anthropic")) { "model_route_wire_api_invalid" }
        require(providerRevision >= 0) { "model_route_revision_invalid" }
        require(credentialKind in setOf("oidc", "api_key")) { "model_route_credential_kind_invalid" }
        val unsigned = JSONObject()
            .put("version", VERSION)
            .put("model_id", modelId)
            .put("provider_id", providerId)
            .put("upstream_model_id", upstreamModelId)
            .put("base_url", baseUrl.trimEnd('/'))
            .put("wire_api", wireApi)
            .put("provider_revision", providerRevision)
            .put("credential_kind", credentialKind)
        val identity = listOf(
            VERSION, modelId, providerId, upstreamModelId, baseUrl.trimEnd('/'), wireApi,
            providerRevision.toString(), credentialKind,
        ).joinToString("\u0000")
        return JSONObject(unsigned.toString()).put("sha256", digest(identity))
    }

    fun validate(route: JSONObject, expectedModelId: String): JSONObject {
        if (route.optString("version") != VERSION) fail("version")
        if (route.optString("model_id") != expectedModelId) fail("model_id")
        val rebuilt = runCatching {
            create(
                route.getString("model_id"), route.getString("provider_id"),
                route.getString("upstream_model_id"), route.getString("base_url"),
                route.getString("wire_api"), route.getLong("provider_revision"),
                route.getString("credential_kind"),
            )
        }.getOrElse { fail("fields") }
        if (route.optString("sha256") != rebuilt.getString("sha256")) fail("digest")
        return rebuilt
    }

    private fun digest(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    private fun fail(reason: String): Nothing = throw ApiException(
        422, "model_route_snapshot_invalid:$reason", retryable = false, code = "model_route_snapshot_invalid",
    )
}

interface PinnedModelRouteGateway {
    suspend fun pinModelRoute(modelId: String): JSONObject
    suspend fun streamCompletionWithPinnedRoute(
        modelId: String,
        route: JSONObject,
        messages: List<RuntimeMessage>,
        tools: JSONArray,
        toolChoice: JSONObject,
        onDelta: suspend (ModelDelta) -> Unit,
    )
}
