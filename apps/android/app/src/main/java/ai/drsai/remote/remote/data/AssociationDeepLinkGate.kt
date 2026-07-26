package ai.drsai.remote.remote.data

import java.security.MessageDigest

sealed interface AssociationDeepLinkDecision {
    data class Accept(val code: String) : AssociationDeepLinkDecision
    data object Duplicate : AssociationDeepLinkDecision
    data object Reject : AssociationDeepLinkDecision
}

/**
 * Process-memory-only ingress gate. It retains only a digest for duplicate Intent
 * suppression; the one-time grant is never logged or persisted.
 */
class AssociationDeepLinkGate(private val expectedIssuer: String) {
    private var lastFingerprint: String? = null

    fun evaluate(payload: String): AssociationDeepLinkDecision {
        val code = runCatching { parseAccessGrantCode(payload, expectedIssuer) }
            .getOrElse { return AssociationDeepLinkDecision.Reject }
        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(code.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        if (fingerprint == lastFingerprint) return AssociationDeepLinkDecision.Duplicate
        lastFingerprint = fingerprint
        return AssociationDeepLinkDecision.Accept(code)
    }
}
