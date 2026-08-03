package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteResourceLifecycle
import ai.drsai.remote.remote.model.RemoteRuntimeRef
import ai.drsai.remote.remote.model.RemoteWorkspaceRef
import ai.drsai.remote.remote.model.RuntimeId
import ai.drsai.remote.remote.model.WorkspaceId
import ai.drsai.remote.remote.model.activeOnly
import ai.drsai.remote.remote.security.RelayDeviceProof
import ai.drsai.remote.remote.security.authorizeRelayRequest
import ai.drsai.remote.remote.security.relayAssociationDevice
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
    val capabilities: Set<String> = emptySet(),
    val lastSeenAt: String? = null,
)

data class WorkspaceCatalogSync(
    val runtimeId: RuntimeId,
    val catalogRevision: String,
    val syncedAt: String,
    val items: List<RemoteWorkspaceRef>,
) {
    init {
        require(catalogRevision.isNotBlank()) { "relay_workspace_catalog_revision_invalid" }
        java.time.Instant.parse(syncedAt)
        require(items.all { it.runtimeId == runtimeId }) { "relay_workspace_runtime_mismatch" }
        require(items.map { it.workspaceId }.distinct().size == items.size) {
            "relay_workspace_duplicate_id"
        }
    }
}

internal const val MINIMUM_WINDOWS_RUNTIME_VERSION = "1.5.3"

internal fun compatibleWindowsRuntimeVersion(version: String): Boolean {
    fun parts(value: String): List<Int>? {
        val core = value.trim().substringBefore('-')
        val values = core.split('.')
        if (values.size != 3 || values.any { it.isEmpty() || it.any { character -> !character.isDigit() } }) {
            return null
        }
        return values.mapNotNull(String::toIntOrNull).takeIf { it.size == 3 }
    }
    val actual = parts(version) ?: return false
    val minimum = checkNotNull(parts(MINIMUM_WINDOWS_RUNTIME_VERSION))
    val comparison = actual.zip(minimum).firstOrNull { (left, right) -> left != right }
        ?.let { (left, right) -> left > right }
    return comparison ?: !version.trim().contains('-')
}

internal fun runtimeConnectionState(status: String, version: String): RemoteConnectionState {
    val wireState = when (status) {
        "online" -> RemoteConnectionState.ONLINE
        "degraded" -> RemoteConnectionState.DEGRADED
        "offline" -> RemoteConnectionState.OFFLINE
        else -> RemoteConnectionState.INCOMPATIBLE
    }
    return if (
        wireState in setOf(RemoteConnectionState.ONLINE, RemoteConnectionState.DEGRADED) &&
        !compatibleWindowsRuntimeVersion(version)
    ) {
        RemoteConnectionState.INCOMPATIBLE
    } else {
        wireState
    }
}

interface RelayDiscoveryService {
    suspend fun listRuntimes(cursor: String? = null, query: String? = null): Page<DiscoveredRuntime>
    suspend fun listWorkspaces(runtimeId: RuntimeId, cursor: String? = null, query: String? = null): Page<RemoteWorkspaceRef>
    suspend fun syncWorkspaces(runtimeId: RuntimeId): WorkspaceCatalogSync =
        throw UnsupportedOperationException("workspace_catalog_sync_not_supported")
    suspend fun associate(accessGrantPayload: String): RuntimeId
    suspend fun revokeAssociation(runtimeId: RuntimeId)
    suspend fun recordPresence(runtimeId: RuntimeId, accessing: Boolean = false)
}

