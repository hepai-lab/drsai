package ai.drsai.remote.runtime.tools

import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

private const val WEB_SEARCH_PROTOCOL = "p9-web-search-v1"
private const val DEFAULT_MAX_RESULTS = 5
private const val MAX_PROVIDER_BODY_CHARS = 1_000_000

data class WebSearchItem(
    val title: String,
    val url: String,
    val snippet: String,
    val lastModifiedAt: String? = null,
)

data class WebSearchResponse(
    val query: String,
    val provider: String,
    val status: String,
    val searchedAt: String,
    val items: List<WebSearchItem> = emptyList(),
    val errorCode: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema_version", WEB_SEARCH_PROTOCOL)
        .put("query", query)
        .put("provider", provider)
        .put("status", status)
        .put("searched_at", searchedAt)
        .put("results", JSONArray(items.map { item ->
            JSONObject()
                .put("title", item.title)
                .put("url", item.url)
                .put("snippet", item.snippet)
                .put("provider", provider)
                .putOpt("last_modified_at", item.lastModifiedAt)
        }))
        .put("result_count", items.size)
        .putOpt("error_code", errorCode)
}

fun interface WebSearchProvider {
    suspend fun search(query: String, limit: Int): WebSearchResponse
}

class FallbackWebSearchProvider(private val providers: List<WebSearchProvider>) : WebSearchProvider {
    init { require(providers.isNotEmpty()) { "web_search_provider_required" } }

    override suspend fun search(query: String, limit: Int): WebSearchResponse {
        var last: WebSearchResponse? = null
        for (provider in providers) {
            val response = provider.search(query, limit)
            // An empty HTML parse is not authoritative: provider markup and regional
            // responses change frequently. Continue to the next independent provider.
            if (response.status == "ok") return response
            last = response
        }
        return requireNotNull(last)
    }
}

