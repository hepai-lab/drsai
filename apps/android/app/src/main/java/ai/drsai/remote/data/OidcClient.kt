package ai.drsai.remote.data

import android.net.Uri
import android.util.Base64
import ai.drsai.remote.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.math.BigInteger
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.RSAPublicKeySpec
import java.util.concurrent.TimeUnit

internal val OIDC_ISSUER: String get() = BuildConfig.OIDC_ISSUER
internal val OIDC_DISCOVERY: String get() = "$OIDC_ISSUER/.well-known/openid-configuration"
internal const val OIDC_LEGACY_CLIENT_ID = "opendrsai-desktop"
internal val OIDC_CLIENT_ID: String get() = BuildConfig.OIDC_CLIENT_ID
internal const val OIDC_SCOPE = "openid email profile roles groups hai_api offline_access"
internal const val OIDC_APP_RETURN_URI = "opendrsai://oauth2redirect"
internal const val OIDC_NATIVE_REDIRECT_URI = "ai.drsai.remote:/oauth2redirect"
internal const val OIDC_AUTH_TIMEOUT_MS = 5 * 60 * 1000L

data class OidcConfiguration(
    val clientId: String,
    val nativeRedirectUri: String = "",
) {
    val usesNativeRedirect: Boolean get() = nativeRedirectUri.isNotBlank()

    init {
        require(clientId.isNotBlank()) { "OIDC client_id 不能为空" }
        require(!usesNativeRedirect || nativeRedirectUri == OIDC_NATIVE_REDIRECT_URI) {
            "Android 原生回调必须为 $OIDC_NATIVE_REDIRECT_URI"
        }
    }

    companion object {
        fun fromBuildConfig() = OidcConfiguration(
            clientId = BuildConfig.OIDC_CLIENT_ID,
            nativeRedirectUri = BuildConfig.OIDC_REDIRECT_URI,
        )
    }
}

data class OidcLoginTransaction(
    val clientId: String,
    val redirectUri: String,
    val verifier: String,
    val state: String,
    val nonce: String,
    val createdAt: Long,
)

class OidcLoginSession internal constructor(
    val authorizationUrl: String,
    internal val transaction: OidcLoginTransaction,
    internal val server: ServerSocket?,
) {
    val usesNativeRedirect: Boolean get() = server == null
}

internal fun validateAuthorizationCallback(
    callback: Uri,
    transaction: OidcLoginTransaction,
    now: Long = System.currentTimeMillis(),
): String {
    if (transaction.createdAt > now + 60_000 || now - transaction.createdAt > OIDC_AUTH_TIMEOUT_MS) {
        throw ApiException(401, "登录请求已过期，请重新登录", retryable = false)
    }
    val expected = Uri.parse(transaction.redirectUri)
    val sameDestination = callback.scheme.equals(expected.scheme, ignoreCase = true) &&
        callback.authority.equals(expected.authority, ignoreCase = true) &&
        callback.path == expected.path
    if (!sameDestination) throw ApiException(401, "登录回调地址不匹配", retryable = false)
    val error = callback.getQueryParameter("error")
    if (!error.isNullOrBlank()) {
        throw ApiException(
            401,
            callback.getQueryParameter("error_description") ?: error,
            retryable = false,
        )
    }
    if (callback.getQueryParameter("state") != transaction.state) {
        throw ApiException(401, "登录状态校验失败", retryable = false)
    }
    return callback.getQueryParameter("code")
        ?.takeIf(String::isNotBlank)
        ?: throw ApiException(401, "登录回调缺少授权码", retryable = false)
}