class HttpRelayDiscoveryService(
    baseUrl: String,
    private val accessToken: () -> String,
    private val refreshAfter: suspend (String) -> String? = { null },
    private val http: OkHttpClient = OkHttpClient(),
    private val deviceProof: RelayDeviceProof? = null,
) : RelayDiscoveryService {
    private val root = baseUrl.trimEnd('/').toHttpUrl()
    private val pairingIssuer = "${root.scheme}://${root.host}"

    override suspend fun listRuntimes(cursor: String?, query: String?): Page<DiscoveredRuntime> =
        getPage("v1/runtimes", cursor, query) { item ->
            val identity = item.getJSONObject("runtime")
            val runtimeId = RuntimeId(identity.getString("runtime_id"))
            val runtimeVersion = identity.getString("version")
            DiscoveredRuntime(
                reference = RemoteRuntimeRef(runtimeId, item.getString("display_name")),
                instanceId = identity.getString("instance_id"),
                version = runtimeVersion,
                protocolVersion = identity.getString("protocol_version"),
                connectionGeneration = identity.getLong("connection_generation"),
                state = runtimeConnectionState(identity.getString("status"), runtimeVersion),
                capabilities = item.optJSONArray("capabilities")
                    ?.let { values ->
                        (0 until values.length()).map(values::getString).toSet()
                    }
                    .orEmpty(),
                lastSeenAt = identity.optString("last_seen_at")
                    .takeIf { it.isNotBlank() && it != "null" },
            )
        }

    override suspend fun listWorkspaces(
        runtimeId: RuntimeId,
        cursor: String?,
        query: String?,
    ): Page<RemoteWorkspaceRef> = listWorkspacePage(runtimeId, cursor, query)

    override suspend fun syncWorkspaces(runtimeId: RuntimeId): WorkspaceCatalogSync =
        withContext(Dispatchers.IO) {
            require(runtimeId.value.isNotBlank()) { "runtime_id_required" }
            val url = root.newBuilder()
                .addPathSegments("v1/runtimes/${runtimeId.value}/workspaces/sync")
                .build()
            val requestBody = "{}".toRequestBody("application/json".toMediaType())
            fun execute(token: String) = http.newCall(
                authorizeRelayRequest(
                    deviceProof,
                    Request.Builder().url(url)
                        .header("Authorization", "Bearer $token")
                        .post(requestBody)
                        .build(),
                    token,
                )
            ).execute()
            val initialToken = accessToken()
            var response = execute(initialToken)
            if (response.code == 401) {
                response.close()
                val refreshed = refreshAfter(initialToken)
                if (refreshed.isNullOrBlank()) {
                    throw RelayHttpException(401, null, "oidc_auth_invalid")
                }
                response = execute(refreshed)
            }
            response.use {
                if (!response.isSuccessful) throw relayHttpException(response)
                decodeWorkspaceCatalogSync(
                    requestedRuntime = runtimeId,
                    payload = JSONObject(response.body?.string() ?: error("relay_empty_response")),
                )
            }
        }

    suspend fun listWorkspacePage(
        runtimeId: RuntimeId,
        cursor: String? = null,
        query: String? = null,
        limit: Int = 100,
    ): Page<RemoteWorkspaceRef> {
        require(limit in 1..100) { "relay_workspace_limit_invalid" }
        return getPage(
            "v1/runtimes/${runtimeId.value}/workspaces",
            cursor,
            query,
            listOf("lifecycle" to "active", "limit" to limit.toString()),
        ) { item -> decodeWorkspace(item, runtimeId) }
            .let { page -> page.copy(items = page.items.activeOnly()) }
    }

    override suspend fun associate(accessGrantPayload: String): RuntimeId = withContext(Dispatchers.IO) {
        val code = parseAccessGrantCode(accessGrantPayload, pairingIssuer)
        val device = relayAssociationDevice(deviceProof)
        val body = JSONObject().put("request_id", java.util.UUID.randomUUID().toString())
            .put("correlation_id", java.util.UUID.randomUUID().toString())
            .put("code", code)
            .put("device_id", device.deviceId)
            .put("device_name", device.deviceName)
            .put("device_public_key", device.devicePublicKey)
        val url = root.newBuilder().addPathSegments("v1/associations").build()
        val encodedBody = body.toString().toRequestBody("application/json".toMediaType())
        // Association creation is the only Bearer endpoint that cannot require
        // an existing device proof. The one-time grant binds this public key.
        fun execute(token: String) = http.newCall(
            Request.Builder().url(url)
                .header("Authorization", "Bearer $token")
                .post(encodedBody)
                .build()
        ).execute()
        val initialToken = accessToken()
        var response = execute(initialToken)
        if (response.code == 401) {
            response.close()
            val refreshed = refreshAfter(initialToken)
            if (refreshed.isNullOrBlank()) throw RelayHttpException(401, null, "oidc_auth_invalid")
            response = execute(refreshed)
        }
        response.use {
            if (!response.isSuccessful) throw relayHttpException(response)
            RuntimeId(JSONObject(response.body?.string() ?: error("relay_empty_response")).getString("runtime_id"))
        }
    }

    private fun decodeWorkspaceCatalogSync(
        requestedRuntime: RuntimeId,
        payload: JSONObject,
    ): WorkspaceCatalogSync {
        val returnedRuntime = RuntimeId(payload.getString("runtime_id"))
        require(returnedRuntime == requestedRuntime) { "relay_workspace_runtime_mismatch" }
        val values = payload.getJSONArray("items")
        val items = List(values.length()) { index ->
            decodeWorkspace(values.getJSONObject(index), requestedRuntime)
        }.activeOnly()
        return WorkspaceCatalogSync(
            runtimeId = returnedRuntime,
            catalogRevision = payload.getString("catalog_revision"),
            syncedAt = payload.getString("synced_at"),
            items = items,
        )
    }

    private fun decodeWorkspace(item: JSONObject, requestedRuntime: RuntimeId): RemoteWorkspaceRef {
        val returnedRuntime = RuntimeId(item.getString("runtime_id"))
        require(returnedRuntime == requestedRuntime) { "relay_workspace_runtime_mismatch" }
        return RemoteWorkspaceRef(
            returnedRuntime,
            WorkspaceId(item.getString("workspace_id")),
            item.getString("display_name"),
            RemoteResourceLifecycle.fromWire(item.getString("lifecycle")),
            item.getLong("revision"),
            item.get("updated_at").toString(),
        )
    }
    override suspend fun revokeAssociation(runtimeId: RuntimeId): Unit = withContext(Dispatchers.IO) {
        require(runtimeId.value.isNotBlank()) { "runtime_id_required" }
        val url = root.newBuilder()
            .addPathSegments("v1/associations/${runtimeId.value}")
            .build()
        fun execute(token: String) = http.newCall(
            authorizeRelayRequest(
                deviceProof,
                Request.Builder().url(url)
                .header("Authorization", "Bearer $token")
                .delete()
                .build(),
                token,
            )
        ).execute()
        val initialToken = accessToken()
        var response = execute(initialToken)
        if (response.code == 401) {
            response.close()
            val refreshed = refreshAfter(initialToken)
            if (refreshed.isNullOrBlank()) {
                throw RelayHttpException(401, null, "oidc_auth_invalid")
            }
            response = execute(refreshed)
        }
        response.use {
            if (!response.isSuccessful) throw relayHttpException(response)
        }
    }

    override suspend fun recordPresence(runtimeId: RuntimeId, accessing: Boolean): Unit = withContext(Dispatchers.IO) {
        require(runtimeId.value.isNotBlank()) { "runtime_id_required" }
        val url = root.newBuilder()
            .addPathSegments("v1/associations/${runtimeId.value}/presence")
            .build()
        val encodedBody = JSONObject()
            .put("accessing", accessing)
            .toString()
            .toRequestBody("application/json".toMediaType())
        fun execute(token: String) = http.newCall(
            authorizeRelayRequest(
                deviceProof,
                Request.Builder().url(url)
                    .header("Authorization", "Bearer $token")
                    .post(encodedBody)
                    .build(),
                token,
            )
        ).execute()
        val initialToken = accessToken()
        var response = execute(initialToken)
        if (response.code == 401) {
            response.close()
            val refreshed = refreshAfter(initialToken)
            if (refreshed.isNullOrBlank()) {
                throw RelayHttpException(401, null, "oidc_auth_invalid")
            }
            response = execute(refreshed)
        }
        response.use {
            if (!response.isSuccessful) throw relayHttpException(response)
        }
    }

    private suspend fun <T> getPage(
        path: String,
        cursor: String?,
        query: String?,
        extraQueries: List<Pair<String, String>> = emptyList(),
        decode: (JSONObject) -> T,
    ): Page<T> =
        withContext(Dispatchers.IO) {
            val url = root.newBuilder().addPathSegments(path).apply {
                cursor?.let { addQueryParameter("cursor", it) }
                query?.takeIf(String::isNotBlank)?.let { addQueryParameter("query", it) }
                extraQueries.forEach { addQueryParameter(it.first, it.second) }
            }.build()
            val initialToken = accessToken()
            fun execute(token: String) = http.newCall(
                authorizeRelayRequest(
                    deviceProof,
                    Request.Builder().url(url)
                        .header("Authorization", "Bearer $token")
                        .get()
                        .build(),
                    token,
                )
            ).execute()
            var response = execute(initialToken)
            if (response.code == 401) {
                response.close()
                val refreshed = refreshAfter(initialToken)
                if (refreshed.isNullOrBlank()) throw RelayHttpException(401, null)
                response = execute(refreshed)
            }
            response.use {
                if (!response.isSuccessful) throw relayHttpException(response)
                val rootObject = JSONObject(response.body?.string() ?: error("relay_empty_response"))
                val items = rootObject.getJSONArray("items")
                Page(List(items.length()) { index -> decode(items.getJSONObject(index)) },
                    rootObject.optString("next_cursor").takeIf { it.isNotBlank() && it != "null" })
            }
        }
}

