package ai.drsai.remote.runtime.reliability

import ai.drsai.remote.data.FullRuntimeDiagnosticUi
import ai.drsai.remote.data.OaepDiagnosticEventUi
import java.security.MessageDigest

data class DiagnosticFeedbackEnvironment(
    val versionName: String,
    val versionCode: Int,
    val buildType: String,
    val manufacturer: String,
    val model: String,
    val apiLevel: Int,
)

data class DiagnosticFeedbackBundle(
    val text: String,
    val digest: String,
    val secretScanPassed: Boolean,
)

object DiagnosticFeedbackBundleFactory {
    fun create(
        environment: DiagnosticFeedbackEnvironment,
        stableCode: String,
        runId: String?,
        runStatus: String?,
        events: List<OaepDiagnosticEventUi>,
        runtime: FullRuntimeDiagnosticUi,
    ): DiagnosticFeedbackBundle {
        val eventSummary = events.takeLast(20).joinToString(",") { event ->
            listOf(event.sequence.toString(), token(event.type), token(event.source), token(event.errorCode ?: "ok"))
                .joinToString(":")
        }.ifBlank { "none" }
        val canonical = buildString {
            append("version=").append(token(environment.versionName)).append(" (").append(environment.versionCode).append(")\n")
            append("build_type=").append(token(environment.buildType)).append('\n')
            append("device=").append(token(environment.manufacturer)).append('/').append(token(environment.model)).append('\n')
            append("android_api=").append(environment.apiLevel).append('\n')
            append("stable_code=").append(token(stableCode)).append('\n')
            append("run_ref=").append(runId?.let { sha256(it).take(16) } ?: "none").append('\n')
            append("run_status=").append(token(runStatus ?: "none")).append('\n')
            append("event_count=").append(events.size).append('\n')
            append("event_summary=").append(eventSummary).append('\n')
            append("runtime_binding=").append(token(runtime.bindingState)).append('\n')
            append("runtime_health=").append(token(runtime.health)).append('\n')
            append("runtime_route=").append(token(runtime.route)).append('\n')
            append("kernel_digest=").append(digest(runtime.kernelSha256)).append('\n')
            append("skill_digest=").append(digest(runtime.skillManifestSha256)).append('\n')
            append("capability_digest=").append(digest(runtime.capabilityManifestSha256)).append('\n')
            append("model_capability_digest=").append(digest(runtime.modelCapabilityDigest)).append('\n')
        }
        val bundleDigest = sha256(canonical)
        val text = "OpenDrSai Android diagnostic feedback\n$canonical" + "feedback_digest=$bundleDigest"
        return DiagnosticFeedbackBundle(text, bundleDigest, secretScanPassed = DiagnosticFeedbackSecretScanner.isSafe(text))
    }

    private fun token(value: String): String = value.lowercase()
        .replace(Regex("[^a-z0-9._/-]+"), "_").trim('_').take(80).ifBlank { "unknown" }

    private fun digest(value: String?): String = value?.takeIf { it.matches(Regex("[a-fA-F0-9]{32,128}")) }
        ?.lowercase() ?: "none"

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

object DiagnosticFeedbackSecretScanner {
    private val secretPatterns = listOf(
        Regex("(?i)bearer\\s+[^\\s]+"),
        Regex("(?i)\\bsk-(?:ant-)?[a-z0-9_-]{8,}"),
        Regex("(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|cookie)\\s*[=:]\\s*[^\\s]+"),
        Regex("-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    )
    private val privateBodyFields = Regex("(?im)^(content|prompt|message|details|reasoning|thought|chain_of_thought)=")

    fun isSafe(value: String): Boolean = secretPatterns.none { it.containsMatchIn(value) } &&
        !privateBodyFields.containsMatchIn(value)
}
