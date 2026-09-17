package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class ModelProviderStoreText { NAME_REQUIRED, API_UNSUPPORTED, MODEL_REQUIRED, ENABLED_MODEL_REQUIRED, MODEL_ID_REQUIRED, MODEL_ID_DUPLICATE, API_KEY_REQUIRED, BUILTIN_DELETE, URL_INVALID }
interface ModelProviderStoreStrings { fun text(key: ModelProviderStoreText): String }
class AndroidModelProviderStoreStrings(private val context: Context) : ModelProviderStoreStrings {
    override fun text(key: ModelProviderStoreText): String = context.getString(when (key) {
        ModelProviderStoreText.NAME_REQUIRED -> R.string.provider_name_required
        ModelProviderStoreText.API_UNSUPPORTED -> R.string.provider_api_unsupported
        ModelProviderStoreText.MODEL_REQUIRED -> R.string.provider_model_required
        ModelProviderStoreText.ENABLED_MODEL_REQUIRED -> R.string.provider_enabled_model_required
        ModelProviderStoreText.MODEL_ID_REQUIRED -> R.string.provider_model_id_required
        ModelProviderStoreText.MODEL_ID_DUPLICATE -> R.string.provider_model_id_duplicate
        ModelProviderStoreText.API_KEY_REQUIRED -> R.string.provider_api_key_required
        ModelProviderStoreText.BUILTIN_DELETE -> R.string.provider_builtin_delete_forbidden
        ModelProviderStoreText.URL_INVALID -> R.string.provider_url_invalid
    })
}
object EnglishModelProviderStoreStrings : ModelProviderStoreStrings {
    override fun text(key: ModelProviderStoreText): String = when (key) {
        ModelProviderStoreText.NAME_REQUIRED -> "Provider name is required"
        ModelProviderStoreText.API_UNSUPPORTED -> "Unsupported API protocol"
        ModelProviderStoreText.MODEL_REQUIRED -> "Configure at least one model"
        ModelProviderStoreText.ENABLED_MODEL_REQUIRED -> "Enable at least one valid model"
        ModelProviderStoreText.MODEL_ID_REQUIRED -> "Model ID is required"
        ModelProviderStoreText.MODEL_ID_DUPLICATE -> "Model IDs must be unique"
        ModelProviderStoreText.API_KEY_REQUIRED -> "API key is required"
        ModelProviderStoreText.BUILTIN_DELETE -> "Built-in HepAI cannot be deleted"
        ModelProviderStoreText.URL_INVALID -> "Invalid API address"
    }
}