fun parseAccessGrantCode(payload: String, expectedIssuer: String = "https://ai.ihep.ac.cn"): String {
    val trimmed = payload.trim()
    val code = if (trimmed.startsWith("opendrsai://associate")) {
        val uri = java.net.URI(trimmed)
        require(uri.scheme == "opendrsai" && uri.host == "associate" && uri.rawAuthority == "associate" &&
            uri.path.orEmpty().isEmpty() && uri.userInfo == null && uri.port == -1 && uri.fragment == null) {
            "access_grant_payload_invalid"
        }
        fun decode(value: String): String = java.net.URLDecoder.decode(value, Charsets.UTF_8.name())
        val parts = uri.rawQuery.orEmpty().split('&').filter(String::isNotBlank)
        require(parts.all { it.contains('=') }) { "access_grant_payload_invalid" }
        val names = parts.map { decode(it.substringBefore('=')) }
        require(names.size == names.toSet().size && names.toSet() == setOf("v", "environment", "issuer", "code")) {
            "access_grant_payload_invalid"
        }
        val values = parts.associate { decode(it.substringBefore('=')) to decode(it.substringAfter('=')) }
        val normalizedIssuer = expectedIssuer.trimEnd('/')
        val expectedIssuerUri = java.net.URI(normalizedIssuer)
        require(expectedIssuerUri.scheme == "https" && expectedIssuerUri.port == -1 &&
            expectedIssuerUri.path.orEmpty().isEmpty() && expectedIssuerUri.query == null && expectedIssuerUri.fragment == null &&
            expectedIssuerUri.userInfo == null) {
            "access_grant_environment_mismatch"
        }
        val expectedEnvironment = when (expectedIssuerUri.host?.lowercase()) {
            "ai.ihep.ac.cn" -> "production"
            "ai-dev.ihep.ac.cn" -> "development"
            else -> throw IllegalArgumentException("access_grant_environment_mismatch")
        }
        require(values["v"] == "1" &&
            values["environment"] == expectedEnvironment &&
            values["issuer"] == normalizedIssuer
        ) { "access_grant_environment_mismatch" }
        values["code"].orEmpty()
    } else trimmed
    require(code.matches(Regex("^[A-Za-z0-9_-]{16,128}$"))) { "access_grant_payload_invalid" }
    return code
}

