package ai.drsai.remote.remote.data

const val WEB_SEARCH_CONTRACT_SCHEMA = "opendrsai.web-search/1"
const val MANAGED_WEB_SEARCH_MODEL = "hepai/tavily-web-search-v1"

enum class WebSearchRecoveryAction {
    LOGIN, ACCOUNT_OR_BYOK, RETRY, RETRY_OR_BYOK, CONTACT_ADMIN, CHANGE_URL, EDIT_REQUEST,
}

data class WebSearchRecovery(val retryable: Boolean, val action: WebSearchRecoveryAction)

val WEB_SEARCH_FUNCTIONS = listOf("search", "extract")
val WEB_SEARCH_PROVIDER_MODES = listOf("auto", "managed", "byok", "none")
val WEB_SEARCH_RECOVERY = linkedMapOf(
    "login_required" to WebSearchRecovery(false, WebSearchRecoveryAction.LOGIN),
    "permission_denied" to WebSearchRecovery(false, WebSearchRecoveryAction.ACCOUNT_OR_BYOK),
    "rate_limited" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY),
    "quota_exhausted" to WebSearchRecovery(false, WebSearchRecoveryAction.ACCOUNT_OR_BYOK),
    "worker_unavailable" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY_OR_BYOK),
    "provider_authentication_failed" to WebSearchRecovery(false, WebSearchRecoveryAction.CONTACT_ADMIN),
    "provider_rate_limited" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY),
    "provider_quota_exhausted" to WebSearchRecovery(false, WebSearchRecoveryAction.CONTACT_ADMIN),
    "provider_timeout" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY),
    "provider_unavailable" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY),
    "provider_invalid_response" to WebSearchRecovery(true, WebSearchRecoveryAction.RETRY),
    "unsafe_web_url" to WebSearchRecovery(false, WebSearchRecoveryAction.CHANGE_URL),
    "invalid_request" to WebSearchRecovery(false, WebSearchRecoveryAction.EDIT_REQUEST),
)

fun webSearchRecovery(code: String?): WebSearchRecovery? = WEB_SEARCH_RECOVERY[code]
