package ai.drsai.remote.runtime.errors

enum class FailureCategory {
    CONFIGURATION, CREDENTIAL, QUOTA_OR_RATE_LIMIT, NETWORK, MODEL_CAPABILITY,
    RUNTIME, PERMISSION, TOOL, APPROVAL, RECOVERY, PLATFORM_UNSUPPORTED,
}

enum class FailureAction {
    OPEN_MODEL_SETTINGS, UPDATE_CREDENTIAL, RETRY_LATER, CHECK_NETWORK, CHOOSE_MODEL,
    CHECK_PROVIDER_ACCESS, CHECK_PROVIDER_ACCOUNT, RETRY_RUNTIME, GRANT_PERMISSION, RETRY_TASK,
    REVIEW_APPROVAL, OPEN_RECOVERY, CONNECT_DESKTOP, NONE,
}

data class FailureSignal(
    val code: String? = null,
    val status: Int? = null,
    val retryable: Boolean = false,
    val source: String? = null,
    val detail: String? = null,
)

data class UserFacingFailure(
    val category: FailureCategory,
    val title: String,
    val summary: String,
    val impact: String,
    val stableCode: String,
    val retryable: Boolean,
    val primaryAction: FailureAction,
    val technicalDetail: String?,
)

object UserFacingFailureMapper {
    private val secretPattern = Regex(
        "(?i)(authorization\\s*[:=]\\s*(?:bearer\\s+)?\\S+|bearer\\s+[a-z0-9._-]+|(?:api[-_ ]?key|token)\\s*[:=]\\s*\\S+)",
    )

    fun map(signal: FailureSignal, strings: UserFacingFailureStrings = EnglishUserFacingFailureStrings): UserFacingFailure {
        val code = signal.code.orEmpty().lowercase()
        val source = signal.source.orEmpty().lowercase()
        val category = when {
            code.contains("desktop_required") || code.contains("platform_unsupported") || code.contains("unsupported_capability") -> FailureCategory.PLATFORM_UNSUPPORTED
            code.contains("recovery") || code.contains("checkpoint") || code.contains("reconciliation") -> FailureCategory.RECOVERY
            code.contains("approval") || code.contains("interaction") -> FailureCategory.APPROVAL
            code.contains("permission") || code.contains("saf_") || signal.status == 403 && source != "provider" -> FailureCategory.PERMISSION
            code.contains("model_tools_unsupported") || code.contains("model_capabilit") || code.contains("tool_choice") -> FailureCategory.MODEL_CAPABILITY
            signal.status == 401 || code.contains("credential") || code.contains("api_key") || code.contains("invalid_token") -> FailureCategory.CREDENTIAL
            signal.status == 402 || signal.status == 429 || code.contains("quota") || code.contains("rate_limit") -> FailureCategory.QUOTA_OR_RATE_LIMIT
            signal.status == 403 && source == "provider" -> FailureCategory.CREDENTIAL
            signal.status == 408 || (signal.status != null && signal.status in 500..599) || code.contains("timeout") || code.contains("network") || code.contains("dns") || code.contains("tls") || code.contains("stream") || code.contains("provider_unavailable") -> FailureCategory.NETWORK
            code.contains("runtime") || code.contains("python") || source == "runtime" -> FailureCategory.RUNTIME
            code.contains("tool") || source == "tool" || source == "host" -> FailureCategory.TOOL
            else -> FailureCategory.CONFIGURATION
        }
        val presentation = providerPresentation(signal, source, strings) ?: presentation(category, signal.retryable, strings)
        return UserFacingFailure(
            category = category,
            title = presentation.first,
            summary = presentation.second,
            impact = presentation.fourth,
            stableCode = signal.code?.takeIf(String::isNotBlank) ?: defaultCode(category),
            retryable = signal.retryable && category !in setOf(FailureCategory.CREDENTIAL, FailureCategory.PERMISSION, FailureCategory.MODEL_CAPABILITY),
            primaryAction = presentation.third,
            technicalDetail = signal.detail?.let(ai.drsai.remote.runtime.security.SensitiveDataRedactor::redact)
                ?.replace(secretPattern, "[REDACTED]")?.take(512),
        )
    }

