package ai.drsai.remote.runtime.tools

import ai.drsai.remote.workbench.model.RuntimeCapability
import java.net.URI
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

private const val BROWSER_PROTOCOL = "p9-controlled-browser-v1"
private const val MAX_BROWSER_BYTES = 2_000_000L
private const val MAX_BROWSER_TEXT = 20_000
private const val MAX_BROWSER_REDIRECTS = 5

data class BrowserForm(
    val id: String,
    val action: String,
    val method: String,
    val fields: Set<String>,
    val sensitive: Boolean,
)

data class BrowserPage(
    val sessionId: String,
    val url: String,
    val title: String,
    val text: String,
    val links: List<String>,
    val forms: List<BrowserForm>,
    val status: String = "ok",
    val errorCode: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema_version", BROWSER_PROTOCOL)
        .put("session_id", sessionId)
        .put("url", url)
        .put("title", title)
        .put("text", text)
        .put("links", JSONArray(links))
        .put("forms", JSONArray(forms.map { form -> JSONObject()
            .put("id", form.id).put("action", form.action).put("method", form.method)
            .put("fields", JSONArray(form.fields.sorted())).put("sensitive", form.sensitive)
        }))
        .put("status", status)
        .putOpt("error_code", errorCode)
}

data class BrowserDownload(
    val sessionId: String,
    val url: String,
    val contentType: String,
    val sizeBytes: Long,
    val sha256: String,
    val fileName: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("schema_version", BROWSER_PROTOCOL).put("session_id", sessionId).put("url", url)
        .put("content_type", contentType).put("size_bytes", sizeBytes).put("sha256", sha256)
        .put("file_name", fileName).put("downloaded_at", Instant.now().toString())
}

interface ControlledBrowserProvider {
    suspend fun navigate(subject: String, sessionId: String?, url: String): BrowserPage
    suspend fun read(subject: String, sessionId: String): BrowserPage
    suspend fun submit(subject: String, sessionId: String, formId: String, fields: Map<String, String>): BrowserPage
    suspend fun download(subject: String, sessionId: String, url: String): BrowserDownload
}

