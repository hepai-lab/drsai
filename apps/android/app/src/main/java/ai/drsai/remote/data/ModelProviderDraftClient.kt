package ai.drsai.remote.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

data class ProviderConnectionReport(
    val stage: String,
    val discoveredModels: List<String>,
    val verifiedModels: List<String>,
)

class ModelProviderDraftClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build(),
    private val strings: ProviderDraftStrings = EnglishProviderDraftStrings,
) {
    suspend fun testConnection(
        baseUrl: String,
        wireApi: String,
        apiKey: String,
        expectedModels: List<String> = emptyList(),
    ): ProviderConnectionReport = withContext(Dispatchers.IO) {
        try {
            executeCatalogRequest(baseUrl, wireApi, apiKey).use { response ->
                val raw = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw providerResponseError(response.code, raw)
                if (raw.isBlank()) throw ApiException(502, strings.text(ProviderDraftText.EMPTY), true, "provider_empty_response")
                val data = runCatching { JSONObject(raw).optJSONArray("data") }.getOrNull()
                    ?: throw ApiException(502, strings.text(ProviderDraftText.CATALOG_INVALID), false, "provider_catalog_invalid")
                val discovered = (0 until data.length()).mapNotNull {
                    data.optJSONObject(it)?.optString("id")?.takeIf(String::isNotBlank)
                }.distinct().sorted()
                val requested = expectedModels.map(String::trim).filter(String::isNotBlank).distinct()
                val missing = requested.filterNot(discovered::contains)
                if (missing.isNotEmpty()) throw ApiException(
                    404, strings.text(ProviderDraftText.MODEL_MISSING, missing.joinToString().take(160)), false, "provider_model_not_found",
                )
                ProviderConnectionReport("CATALOG_VERIFIED", discovered, requested)
            }
        } catch (error: Throwable) {
            throw ProviderConnectionFailureClassifier.classify(error, strings)
        }
    }

    suspend fun discover(baseUrl: String, wireApi: String, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        try { executeCatalogRequest(baseUrl, wireApi, apiKey).use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw providerResponseError(response.code, raw)
            if (raw.isBlank()) throw ApiException(502, strings.text(ProviderDraftText.EMPTY))
            val data = JSONObject(raw).optJSONArray("data")
                ?: throw ApiException(502, strings.text(ProviderDraftText.CATALOG_INVALID))
            (0 until data.length()).mapNotNull { data.optJSONObject(it)?.optString("id")?.takeIf(String::isNotBlank) }.distinct().sorted()
        } } catch (error: Throwable) { throw ProviderConnectionFailureClassifier.classify(error, strings) }
    }

    private fun executeCatalogRequest(baseUrl: String, wireApi: String, apiKey: String): okhttp3.Response {
        require(apiKey.isNotBlank() || baseUrl.contains("127.0.0.1") || baseUrl.contains("localhost")) { "API key must not be blank" }
        val root = baseUrl.trimEnd('/')
        val endpoint = if (wireApi == "anthropic") {
            if (root.endsWith("/v1")) "$root/models" else "$root/v1/models"
        } else "$root/models"
        val builder = Request.Builder().url(endpoint).header("Accept", "application/json")
        if (wireApi == "anthropic") builder.header("x-api-key", apiKey).header("anthropic-version", "2023-06-01")
        else if (apiKey.isNotBlank()) builder.header("Authorization", "Bearer $apiKey")
        return http.newCall(builder.get().build()).execute()
    }

    private fun providerResponseError(status: Int, rawBody: String): ApiException {
        val base = when (status) {
        401 -> strings.text(ProviderDraftText.KEY_INVALID)
        403 -> strings.text(ProviderDraftText.ACCESS_DENIED)
        402 -> strings.text(ProviderDraftText.BALANCE)
        404 -> strings.text(ProviderDraftText.ENDPOINT)
        429 -> strings.text(ProviderDraftText.RATE)
        in 500..599 -> strings.text(ProviderDraftText.UNAVAILABLE)
        else -> strings.text(ProviderDraftText.HTTP, status)
        }
        val body = runCatching {
            val json = JSONObject(rawBody)
            json.optJSONObject("error")?.optString("message")?.ifBlank { null }
                ?: json.optString("message").ifBlank { null }
        }.getOrNull()?.let(ai.drsai.remote.runtime.security.SensitiveDataRedactor::redact)?.take(320)
        return ApiException(status, if (body == null) base else strings.text(ProviderDraftText.PROVIDER_DETAIL, base, body), code = when (status) {
        401 -> "provider_credentials_invalid"
        403 -> "provider_permission_denied"
        402, 429 -> "provider_quota_or_rate_limit"
        404 -> "provider_endpoint_not_found"
        in 500..599 -> "provider_unavailable"
        else -> "provider_http_error"
        })
    }
}

object ProviderConnectionFailureClassifier {
    fun classify(error: Throwable, strings: ProviderDraftStrings = EnglishProviderDraftStrings): Throwable {
        if (error is ApiException) return error
        val mapped = when (error) {
            is UnknownHostException -> ApiException(0, strings.text(ProviderDraftText.DNS), false, "provider_dns_failed")
            is SSLException -> ApiException(0, strings.text(ProviderDraftText.TLS), false, "provider_tls_failed")
            is SocketTimeoutException -> ApiException(408, strings.text(ProviderDraftText.TIMEOUT), true, "provider_timeout")
            is IOException -> ApiException(0, strings.text(ProviderDraftText.NETWORK), true, "provider_network_failed")
            else -> return error
        }
        return mapped.apply { initCause(error) }
    }
}
