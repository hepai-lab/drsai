package ai.drsai.remote.runtime.oaep

/** Public diagnostic metadata is deliberately lossy and never carries raw payload values. */
object OaepDiagnosticMetadata {
    private val safeLabel = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")

    fun unknownEvent(kind: String): Map<String, Any?> = mapOf(
        "category" to "unsupported_event",
        "kind" to kind.takeIf { value ->
            safeLabel.matches(value) && SENSITIVE_MARKERS.none(value.lowercase()::contains)
        }.orRedacted(),
    )

    private fun String?.orRedacted(): String = this ?: "redacted"

    private val SENSITIVE_MARKERS = setOf("bearer", "token", "secret", "credential", "api_key")
}