class HttpControlledBrowserProvider(
    client: OkHttpClient = OkHttpClient.Builder().followRedirects(false).build(),
    private val allowHttpForTests: Boolean = false,
    private val safetyPolicy: NetworkSafetyPolicy = NetworkSafetyPolicy(allowPrivateForTests = allowHttpForTests),
) : ControlledBrowserProvider {
    private val client = client.newBuilder().dns(safetyPolicy.dns()).followRedirects(false).followSslRedirects(false).build()
    private data class Session(
        val subject: String,
        val id: String,
        var page: BrowserPage? = null,
        val cookies: MutableMap<String, String> = linkedMapOf(),
    )
    private val sessions = ConcurrentHashMap<String, Session>()

    override suspend fun navigate(subject: String, sessionId: String?, url: String): BrowserPage {
        val session = session(subject, sessionId)
        return requestPage(session, url, null)
    }

    override suspend fun read(subject: String, sessionId: String): BrowserPage = owned(subject, sessionId).page
        ?: throw IllegalStateException("browser_session_empty")

    override suspend fun submit(
        subject: String, sessionId: String, formId: String, fields: Map<String, String>,
    ): BrowserPage {
        val session = owned(subject, sessionId)
        val form = session.page?.forms?.firstOrNull { it.id == formId }
            ?: throw IllegalArgumentException("browser_form_not_found")
        require(fields.keys.all { it in form.fields }) { "browser_form_field_not_declared" }
        require(fields.size <= 32 && fields.all { it.key.length <= 100 && it.value.length <= 4_096 }) {
            "browser_form_fields_invalid"
        }
        val body = FormBody.Builder().apply { fields.toSortedMap().forEach(::add) }.build()
        val target = if (form.method == "GET") {
            val parsed = form.action.toHttpUrl().newBuilder()
            fields.toSortedMap().forEach(parsed::addQueryParameter)
            parsed.build().toString()
        } else form.action
        return requestPage(session, target, if (form.method == "GET") null else body)
    }

    override suspend fun download(subject: String, sessionId: String, url: String): BrowserDownload {
        val session = owned(subject, sessionId)
        val response = execute(session, url, null)
        response.use {
            require(it.isSuccessful) { "browser_download_http_${it.code}" }
            val body = requireNotNull(it.body) { "browser_download_body_missing" }
            val declared = body.contentLength()
            require(declared in -1..MAX_BROWSER_BYTES) { "browser_download_too_large" }
            val bytes = readBounded(body.byteStream(), MAX_BROWSER_BYTES.toInt(), "browser_download_too_large")
            val finalUrl = it.request.url.toString()
            val name = it.header("Content-Disposition")?.substringAfter("filename=", "")?.trim(' ', '"')
                ?.takeIf(String::isNotBlank) ?: URI(finalUrl).path.substringAfterLast('/').ifBlank { "download.bin" }
            return BrowserDownload(
                session.id, finalUrl, it.header("Content-Type").orEmpty().substringBefore(';'), bytes.size.toLong(),
                MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { value -> "%02x".format(value) },
                name.take(200),
            )
        }
    }

    private fun requestPage(session: Session, url: String, body: FormBody?): BrowserPage {
        val response = execute(session, url, body)
        response.use {
            require(it.isSuccessful) { "browser_http_${it.code}" }
            val responseBody = requireNotNull(it.body) { "browser_body_missing" }
            require(responseBody.contentLength() in -1..MAX_BROWSER_BYTES) { "browser_response_too_large" }
            val mime = responseBody.contentType()?.let { type -> "${type.type}/${type.subtype}" }?.lowercase()
                ?: if (allowHttpForTests) "text/html" else throw IllegalArgumentException("browser_content_type_required")
            require(mime in setOf("text/html", "application/xhtml+xml", "text/plain")) { "browser_content_type_denied" }
            val bytes = readBounded(responseBody.byteStream(), MAX_BROWSER_BYTES.toInt(), "browser_response_too_large")
            val html = bytes.toString(responseBody.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
            val finalUrl = it.request.url.toString()
            val page = parsePage(session.id, finalUrl, html)
            session.page = page
            return page
        }
    }

    private fun execute(session: Session, url: String, body: FormBody?): okhttp3.Response {
        var current = url
        var currentBody = body
        repeat(MAX_BROWSER_REDIRECTS + 1) { redirectCount ->
            safetyPolicy.validateUrl(current, allowHttpForTests)
            val request = Request.Builder().url(current).apply {
                if (session.cookies.isNotEmpty()) header("Cookie", session.cookies.entries.joinToString("; ") { "${it.key}=${it.value}" })
                if (currentBody == null) get() else post(requireNotNull(currentBody))
            }.build()
            val response = client.newCall(request).execute()
            storeCookies(session, response.headers("Set-Cookie"))
            if (!response.isRedirect) return response
            if (redirectCount >= MAX_BROWSER_REDIRECTS) {
                response.close()
                throw IllegalArgumentException("browser_redirect_limit")
            }
            val next = response.header("Location")?.let { URI(current).resolve(it).toString() }
            val code = response.code
            response.close()
            current = next ?: throw IllegalArgumentException("browser_redirect_invalid")
            if (code in setOf(301, 302, 303)) currentBody = null
        }
        throw IllegalArgumentException("browser_redirect_limit")
    }

    private fun storeCookies(session: Session, values: List<String>) = values.forEach { raw ->
        raw.substringBefore(';').split('=', limit = 2).takeIf { pair -> pair.size == 2 }
            ?.let { pair -> session.cookies[pair[0].trim()] = pair[1].trim() }
    }

    private fun readBounded(input: java.io.InputStream, maxBytes: Int, error: String): ByteArray = input.use {
        val output = ByteArrayOutputStream(minOf(maxBytes, 32_768))
        val buffer = ByteArray(8_192)
        var total = 0
        while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            total += count
            require(total <= maxBytes) { error }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }

    private fun session(subject: String, requested: String?): Session {
        if (requested != null) return owned(subject, requested)
        val created = Session(subject, UUID.randomUUID().toString())
        sessions[created.id] = created
        return created
    }

    private fun owned(subject: String, id: String): Session = sessions[id]
        ?.takeIf { it.subject == subject } ?: throw IllegalArgumentException("browser_session_not_found")

    private fun parsePage(sessionId: String, url: String, html: String): BrowserPage {
        val withoutActive = html.replace(Regex("(?is)<(script|style|noscript|svg|template)[^>]*>.*?</\\1>"), " ")
        val title = Regex("(?is)<title[^>]*>(.*?)</title>").find(withoutActive)?.groupValues?.get(1)
            ?.let(::plainText).orEmpty().take(500)
        val links = Regex("(?is)<a\\b[^>]*href\\s*=\\s*['\"]([^'\"]+)['\"]")
            .findAll(withoutActive).mapNotNull { resolve(url, it.groupValues[1]) }.distinct().take(100).toList()
        val forms = Regex("(?is)<form\\b([^>]*)>(.*?)</form>").findAll(withoutActive).take(20).mapIndexed { index, match ->
            val attrs = match.groupValues[1]
            val action = attribute(attrs, "action")?.let { resolve(url, it) } ?: url
            val method = attribute(attrs, "method")?.uppercase()?.takeIf { it in setOf("GET", "POST") } ?: "GET"
            val inputs = Regex("(?is)<(?:input|textarea|select)\\b([^>]*)>").findAll(match.groupValues[2]).toList()
            val fields = inputs.mapNotNull { attribute(it.groupValues[1], "name") }.filter { it.length <= 100 }.toSet()
            val sensitive = inputs.any { attribute(it.groupValues[1], "type")?.lowercase() in setOf("password", "email", "tel") }
            BrowserForm("form-$index", action, method, fields, sensitive)
        }.toList()
        return BrowserPage(sessionId, url, title, plainText(withoutActive).take(MAX_BROWSER_TEXT), links, forms)
    }

    private fun attribute(attrs: String, name: String): String? = Regex("(?is)\\b${Regex.escape(name)}\\s*=\\s*['\"]([^'\"]*)['\"]")
        .find(attrs)?.groupValues?.get(1)?.trim()
    private fun resolve(base: String, value: String): String? = runCatching { URI(base).resolve(value).toString() }
        .getOrNull()?.takeIf { it.startsWith("https://") || (allowHttpForTests && it.startsWith("http://")) }
    private fun plainText(value: String): String = value.replace(Regex("(?s)<[^>]+>"), " ")
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
        .replace(Regex("\\s+"), " ").trim()
}

fun registerControlledBrowserTools(registry: ToolRegistry, provider: ControlledBrowserProvider) {
    val capability = setOf(RuntimeCapability.BROWSER_SESSION)
    registry.register(ToolDefinition(
        "browser.navigate", 1, "Open a public page in an isolated controlled browser session", ToolRisk.READ_ONLY,
        setOf("url"), objectToolSchema(JSONObject().put("url", JSONObject().put("type", "string"))
            .put("session_id", JSONObject().put("type", "string")), setOf("url")), capability,
    )) { context, args -> provider.navigate(context.accountSubject, args.optString("session_id").ifBlank { null }, args.getString("url")).toJson().toString() }
    registry.register(ToolDefinition(
        "browser.read", 1, "Read the current controlled browser page", ToolRisk.READ_ONLY,
        setOf("session_id"), objectToolSchema(JSONObject().put("session_id", JSONObject().put("type", "string")), setOf("session_id")), capability,
    )) { context, args -> provider.read(context.accountSubject, args.getString("session_id")).toJson().toString() }
    registry.register(ToolDefinition(
        "browser.submit", 1, "Submit a declared browser form; may send credentials or external data", ToolRisk.SENSITIVE,
        setOf("session_id", "form_id", "fields"), objectToolSchema(JSONObject()
            .put("session_id", JSONObject().put("type", "string")).put("form_id", JSONObject().put("type", "string"))
            .put("fields", JSONObject().put("type", "object")), setOf("session_id", "form_id", "fields")), capability,
    )) { context, args ->
        val raw = args.getJSONObject("fields")
        val fields = raw.keys().asSequence().associateWith { raw.getString(it) }
        provider.submit(context.accountSubject, args.getString("session_id"), args.getString("form_id"), fields).toJson().toString()
    }
    registry.register(ToolDefinition(
        "browser.download", 1, "Download and hash a bounded browser resource", ToolRisk.SENSITIVE,
        setOf("session_id", "url"), objectToolSchema(JSONObject().put("session_id", JSONObject().put("type", "string"))
            .put("url", JSONObject().put("type", "string")), setOf("session_id", "url")), capability,
    )) { context, args -> provider.download(context.accountSubject, args.getString("session_id"), args.getString("url")).toJson().toString() }
}