class OidcClient(
    private val configuration: OidcConfiguration = OidcConfiguration.fromBuildConfig(),
    private val refreshClientId: () -> String? = { null },
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build(),
) : TokenLifecycleClient {
    @Volatile private var metadataCache: JSONObject? = null
    @Volatile private var jwksCache: JSONObject? = null

    suspend fun startLogin(): OidcLoginSession = withContext(Dispatchers.IO) {
        val config = metadata()
        val verifier = randomToken(64)
        val state = randomToken(32)
        val nonce = randomToken(32)
        val challenge = base64Url(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII)),
        )
        val server = if (configuration.usesNativeRedirect) null else {
            ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 1_000 }
        }
        val redirectUri = configuration.nativeRedirectUri.ifBlank {
            "http://127.0.0.1:${requireNotNull(server).localPort}/callback"
        }
        val transaction = OidcLoginTransaction(
            clientId = configuration.clientId,
            redirectUri = redirectUri,
            verifier = verifier,
            state = state,
            nonce = nonce,
            createdAt = System.currentTimeMillis(),
        )
        val authorizationUrl = Uri.parse(config.getString("authorization_endpoint")).buildUpon()
            .appendQueryParameter("client_id", transaction.clientId)
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", OIDC_SCOPE)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", state)
            .appendQueryParameter("nonce", nonce)
            .build()
            .toString()
        OidcLoginSession(authorizationUrl, transaction, server)
    }

    suspend fun finishLogin(session: OidcLoginSession, redirect: Uri? = null): AuthTokens = withContext(Dispatchers.IO) {
        try {
            val callback = redirect ?: withTimeout(OIDC_AUTH_TIMEOUT_MS) { waitForCallback(session) }
            val code = validateAuthorizationCallback(callback, session.transaction)
            val token = tokenRequest(
                FormBody.Builder()
                    .add("grant_type", "authorization_code")
                    .add("client_id", session.transaction.clientId)
                    .add("redirect_uri", session.transaction.redirectUri)
                    .add("code", code)
                    .add("code_verifier", session.transaction.verifier)
                    .build(),
            )
            validateAndMap(
                token,
                expectedNonce = session.transaction.nonce,
                previousRefreshToken = null,
                clientId = session.transaction.clientId,
            )
        } finally {
            runCatching { session.server?.close() }
        }
    }

    fun restoreSession(transaction: OidcLoginTransaction): OidcLoginSession =
        OidcLoginSession(authorizationUrl = "", transaction = transaction, server = null)

    fun cancel(session: OidcLoginSession?) {
        runCatching { session?.server?.close() }
    }

    override suspend fun refresh(refreshToken: String): AuthTokens = withContext(Dispatchers.IO) {
        val clientId = refreshClientId()?.takeIf(String::isNotBlank) ?: configuration.clientId
        val token = tokenRequest(
            FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("client_id", clientId)
                .add("refresh_token", refreshToken)
                .build(),
        )
        validateAndMap(token, expectedNonce = null, previousRefreshToken = refreshToken, clientId = clientId)
    }

    override suspend fun revoke(refreshToken: String) = withContext(Dispatchers.IO) {
        runCatching {
            val endpoint = metadata().optString("revocation_endpoint", "$OIDC_ISSUER/oauth2/revoke")
            http.newCall(
                Request.Builder().url(endpoint).post(
                    FormBody.Builder()
                        .add("token", refreshToken)
                        .add("token_type_hint", "refresh_token")
                        .build(),
                ).build(),
            ).execute().close()
        }
        Unit
    }

    private suspend fun waitForCallback(session: OidcLoginSession): Uri {
        val server = session.server ?: throw ApiException(401, "原生登录回调尚未返回")
        while (currentCoroutineContext().isActive) {
            try {
                server.accept().use { socket ->
                    val requestLine = BufferedReader(InputStreamReader(socket.getInputStream())).readLine().orEmpty()
                    val target = requestLine.split(' ').getOrNull(1) ?: "/callback?error=invalid_request"
                    val callback = Uri.parse("http://127.0.0.1:${server.localPort}$target")
                    val validPath = callback.path == "/callback"
                    if (validPath) writeAppReturnResponse(socket)
                    else writeHttpResponse(
                        socket,
                        404,
                        "<!doctype html><meta charset=\"utf-8\"><h2>Not found</h2>",
                    )
                    if (validPath) return callback
                }
            } catch (_: SocketTimeoutException) {
                // Wake periodically so coroutine cancellation is observed.
            }
        }
        throw ApiException(401, "登录已取消")
    }

    private fun writeAppReturnResponse(socket: java.net.Socket) {
        val html = """
            <!doctype html>
            <html lang="zh-CN">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <meta http-equiv="refresh" content="0;url=$OIDC_APP_RETURN_URI">
              <title>OpenDrSai</title>
            </head>
            <body style="font-family:sans-serif;text-align:center;padding:64px 20px">
              <h2>登录完成</h2>
              <p>正在返回 OpenDrSai…</p>
              <p><a href="$OIDC_APP_RETURN_URI">如果没有自动返回，请点击这里</a></p>
              <script>window.location.replace('$OIDC_APP_RETURN_URI')</script>
            </body>
            </html>
        """.trimIndent()
        val bytes = html.toByteArray(StandardCharsets.UTF_8)
        socket.getOutputStream().apply {
            write(
                ("HTTP/1.1 302 Found\r\n" +
                    "Location: $OIDC_APP_RETURN_URI\r\n" +
                    "Content-Type: text/html; charset=utf-8\r\n" +
                    "Content-Length: ${bytes.size}\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "Connection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII),
            )
            write(bytes)
            flush()
        }
    }

    private fun writeHttpResponse(socket: java.net.Socket, status: Int, html: String) {
        val bytes = html.toByteArray(StandardCharsets.UTF_8)
        val reason = if (status == 200) "OK" else "Not Found"
        socket.getOutputStream().apply {
            write("HTTP/1.1 $status $reason\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
            write(bytes)
            flush()
        }
    }

    private fun tokenRequest(body: FormBody): JSONObject {
        val response = http.newCall(
            Request.Builder()
                .url(metadataBlocking().getString("token_endpoint"))
                .header("Accept", "application/json")
                .post(body)
                .build(),
        ).execute()
        val raw = response.body?.string().orEmpty()
        val status = response.code
        response.close()
        val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
        if (status !in 200..299 || !json.optString("token_type").equals("bearer", ignoreCase = true)) {
            throw ApiException(status, json.optString("error_description", json.optString("error", "OIDC Token 请求失败")))
        }
        if (!json.has("access_token") || !json.has("id_token")) {
            throw ApiException(status, "OIDC Token 响应不完整")
        }
        return json
    }

    private fun validateAndMap(
        token: JSONObject,
        expectedNonce: String?,
        previousRefreshToken: String?,
        clientId: String,
    ): AuthTokens {
        val idClaims = verifyJwt(token.getString("id_token"))
        val accessToken = token.getString("access_token")
        val accessClaims = verifyJwt(accessToken)
        validateClaims(idClaims, clientId)
        validateClaims(accessClaims, "hai-api")
        if (expectedNonce != null && idClaims.optString("nonce") != expectedNonce) {
            throw ApiException(401, "OIDC nonce 校验失败")
        }
        val subject = idClaims.optString("sub", accessClaims.optString("sub"))
        if (subject.isBlank()) throw ApiException(401, "OIDC Token 缺少用户标识")
        val refreshToken = token.optString("refresh_token", previousRefreshToken.orEmpty())
        if (refreshToken.isBlank()) throw ApiException(401, "OIDC 未返回 Refresh Token")
        return AuthTokens(
            accessToken = accessToken,
            refreshToken = refreshToken,
            user = User(
                id = subject,
                name = idClaims.optString("name", idClaims.optString("email", subject)),
                avatarUrl = idClaims.optString("picture").ifBlank { null },
            ),
        )
    }

    private fun validateClaims(claims: JSONObject, audience: String) {
        if (claims.optString("iss") != OIDC_ISSUER) throw ApiException(401, "OIDC issuer 校验失败")
        if (!audienceIncludes(claims.opt("aud"), audience)) throw ApiException(401, "OIDC audience 校验失败")
        if (claims.optLong("exp") <= System.currentTimeMillis() / 1000) throw ApiException(401, "OIDC Token 已过期")
    }

    private fun audienceIncludes(raw: Any?, expected: String): Boolean = when (raw) {
        is String -> raw == expected
        is JSONArray -> (0 until raw.length()).any { raw.optString(it) == expected }
        else -> false
    }

    private fun verifyJwt(token: String): JSONObject {
        val parts = token.split('.')
        if (parts.size != 3) throw ApiException(401, "OIDC 返回了无效 JWT")
        val header = JSONObject(String(base64UrlDecode(parts[0]), StandardCharsets.UTF_8))
        if (header.optString("alg") != "RS256") throw ApiException(401, "OIDC Token 必须使用 RS256")
        val keys = jwksBlocking().getJSONArray("keys")
        val kid = header.optString("kid")
        val key = (0 until keys.length()).map { keys.getJSONObject(it) }
            .firstOrNull { it.optString("kty") == "RSA" && (kid.isBlank() || it.optString("kid") == kid) }
            ?: throw ApiException(401, "找不到 OIDC 签名密钥")
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(
            RSAPublicKeySpec(
                BigInteger(1, base64UrlDecode(key.getString("n"))),
                BigInteger(1, base64UrlDecode(key.getString("e"))),
            ),
        )
        val valid = Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey)
            update("${parts[0]}.${parts[1]}".toByteArray(StandardCharsets.US_ASCII))
            verify(base64UrlDecode(parts[2]))
        }
        if (!valid) throw ApiException(401, "OIDC Token 签名校验失败")
        return JSONObject(String(base64UrlDecode(parts[1]), StandardCharsets.UTF_8))
    }

    private suspend fun metadata(): JSONObject = withContext(Dispatchers.IO) { metadataBlocking() }

    private fun metadataBlocking(): JSONObject {
        metadataCache?.let { return it }
        val response = http.newCall(Request.Builder().url(OIDC_DISCOVERY).header("Accept", "application/json").build()).execute()
        val raw = response.body?.string().orEmpty()
        val status = response.code
        response.close()
        val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
        if (status !in 200..299 || json.optString("issuer") != OIDC_ISSUER) {
            throw ApiException(status, "无法加载 HAI OIDC 配置")
        }
        metadataCache = json
        return json
    }

    private fun jwksBlocking(): JSONObject {
        jwksCache?.let { return it }
        val response = http.newCall(
            Request.Builder().url(metadataBlocking().getString("jwks_uri")).header("Accept", "application/json").build(),
        ).execute()
        val raw = response.body?.string().orEmpty()
        val status = response.code
        response.close()
        val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
        val keys = json.optJSONArray("keys")
        if (status !in 200..299 || keys == null || keys.length() == 0) {
            throw ApiException(status, "无法加载 HAI OIDC 签名密钥")
        }
        jwksCache = json
        return json
    }

    private fun randomToken(size: Int): String {
        val bytes = ByteArray(size)
        SecureRandom().nextBytes(bytes)
        return base64Url(bytes)
    }

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun base64UrlDecode(value: String): ByteArray =
        Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