/** Matches the existing Desktop WebSurfer's Bing route while returning bounded structured data. */
class BingHtmlWebSearchProvider(
    private val http: OkHttpClient = OkHttpClient(),
    private val endpoint: HttpUrl = HttpUrl.Builder()
        .scheme("https").host("www.bing.com").addPathSegment("search").build(),
    private val providerId: String = "bing-web",
    private val clock: () -> Instant = Instant::now,
) : WebSearchProvider {
    override suspend fun search(query: String, limit: Int): WebSearchResponse = withContext(Dispatchers.IO) {
        val searchedAt = clock().toString()
        val url = endpoint.newBuilder()
            .addQueryParameter("q", query)
            .addQueryParameter("count", limit.toString())
            .addQueryParameter("FORM", "QBLH")
            .build()
        try {
            http.newCall(Request.Builder().url(url)
                .header("Accept", "text/html")
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36")
                .build()).execute().use { response ->
                if (!response.isSuccessful) return@withContext WebSearchResponse(
                    query, providerId, "provider_error", searchedAt, errorCode = "http_${response.code}",
                )
                val raw = response.body?.string().orEmpty()
                if (raw.length > MAX_PROVIDER_BODY_CHARS) return@withContext WebSearchResponse(
                    query, providerId, "provider_error", searchedAt, errorCode = "response_too_large",
                )
                val items = parseBingResults(raw, limit)
                WebSearchResponse(query, providerId, if (items.isEmpty()) "empty" else "ok", searchedAt, items)
            }
        } catch (_: SocketTimeoutException) {
            WebSearchResponse(query, providerId, "timeout", searchedAt, errorCode = "provider_timeout")
        } catch (_: IOException) {
            WebSearchResponse(query, providerId, "provider_error", searchedAt, errorCode = "provider_io_error")
        } catch (_: Throwable) {
            WebSearchResponse(query, providerId, "provider_error", searchedAt, errorCode = "provider_response_invalid")
        }
    }

    companion object {
        private val resultPattern = Regex("""<li[^>]*class=[\"'][^\"']*\bb_algo\b[^\"']*[\"'][^>]*>(.*?)</li>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        private val headingPattern = Regex("""<div[^>]*class=[\"'][^\"']*\bb_algoheader\b[^\"']*[\"'][^>]*>.*?<a[^>]*href=[\"'](https://[^\"']+)[\"'][^>]*>.*?<h2[^>]*>(.*?)</h2>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        private val snippetPattern = Regex("""<div[^>]*class=[\"'][^\"']*\bb_caption\b[^\"']*[\"'][^>]*>.*?<p[^>]*>(.*?)</p>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        private val tagPattern = Regex("<[^>]+>")

        internal fun parseBingResults(html: String, limit: Int): List<WebSearchItem> = resultPattern.findAll(html)
            .mapNotNull { row ->
                val block = row.groupValues[1]
                val heading = headingPattern.find(block) ?: return@mapNotNull null
                val url = decodeHtml(heading.groupValues[1]).trim()
                val title = plainText(heading.groupValues[2])
                if (title.isBlank() || !url.startsWith("https://") || url.startsWith("https://www.bing.com/")) {
                    return@mapNotNull null
                }
                WebSearchItem(title, url, snippetPattern.find(block)?.groupValues?.get(1)?.let(::plainText).orEmpty())
            }
            .distinctBy(WebSearchItem::url)
            .take(limit)
            .toList()

        private fun plainText(value: String) = decodeHtml(tagPattern.replace(value, " "))
            .replace(Regex("\\s+"), " ").trim().take(500)

        private fun decodeHtml(value: String): String = value
            .replace("&amp;", "&", ignoreCase = true)
            .replace("&quot;", "\"", ignoreCase = true)
            .replace("&#39;", "'", ignoreCase = true)
            .replace("&apos;", "'", ignoreCase = true)
            .replace("&lt;", "<", ignoreCase = true)
            .replace("&gt;", ">", ignoreCase = true)
    }
}

fun defaultAndroidWebSearchProvider(): WebSearchProvider = FallbackWebSearchProvider(listOf(
    BingHtmlWebSearchProvider(),
    WikipediaWebSearchProvider(),
))

/**
 * Key-free production provider backed by the public MediaWiki search API.
 * The provider boundary is injectable so a broader provider can replace it
 * without changing the model-visible tool or OAEP result contract.
 */
class WikipediaWebSearchProvider(
    private val http: OkHttpClient = OkHttpClient(),
    private val endpoint: HttpUrl = HttpUrl.Builder()
        .scheme("https").host("en.wikipedia.org").addPathSegment("w").addPathSegment("api.php").build(),
    private val providerId: String = "wikipedia-mediawiki",
    private val clock: () -> Instant = Instant::now,
) : WebSearchProvider {
    override suspend fun search(query: String, limit: Int): WebSearchResponse = withContext(Dispatchers.IO) {
        val searchedAt = clock().toString()
        val url = endpoint.newBuilder()
            .addQueryParameter("action", "query")
            .addQueryParameter("generator", "search")
            .addQueryParameter("gsrsearch", query)
            .addQueryParameter("gsrlimit", limit.toString())
            .addQueryParameter("prop", "extracts|info|revisions")
            .addQueryParameter("inprop", "url")
            .addQueryParameter("exintro", "1")
            .addQueryParameter("explaintext", "1")
            .addQueryParameter("exchars", "500")
            .addQueryParameter("rvprop", "timestamp")
            .addQueryParameter("format", "json")
            .addQueryParameter("formatversion", "2")
            .build()
        try {
            http.newCall(Request.Builder().url(url).header("Accept", "application/json").build()).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext WebSearchResponse(
                        query, providerId, "provider_error", searchedAt,
                        errorCode = "http_${response.code}",
                    )
                }
                val raw = response.body?.string().orEmpty()
                if (raw.length > MAX_PROVIDER_BODY_CHARS) {
                    return@withContext WebSearchResponse(
                        query, providerId, "provider_error", searchedAt,
                        errorCode = "response_too_large",
                    )
                }
                val pages = JSONObject(raw).optJSONObject("query")?.optJSONArray("pages") ?: JSONArray()
                val items = buildList {
                    repeat(pages.length()) { index ->
                        val page = pages.getJSONObject(index)
                        val title = page.optString("title").trim()
                        val pageUrl = page.optString("fullurl").trim()
                        if (title.isNotBlank() && pageUrl.startsWith("https://")) {
                            add(WebSearchItem(
                                title = title,
                                url = pageUrl,
                                snippet = page.optString("extract").replace(Regex("\\s+"), " ").trim().take(500),
                                lastModifiedAt = page.optJSONArray("revisions")
                                    ?.optJSONObject(0)?.optString("timestamp")?.takeIf(String::isNotBlank),
                            ))
                        }
                    }
                }.take(limit)
                WebSearchResponse(query, providerId, if (items.isEmpty()) "empty" else "ok", searchedAt, items)
            }
        } catch (_: SocketTimeoutException) {
            WebSearchResponse(query, providerId, "timeout", searchedAt, errorCode = "provider_timeout")
        } catch (_: IOException) {
            WebSearchResponse(query, providerId, "provider_error", searchedAt, errorCode = "provider_io_error")
        } catch (_: Throwable) {
            WebSearchResponse(query, providerId, "provider_error", searchedAt, errorCode = "provider_response_invalid")
        }
    }
}

fun registerWebSearchTool(registry: ToolRegistry, provider: WebSearchProvider) {
    registry.register(
        ToolDefinition(
            id = "web.search",
            version = 1,
            description = "Search the public web for current or unfamiliar information and return source URLs",
            risk = ToolRisk.READ_ONLY,
            requiredArguments = setOf("query"),
            parameterSchemaJson = objectToolSchema(
                JSONObject()
                    .put("query", JSONObject().put("type", "string").put("minLength", 1).put("maxLength", 200))
                    .put("limit", JSONObject().put("type", "integer").put("minimum", 1).put("maximum", 10)),
                setOf("query"),
            ),
            requiredCapabilities = setOf(ai.drsai.remote.workbench.model.RuntimeCapability.WEB_SEARCH),
        ),
    ) { _, arguments ->
        val query = arguments.getString("query").trim()
        require(query.length in 1..200) { "web_search_query_invalid" }
        val limit = arguments.optInt("limit", DEFAULT_MAX_RESULTS).coerceIn(1, 10)
        provider.search(query, limit).toJson().toString()
    }
}