internal fun relayHttpException(response: okhttp3.Response): RelayHttpException {
    val raw = response.body?.string().orEmpty()
    val body = runCatching { JSONObject(raw) }.getOrNull()
    val detail = body?.optJSONObject("detail")
    return RelayHttpException(
        response.code,
        response.header("X-Correlation-Id")
            ?: body?.optString("correlation_id")?.takeIf(String::isNotBlank)
            ?: detail?.optString("correlation_id")?.takeIf(String::isNotBlank),
        body?.optString("code")?.takeIf(String::isNotBlank)
            ?: detail?.optString("code")?.takeIf(String::isNotBlank),
    )
}

class RelayHttpException(val status: Int, val correlationId: String?, val errorCode: String? = null) :
    IllegalStateException("relay_http_$status${correlationId?.let { " ($it)" }.orEmpty()}")

fun associationErrorMessage(failure: Throwable): String = when {
    failure is IllegalArgumentException && failure.message == "access_grant_environment_mismatch" ->
        "二维码环境与当前应用不一致"
    failure is IllegalArgumentException -> "二维码格式无效，请在电脑端刷新后重试"
    failure is RelayHttpException && failure.errorCode == "access_grant_expired" ->
        "二维码已过期，请在电脑端刷新后重试"
    failure is RelayHttpException && failure.errorCode == "access_grant_consumed" ->
        "二维码已使用，请在电脑端刷新后重试"
    failure is RelayHttpException && failure.errorCode == "access_grant_revoked" ->
        "二维码已撤销，请在电脑端刷新后重试"
    failure is RelayHttpException && (failure.status == 401 || failure.errorCode == "oidc_auth_invalid") ->
        "HepAI 登录已过期，请重新登录"
    failure is RelayHttpException && failure.status == 429 -> "操作过于频繁，请稍后重试"
    failure is java.io.IOException -> "网络连接失败，请检查网络后重试"
    else -> "关联失败，请重试"
}
