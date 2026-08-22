package ai.drsai.remote.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ModelProviderDraftClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    suspend fun testConnection(baseUrl: String, wireApi: String, apiKey: String) = withContext(Dispatchers.IO) {
        executeCatalogRequest(baseUrl, wireApi, apiKey).use { response ->
            if (!response.isSuccessful) throw providerResponseError(response.code)
        }
    }

    suspend fun discover(baseUrl: String, wireApi: String, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        executeCatalogRequest(baseUrl, wireApi, apiKey).use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw providerResponseError(response.code)
            if (raw.isBlank()) throw ApiException(502, "模型服务返回了空响应")
            val data = JSONObject(raw).optJSONArray("data")
                ?: throw ApiException(502, "模型服务响应中缺少模型列表")
            (0 until data.length()).mapNotNull { data.optJSONObject(it)?.optString("id")?.takeIf(String::isNotBlank) }.distinct().sorted()
        }
    }

    private fun executeCatalogRequest(baseUrl: String, wireApi: String, apiKey: String): okhttp3.Response {
        require(apiKey.isNotBlank() || baseUrl.contains("127.0.0.1") || baseUrl.contains("localhost")) { "API Key 不能为空" }
        val root = baseUrl.trimEnd('/')
        val endpoint = if (wireApi == "anthropic") {
            if (root.endsWith("/v1")) "$root/models" else "$root/v1/models"
        } else "$root/models"
        val builder = Request.Builder().url(endpoint).header("Accept", "application/json")
        if (wireApi == "anthropic") builder.header("x-api-key", apiKey).header("anthropic-version", "2023-06-01")
        else if (apiKey.isNotBlank()) builder.header("Authorization", "Bearer $apiKey")
        return http.newCall(builder.get().build()).execute()
    }

    private fun providerResponseError(status: Int): ApiException = ApiException(status, when (status) {
        401 -> "API Key 无效或已过期"
        403 -> "当前 API Key 没有访问模型目录的权限"
        404 -> "API 地址不正确，未找到模型目录"
        429 -> "请求过于频繁或额度不足，请稍后重试"
        in 500..599 -> "模型服务暂时不可用"
        else -> "连接失败（HTTP $status）"
    })
}
