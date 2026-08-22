package ai.drsai.remote.data

import org.json.JSONObject
import java.net.URI

private const val MAX_AVATAR_URL_LENGTH = 2_048

internal fun oidcUser(idClaims: JSONObject, accessClaims: JSONObject): User {
    val subject = idClaims.optString("sub", accessClaims.optString("sub"))
    require(subject.isNotBlank()) { "oidc_subject_required" }
    val avatar = sequenceOf(idClaims.optString("picture"), accessClaims.optString("picture"))
        .mapNotNull(::normalizeOidcAvatarUrl)
        .firstOrNull()
    return User(
        id = subject,
        name = idClaims.optString("name", idClaims.optString("email", subject)),
        avatarUrl = avatar,
    )
}

/** OIDC `picture` is untrusted input. Only public HTTPS image URLs reach the image loader. */
internal fun normalizeOidcAvatarUrl(raw: String?): String? {
    val value = raw?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_AVATAR_URL_LENGTH } ?: return null
    val uri = runCatching { URI(value) }.getOrNull() ?: return null
    if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return null
    if (uri.userInfo != null || uri.fragment != null) return null
    return uri.normalize().toASCIIString()
}

internal fun userAvatarInitials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter(String::isNotBlank)
    if (words.isEmpty()) return ""
    return if (words.size > 1) {
        words.take(2).joinToString("") { it.first().uppercaseChar().toString() }
    } else {
        words.single().codePoints().limit(2).toArray()
            .joinToString("") { String(Character.toChars(it)) }
            .uppercase()
    }
}
