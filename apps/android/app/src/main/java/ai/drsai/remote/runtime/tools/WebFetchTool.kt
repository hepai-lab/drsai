package ai.drsai.remote.runtime.tools

import ai.drsai.remote.workbench.model.RuntimeCapability
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.nio.charset.Charset
import java.time.Instant
import java.util.zip.InflaterInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

private const val WEB_FETCH_PROTOCOL = "p9-web-fetch-v1"
private const val MAX_FETCH_BYTES = 2_000_000
private const val MAX_FETCH_TEXT_CHARS = 20_000
private const val MAX_ROBOTS_BYTES = 64_000
private const val MAX_REDIRECTS = 5

data class WebFetchResponse(
    val requestedUrl: String,
    val finalUrl: String?,
    val status: String,
    val fetchedAt: String,
    val contentType: String? = null,
    val encoding: String? = null,
    val title: String? = null,
    val content: String = "",
    val bytesRead: Int = 0,
    val truncated: Boolean = false,
    val errorCode: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema_version", WEB_FETCH_PROTOCOL)
        .put("provider", "http-direct")
        .put("requested_url", requestedUrl)
        .putOpt("final_url", finalUrl)
        .put("status", status)
        .put("fetched_at", fetchedAt)
        .putOpt("content_type", contentType)
        .putOpt("encoding", encoding)
        .putOpt("title", title)
        .put("content", content)
        .put("bytes_read", bytesRead)
        .put("truncated", truncated)
        .putOpt("error_code", errorCode)
}

fun interface WebFetchProvider {
    suspend fun fetch(url: String): WebFetchResponse
}