    private data class Presentation(val first: String, val second: String, val third: FailureAction, val fourth: String)

    private fun copy(strings: UserFacingFailureStrings, key: FailureCopyKey, action: FailureAction): Presentation =
        strings.copy(key).let { Presentation(it.title, it.summary, action, it.impact) }

    private fun providerPresentation(signal: FailureSignal, source: String, strings: UserFacingFailureStrings): Presentation? {
        if (source != "provider") return null
        return when (signal.status) {
            401 -> copy(strings, FailureCopyKey.PROVIDER_KEY, FailureAction.UPDATE_CREDENTIAL)
            403 -> copy(strings, FailureCopyKey.PROVIDER_ACCESS, FailureAction.CHECK_PROVIDER_ACCESS)
            402 -> copy(strings, FailureCopyKey.PROVIDER_BALANCE, FailureAction.CHECK_PROVIDER_ACCOUNT)
            408 -> copy(strings, FailureCopyKey.PROVIDER_TIMEOUT, FailureAction.CHECK_NETWORK)
            429 -> copy(strings, FailureCopyKey.PROVIDER_RATE, FailureAction.RETRY_LATER)
            in 500..599 -> copy(strings, FailureCopyKey.PROVIDER_SERVER, FailureAction.RETRY_LATER)
            else -> if (signal.code.orEmpty().contains("stream", ignoreCase = true)) Presentation(
                strings.copy(FailureCopyKey.PROVIDER_STREAM).title,
                strings.copy(FailureCopyKey.PROVIDER_STREAM).summary,
                FailureAction.RETRY_LATER,
                strings.copy(FailureCopyKey.PROVIDER_STREAM).impact,
            ) else null
        }
    }

    private fun presentation(category: FailureCategory, retryable: Boolean, strings: UserFacingFailureStrings): Presentation = when (category) {
        FailureCategory.CONFIGURATION -> copy(strings, FailureCopyKey.CONFIGURATION, FailureAction.OPEN_MODEL_SETTINGS)
        FailureCategory.CREDENTIAL -> copy(strings, FailureCopyKey.CREDENTIAL, FailureAction.UPDATE_CREDENTIAL)
        FailureCategory.QUOTA_OR_RATE_LIMIT -> copy(strings, FailureCopyKey.QUOTA, FailureAction.RETRY_LATER)
        FailureCategory.NETWORK -> copy(strings, FailureCopyKey.NETWORK, FailureAction.CHECK_NETWORK)
        FailureCategory.MODEL_CAPABILITY -> copy(strings, FailureCopyKey.MODEL_CAPABILITY, FailureAction.CHOOSE_MODEL)
        FailureCategory.RUNTIME -> copy(strings, FailureCopyKey.RUNTIME, FailureAction.RETRY_RUNTIME)
        FailureCategory.PERMISSION -> copy(strings, FailureCopyKey.PERMISSION, FailureAction.GRANT_PERMISSION)
        FailureCategory.TOOL -> copy(strings, if (retryable) FailureCopyKey.TOOL_RETRY else FailureCopyKey.TOOL_FINAL, FailureAction.RETRY_TASK)
        FailureCategory.APPROVAL -> copy(strings, FailureCopyKey.APPROVAL, FailureAction.REVIEW_APPROVAL)
        FailureCategory.RECOVERY -> copy(strings, FailureCopyKey.RECOVERY, FailureAction.OPEN_RECOVERY)
        FailureCategory.PLATFORM_UNSUPPORTED -> copy(strings, FailureCopyKey.PLATFORM_UNSUPPORTED, FailureAction.CONNECT_DESKTOP)
    }

    private fun defaultCode(category: FailureCategory) = "p10_${category.name.lowercase()}"
}
