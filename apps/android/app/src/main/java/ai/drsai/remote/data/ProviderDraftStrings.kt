package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class ProviderDraftText { EMPTY, CATALOG_INVALID, MODEL_MISSING, KEY_INVALID, ACCESS_DENIED, BALANCE, ENDPOINT, RATE, UNAVAILABLE, HTTP, PROVIDER_DETAIL, DNS, TLS, TIMEOUT, NETWORK }
interface ProviderDraftStrings { fun text(key: ProviderDraftText, vararg arguments: Any): String }

class AndroidProviderDraftStrings(private val context: Context) : ProviderDraftStrings {
    override fun text(key: ProviderDraftText, vararg arguments: Any): String = context.getString(when (key) {
        ProviderDraftText.EMPTY -> R.string.provider_draft_empty
        ProviderDraftText.CATALOG_INVALID -> R.string.provider_draft_catalog_invalid
        ProviderDraftText.MODEL_MISSING -> R.string.provider_draft_model_missing
        ProviderDraftText.KEY_INVALID -> R.string.model_api_key_invalid_generic
        ProviderDraftText.ACCESS_DENIED -> R.string.provider_draft_access_denied
        ProviderDraftText.BALANCE -> R.string.provider_draft_balance
        ProviderDraftText.ENDPOINT -> R.string.provider_draft_endpoint
        ProviderDraftText.RATE -> R.string.model_rate_limited
        ProviderDraftText.UNAVAILABLE -> R.string.provider_draft_unavailable
        ProviderDraftText.HTTP -> R.string.provider_draft_http
        ProviderDraftText.PROVIDER_DETAIL -> R.string.provider_draft_detail
        ProviderDraftText.DNS -> R.string.provider_draft_dns
        ProviderDraftText.TLS -> R.string.provider_draft_tls
        ProviderDraftText.TIMEOUT -> R.string.provider_draft_timeout
        ProviderDraftText.NETWORK -> R.string.provider_draft_network
    }, *arguments)
}

object EnglishProviderDraftStrings : ProviderDraftStrings {
    override fun text(key: ProviderDraftText, vararg arguments: Any): String = when (key) {
        ProviderDraftText.EMPTY -> "The model service returned an empty response"
        ProviderDraftText.CATALOG_INVALID -> "The model service response is missing the model list"
        ProviderDraftText.MODEL_MISSING -> "Configured models were not found: ${arguments.firstOrNull()}"
        ProviderDraftText.KEY_INVALID -> "The API key is invalid or expired"
        ProviderDraftText.ACCESS_DENIED -> "This API key cannot access the model catalog"
        ProviderDraftText.BALANCE -> "Insufficient model service balance; check the account"
        ProviderDraftText.ENDPOINT -> "The API address is incorrect; model catalog not found"
        ProviderDraftText.RATE -> "Requests are too frequent or quota is insufficient; try again later"
        ProviderDraftText.UNAVAILABLE -> "The model service is temporarily unavailable"
        ProviderDraftText.HTTP -> "Connection failed (HTTP ${arguments.firstOrNull()})"
        ProviderDraftText.PROVIDER_DETAIL -> "${arguments.getOrNull(0)}; provider response: ${arguments.getOrNull(1)}"
        ProviderDraftText.DNS -> "Could not resolve the API host; check the address and network"
        ProviderDraftText.TLS -> "TLS certificate verification failed; check the API host certificate"
        ProviderDraftText.TIMEOUT -> "Connection timed out; check the network and API host"
        ProviderDraftText.NETWORK -> "Could not connect to the model service; check the network"
    }
}