class HttpWebFetchProvider(
    http: OkHttpClient = OkHttpClient(),
    private val clock: () -> Instant = Instant::now,
    private val allowInsecureLoopbackForTests: Boolean = false,
    private val safetyPolicy: NetworkSafetyPolicy = NetworkSafetyPolicy(allowPrivateForTests = allowInsecureLoopbackForTests),
) : WebFetchProvider {
    private val http = http.newBuilder().dns(safetyPolicy.dns()).followRedirects(false).followSslRedirects(false).build()

    override suspend fun fetch(url: String): WebFetchResponse = withContext(Dispatchers.IO) {
        val fetchedAt = clock().toString()
        val initial = url.toHttpUrlOrNull()
            ?: return@withContext failure(url, null, "invalid_url", fetchedAt)
        if (initial.scheme != "https" && !allowInsecureLoopbackForTests) {
            return@withContext failure(url, null, "https_required", fetchedAt)
        }
        runCatching { safetyPolicy.validateUrl(initial.toString(), allowInsecureLoopbackForTests) }
            .getOrElse { return@withContext failure(url, null, it.message ?: "network_url_denied", fetchedAt) }
        var current = initial
        try {
            repeat(MAX_REDIRECTS + 1) { redirectCount ->
                when (robotsDecision(current)) {
                    "denied" -> return@withContext failure(url, current.toString(), "robots_denied", fetchedAt)
                    "unavailable" -> return@withContext failure(url, current.toString(), "robots_unavailable", fetchedAt)
                }
                http.newCall(Request.Builder().url(current).header("Accept", "text/html,text/plain,application/pdf").build())
                    .execute().use { response ->
                        if (response.isRedirect) {
                            if (redirectCount >= MAX_REDIRECTS) return@withContext failure(url, current.toString(), "redirect_limit", fetchedAt)
                            val next = response.header("Location")?.let(current::resolve)
                                ?: return@withContext failure(url, current.toString(), "redirect_invalid", fetchedAt)
                            if (next.scheme != "https" && !(allowInsecureLoopbackForTests && next.host == initial.host)) {
                                return@withContext failure(url, next.toString(), "redirect_https_required", fetchedAt)
                            }
                            runCatching { safetyPolicy.validateUrl(next.toString(), allowInsecureLoopbackForTests) }
                                .getOrElse { return@withContext failure(url, next.toString(), it.message ?: "redirect_network_denied", fetchedAt) }
                            current = next
                            return@repeat
                        }
                        if (response.code in setOf(401, 403, 451)) {
                            return@withContext failure(url, current.toString(), "access_denied", fetchedAt)
                        }
                        if (!response.isSuccessful) return@withContext failure(url, current.toString(), "http_${response.code}", fetchedAt)
                        val body = response.body ?: return@withContext failure(url, current.toString(), "empty_response", fetchedAt)
                        if (body.contentLength() > MAX_FETCH_BYTES) return@withContext failure(url, current.toString(), "response_too_large", fetchedAt)
                        val bytes = readBounded(body.byteStream(), MAX_FETCH_BYTES)
                            ?: return@withContext failure(url, current.toString(), "response_too_large", fetchedAt)
                        val mediaType = body.contentType()
                        val mime = mediaType?.let { "${it.type}/${it.subtype}" }?.lowercase() ?: "application/octet-stream"
                        val extracted = when {
                            mime == "application/pdf" -> ExtractedContent(
                                BoundedPdfTextExtractor.extract(bytes), "PDF", "binary",
                            )
                            mime in setOf("text/html", "application/xhtml+xml") -> {
                                val charset = detectCharset(mediaType?.charset(), bytes)
                                extractHtml(bytes.toString(charset), charset.name())
                            }
                            mime.startsWith("text/") -> {
                                val charset = detectCharset(mediaType?.charset(), bytes)
                                ExtractedContent(bytes.toString(charset), null, charset.name())
                            }
                            else -> return@withContext failure(url, current.toString(), "content_type_unsupported", fetchedAt)
                        }
                        val normalized = extracted.text.replace(Regex("\\s+"), " ").trim()
                        val truncated = normalized.length > MAX_FETCH_TEXT_CHARS
                        return@withContext WebFetchResponse(
                            requestedUrl = url, finalUrl = current.toString(), status = "ok", fetchedAt = fetchedAt,
                            contentType = mime, encoding = extracted.encoding, title = extracted.title,
                            content = normalized.take(MAX_FETCH_TEXT_CHARS), bytesRead = bytes.size, truncated = truncated,
                        )
                    }
            }
            failure(url, current.toString(), "redirect_limit", fetchedAt)
        } catch (_: SocketTimeoutException) {
            failure(url, current.toString(), "fetch_timeout", fetchedAt, "timeout")
        } catch (_: IOException) {
            failure(url, current.toString(), "fetch_io_error", fetchedAt)
        } catch (_: Throwable) {
            failure(url, current.toString(), "fetch_response_invalid", fetchedAt)
        }
    }

    private fun robotsDecision(url: HttpUrl): String {
        val robotsUrl = url.newBuilder().encodedPath("/robots.txt").query(null).fragment(null).build()
        return try {
            http.newCall(Request.Builder().url(robotsUrl).build()).execute().use { response ->
                when {
                    response.code == 404 -> "allowed"
                    response.code in setOf(401, 403) -> "denied"
                    !response.isSuccessful -> "unavailable"
                    else -> {
                        val body = response.body ?: return@use "allowed"
                        if (body.contentLength() > MAX_ROBOTS_BYTES) return@use "unavailable"
                        val bytes = readBounded(body.byteStream(), MAX_ROBOTS_BYTES) ?: return@use "unavailable"
                        if (robotsDisallows(bytes.toString(Charsets.UTF_8), url.encodedPath)) "denied" else "allowed"
                    }
                }
            }
        } catch (_: Throwable) { "unavailable" }
    }

    companion object {
        internal fun robotsDisallows(robots: String, path: String): Boolean {
            var applies = false
            for (raw in robots.lineSequence()) {
                val line = raw.substringBefore('#').trim()
                val key = line.substringBefore(':', "").trim().lowercase()
                val value = line.substringAfter(':', "").trim()
                when (key) {
                    "user-agent" -> applies = value == "*" || value.equals("OpenDrSai", ignoreCase = true)
                    "disallow" -> if (applies && value.isNotEmpty() && path.startsWith(value)) return true
                }
            }
            return false
        }

        private fun readBounded(input: java.io.InputStream, maxBytes: Int): ByteArray? = input.use {
            val output = ByteArrayOutputStream(minOf(maxBytes, 32_768))
            val buffer = ByteArray(8_192)
            var total = 0
            while (true) {
                val count = it.read(buffer)
                if (count < 0) break
                total += count
                if (total > maxBytes) return null
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }

        private fun detectCharset(header: Charset?, bytes: ByteArray): Charset {
            if (header != null) return header
            val head = bytes.take(4_096).toByteArray().toString(Charsets.ISO_8859_1)
            val name = Regex("""(?i)<meta[^>]+charset\s*=\s*[\"']?([a-z0-9._-]+)""")
                .find(head)?.groupValues?.get(1)
            return name?.let { runCatching { Charset.forName(it) }.getOrNull() } ?: Charsets.UTF_8
        }

        private fun extractHtml(html: String, encoding: String): ExtractedContent {
            val title = Regex("""(?is)<title[^>]*>(.*?)</title>""").find(html)?.groupValues?.get(1)?.let(::htmlText)
            val withoutActive = html
                .replace(Regex("""(?is)<(script|style|noscript|svg|template)[^>]*>.*?</\1>"""), " ")
            val main = Regex("""(?is)<(main|article)[^>]*>(.*?)</\1>""").find(withoutActive)?.groupValues?.get(2)
                ?: Regex("""(?is)<body[^>]*>(.*?)</body>""").find(withoutActive)?.groupValues?.get(1)
                ?: withoutActive
            return ExtractedContent(htmlText(main), title, encoding)
        }

        private fun htmlText(value: String): String = value
            .replace(Regex("<[^>]+>"), " ")
            .replace("&amp;", "&", ignoreCase = true)
            .replace("&quot;", "\"", ignoreCase = true)
            .replace("&#39;", "'", ignoreCase = true)
            .replace("&lt;", "<", ignoreCase = true)
            .replace("&gt;", ">", ignoreCase = true)

        private fun failure(requested: String, final: String?, code: String, at: String, status: String = "error") =
            WebFetchResponse(requested, final, status, at, errorCode = code)
    }
}

private data class ExtractedContent(val text: String, val title: String?, val encoding: String)

internal object BoundedPdfTextExtractor {
    private val stream = Regex("(?s)stream\\r?\\n(.*?)\\r?\\nendstream")
    private val literal = Regex("\\(((?:\\\\.|[^\\)])*)\\)\\s*Tj")
    private val arrayLiteral = Regex("\\[((?:.|\\n)*?)]\\s*TJ")

    fun extract(bytes: ByteArray): String {
        require(bytes.size <= MAX_FETCH_BYTES) { "pdf_too_large" }
        val raw = bytes.toString(Charsets.ISO_8859_1)
        val parts = buildList {
            stream.findAll(raw).forEach { match ->
                val dictionary = raw.substring(maxOf(0, match.range.first - 300), match.range.first)
                val content = if ("/FlateDecode" in dictionary) {
                    runCatching {
                        InflaterInputStream(match.groupValues[1].toByteArray(Charsets.ISO_8859_1).inputStream())
                            .readBytes().toString(Charsets.ISO_8859_1)
                    }.getOrNull()
                } else match.groupValues[1]
                if (content != null) {
                    literal.findAll(content).forEach { add(decodePdfLiteral(it.groupValues[1])) }
                    arrayLiteral.findAll(content).forEach { array ->
                        literal.findAll(array.groupValues[1] + " Tj").forEach { add(decodePdfLiteral(it.groupValues[1])) }
                    }
                }
            }
        }
        require(parts.isNotEmpty()) { "pdf_text_unavailable" }
        return parts.joinToString(" ")
    }

    private fun decodePdfLiteral(value: String): String = value
        .replace("\\n", "\n").replace("\\r", "\r").replace("\\t", "\t")
        .replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")
}

fun registerWebFetchTool(registry: ToolRegistry, provider: WebFetchProvider) {
    registry.register(
        ToolDefinition(
            id = "web.fetch", version = 1,
            description = "Fetch and extract bounded text from an HTTPS web page or PDF without executing scripts",
            risk = ToolRisk.READ_ONLY,
            requiredArguments = setOf("url"),
            parameterSchemaJson = objectToolSchema(
                JSONObject().put("url", JSONObject().put("type", "string").put("maxLength", 2_048)),
                setOf("url"),
            ),
            requiredCapabilities = setOf(RuntimeCapability.WEB_FETCH),
        ),
    ) { _, arguments ->
        val url = arguments.getString("url").trim()
        require(url.length in 1..2_048) { "web_fetch_url_invalid" }
        provider.fetch(url).toJson().toString()
    }
}
